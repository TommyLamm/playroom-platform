import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  repositories,
  githubOwners,
  games,
  versions,
  jobs,
  importBatches,
  importBatchItems,
  type Store,
} from './db.js';
import { ownerName, type GitHubSource } from './github.js';
import { AppError } from './errors.js';
import type { ImportQueue } from './library.js';
import type { SourceChecks } from './source-checks.js';
import {
  defaultRelease,
  pendingJob,
  type Source,
  type ImportBatch,
  type BatchItem,
  type ImportSelection,
} from '../shared/sources.js';

const idParams = z.object({ id: z.coerce.number().int().positive() });
const selectionSchema = z
  .object({ repositoryId: z.number().int().positive(), releaseId: z.number().int().positive() })
  .strict();

export function registerSources(
  app: FastifyInstance,
  store: Store,
  github: GitHubSource,
  queue: ImportQueue,
  requireAdmin: (request: FastifyRequest) => Promise<void>,
  checks: SourceChecks,
) {
  function sources(): Source[] {
    const allGames = store.db.select().from(games).all();
    const allVersions = store.db.select().from(versions).orderBy(desc(versions.id)).all();
    const pending = store.db
      .select()
      .from(jobs)
      .where(inArray(jobs.status, ['queued', 'running']))
      .all();
    return store.db
      .select()
      .from(repositories)
      .orderBy(repositories.fullName)
      .all()
      .map((repo) => {
        const game = allGames.find((g) => g.repositoryId === repo.id);
        const imported = allVersions.filter((v) => v.gameId === game?.id);
        const importedReleaseIds = imported.flatMap((v) =>
          v.releaseId === null ? [] : [v.releaseId],
        );
        const status: Source['status'] = pending.some((j) => j.repositoryId === repo.id)
          ? 'importing'
          : repo.checkError
            ? 'error'
            : !repo.checkedAt
              ? 'unchecked'
              : defaultRelease(repo.cachedReleases, importedReleaseIds)
                ? 'available'
                : repo.cachedReleases.some((r) => importedReleaseIds.includes(r.id))
                  ? 'current'
                  : 'unavailable';
        const { cachedReleases, ...record } = repo;
        return {
          ...record,
          releases: cachedReleases,
          importedReleaseIds,
          gameId: game?.id || null,
          gameName: imported[0]?.manifest.name || null,
          importedVersion: imported[0]?.version || null,
          status,
        };
      });
  }
  function batch(id: string): ImportBatch {
    const record = store.db.select().from(importBatches).where(eq(importBatches.id, id)).get();
    if (!record) throw new AppError(404, '找不到匯入批次');
    const items = store.db
      .select()
      .from(importBatchItems)
      .where(eq(importBatchItems.batchId, id))
      .orderBy(importBatchItems.id)
      .all()
      .map((item): BatchItem => {
        const repo = store.db
          .select()
          .from(repositories)
          .where(eq(repositories.id, item.repositoryId))
          .get()!;
        const job = item.jobId
          ? store.db.select().from(jobs).where(eq(jobs.id, item.jobId)).get()
          : undefined;
        const game = store.db.select().from(games).where(eq(games.repositoryId, repo.id)).get();
        const installed = game
          ? store.db
              .select()
              .from(versions)
              .where(and(eq(versions.gameId, game.id), eq(versions.releaseId, item.releaseId)))
              .get()
          : undefined;
        return {
          repositoryId: repo.id,
          fullName: repo.fullName,
          releaseId: item.releaseId,
          jobId: item.jobId,
          error: job?.error || item.error,
          status:
            item.outcome === 'job'
              ? ((job?.status || 'failed') as BatchItem['status'])
              : item.outcome,
          phase: job?.phase || null,
          gameId: job?.gameId || installed?.gameId || null,
          version: job?.version || installed?.version || null,
        };
      });
    return { ...record, items };
  }
  function canonicalSelections(items: ImportSelection[]) {
    return [
      ...new Map(items.map((item) => [`${item.repositoryId}:${item.releaseId}`, item])).values(),
    ];
  }
  app.get('/api/v1/admin/github-owners', { preHandler: requireAdmin }, async () => ({
    owners: store.db.select().from(githubOwners).orderBy(githubOwners.login).all(),
  }));
  app.post('/api/v1/admin/github-owners', { preHandler: requireAdmin }, async (request) => {
    const { login } = z.object({ login: ownerName }).strict().parse(request.body);
    const owner = await github.owner(login);
    store.db
      .insert(githubOwners)
      .values({ ...owner, createdAt: new Date().toISOString() })
      .onConflictDoNothing()
      .run();
    return {
      owner: store.db.select().from(githubOwners).where(eq(githubOwners.login, owner.login)).get()!,
    };
  });
  app.post(
    '/api/v1/admin/github-owners/:login/remove',
    { preHandler: requireAdmin },
    async (request) => {
      const { login } = z.object({ login: ownerName }).parse(request.params);
      store.db.delete(githubOwners).where(eq(githubOwners.login, login.toLowerCase())).run();
      return { ok: true };
    },
  );
  app.get(
    '/api/v1/admin/github-owners/:login/repositories',
    { preHandler: requireAdmin },
    async (request) => {
      const { login } = z.object({ login: ownerName }).parse(request.params);
      const { page } = z
        .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
        .parse(request.query);
      const owner = store.db
        .select()
        .from(githubOwners)
        .where(eq(githubOwners.login, login.toLowerCase()))
        .get();
      if (!owner) throw new AppError(404, '請先加入 GitHub 帳號');
      const result = await github.discover(owner.login, owner.kind, page);
      const known = new Set(
        store.db
          .select()
          .from(repositories)
          .all()
          .map((r) => r.fullName),
      );
      return {
        ...result,
        repositories: result.repositories.map((r) => ({
          ...r,
          added: known.has(r.fullName.toLowerCase()),
        })),
      };
    },
  );
  app.get('/api/v1/admin/sources', { preHandler: requireAdmin }, async () => ({
    sources: sources(),
  }));
  app.post(
    '/api/v1/admin/repositories/:id/state',
    { preHandler: requireAdmin },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const { archived } = z.object({ archived: z.boolean() }).strict().parse(request.body);
      if (!store.db.select().from(repositories).where(eq(repositories.id, id)).get())
        throw new AppError(404, '找不到 repository');
      if (
        archived &&
        store.db
          .select()
          .from(jobs)
          .where(and(eq(jobs.repositoryId, id), inArray(jobs.status, ['queued', 'running'])))
          .get()
      )
        throw new AppError(409, '匯入中的來源請等待完成後再封存');
      store.db.update(repositories).set({ archived }).where(eq(repositories.id, id)).run();
      return { ok: true };
    },
  );
  app.post(
    '/api/v1/admin/repositories/:id/check',
    { preHandler: requireAdmin },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const repo = store.db.select().from(repositories).where(eq(repositories.id, id)).get();
      if (!repo) throw new AppError(404, '找不到 repository');
      if (repo.archived) throw new AppError(409, '請先恢復已封存來源');
      await checks.checkForRequest(id);
      return { source: sources().find((r) => r.id === id)! };
    },
  );
  app.post('/api/v1/admin/source-checks', { preHandler: requireAdmin }, async (request, reply) => {
    const { force } = z.object({ force: z.boolean().default(true) }).strict().parse(request.body);
    return reply.code(202).send({ check: checks.checkAll(force) });
  });
  app.get('/api/v1/admin/source-checks/current', { preHandler: requireAdmin }, async () => ({ check: checks.current() }));
  app.post('/api/v1/admin/import-batches', { preHandler: requireAdmin }, async (request, reply) => {
    const input = z
      .object({ requestId: z.string().uuid(), items: z.array(selectionSchema).min(1).max(100) })
      .strict()
      .parse(request.body);
    const items = canonicalSelections(input.items);
    const existing = store.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.id, input.requestId))
      .get();
    if (existing) {
      const prior = batch(existing.id);
      const key = (values: ImportSelection[]) =>
        values
          .map((v) => `${v.repositoryId}:${v.releaseId}`)
          .sort()
          .join(',');
      if (key(prior.items) !== key(items)) throw new AppError(409, '此批次識別碼已用於其他項目');
      return reply.code(202).send({ batch: prior });
    }
    const known = store.db.select().from(repositories).all();
    if (items.some((i) => !known.some((r) => r.id === i.repositoryId)))
      throw new AppError(400, '批次包含不存在的來源');
    const newJobs: string[] = [];
    store.db.transaction(() => {
      store.db
        .insert(importBatches)
        .values({ id: input.requestId, createdAt: new Date().toISOString() })
        .run();
      for (const item of items) {
        let outcome: 'job' | 'skipped' | 'failed' = 'job';
        let jobId: string | null = null;
        let error: string | null = null;
        try {
          if (known.find((r) => r.id === item.repositoryId)!.archived)
            throw new AppError(409, '來源已封存，請先恢復');
          const game = store.db
            .select()
            .from(games)
            .where(eq(games.repositoryId, item.repositoryId))
            .get();
          const installed =
            game &&
            store.db
              .select()
              .from(versions)
              .where(and(eq(versions.gameId, game.id), eq(versions.releaseId, item.releaseId)))
              .get();
          if (installed) outcome = 'skipped';
          else {
            const pending = store.db
              .select()
              .from(jobs)
              .where(
                and(eq(jobs.repositoryId, item.repositoryId), eq(jobs.releaseId, item.releaseId)),
              )
              .all()
              .find(pendingJob);
            if (pending) jobId = pending.id;
            else {
              jobId = queue.enqueue(item.repositoryId, item.releaseId, true);
              newJobs.push(jobId);
            }
          }
        } catch (e) {
          outcome = 'failed';
          error = e instanceof AppError ? e.message : '無法加入匯入佇列，請重試';
        }
        store.db
          .insert(importBatchItems)
          .values({ ...item, batchId: input.requestId, outcome, jobId, error })
          .run();
      }
    });
    queue.startJobs(newJobs);
    return reply.code(202).send({ batch: batch(input.requestId) });
  });
  app.get('/api/v1/admin/import-batches', { preHandler: requireAdmin }, async () => ({
    batches: store.db
      .select()
      .from(importBatches)
      .orderBy(desc(importBatches.createdAt))
      .limit(50)
      .all()
      .map((record) => {
        const { items } = batch(record.id);
        return {
          ...record,
          total: items.length,
          completed: items.filter((i) => ['completed', 'skipped'].includes(i.status)).length,
          failed: items.filter((i) => i.status === 'failed').length,
          pending: items.filter(pendingJob).length,
        };
      }),
  }));
  app.get('/api/v1/admin/import-batches/:id', { preHandler: requireAdmin }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { batch: batch(id) };
  });
}
