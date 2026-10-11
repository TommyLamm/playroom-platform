import { and, eq } from 'drizzle-orm';
import { repositories, jobs, importBatches, importBatchItems, type Store } from './db.js';
import { AppError } from './errors.js';
import type { ImportQueue } from './import-queue.js';
import { installedRelease } from './game-catalog.js';
import { pendingJob, type ImportBatch, type BatchItem, type ImportSelection } from '../shared/sources.js';

export function createImportBatchService(store: Store, queue: ImportQueue) {
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
        const installed = installedRelease(store, repo.id, item.releaseId);
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

  return {
    read: batch,
    create(input: { requestId: string; items: ImportSelection[] }) {
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
        return prior;
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
            const installed = installedRelease(store, item.repositoryId, item.releaseId);
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
      return batch(input.requestId);
    },
    list() {
      return { batches: store.sqlite.prepare(`SELECT b.id, b.created_at AS createdAt, count(i.id) AS total,
      COALESCE(sum(CASE WHEN i.outcome = 'skipped' OR j.status = 'completed' THEN 1 ELSE 0 END),0) AS completed,
      COALESCE(sum(CASE WHEN i.outcome = 'failed' OR (i.outcome = 'job' AND (j.status = 'failed' OR j.id IS NULL)) THEN 1 ELSE 0 END),0) AS failed,
      COALESCE(sum(CASE WHEN i.outcome = 'job' AND j.status IN ('queued','running') THEN 1 ELSE 0 END),0) AS pending
      FROM import_batches b LEFT JOIN import_batch_items i ON i.batch_id = b.id LEFT JOIN import_jobs j ON j.id = i.job_id
      GROUP BY b.id ORDER BY b.created_at DESC, b.id ASC LIMIT 50`).all(),
      };
    },
  };
}
