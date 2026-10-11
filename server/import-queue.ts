import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { jobs, repositories, installations, type Store } from './db.js';
import { extractArchive } from './archive.js';
import { fileHash, installVersion } from './library.js';
import type { Config } from './config.js';
import type { GitHubSource } from './github.js';
import { AppError } from './errors.js';

export class ImportQueue {
  private chain: Promise<void> = Promise.resolve();
  private controller: AbortController | undefined;
  private closing = false;
  constructor(
    private store: Store,
    private config: Config,
    private github: GitHubSource,
  ) {
    store.db
      .update(jobs)
      .set({
        status: 'failed',
        phase: 'interrupted',
        error: '平台在匯入期間重新啟動，請重新匯入',
        updatedAt: new Date().toISOString(),
      })
      .where(inArray(jobs.status, ['queued', 'running']))
      .run();
  }
  enqueue(repositoryId: number, releaseId: number, deferred = false) {
    if (this.closing) throw new AppError(503, '平台正在關閉');
    const pending = this.store.db
      .select()
      .from(jobs)
      .where(inArray(jobs.status, ['queued', 'running']))
      .all();
    if (pending.length >= 100) throw new AppError(429, '等待匯入的任務已滿（最多 100 款），請稍後重試');
    if (pending.some((j) => j.repositoryId === repositoryId && j.releaseId === releaseId))
      throw new AppError(409, '此 Release 已在匯入佇列中');
    const repo = this.store.db
      .select()
      .from(repositories)
      .where(eq(repositories.id, repositoryId))
      .get();
    if (!repo) throw new AppError(404, '找不到 repository');
    if (repo.archived) throw new AppError(409, '來源已封存，請先恢復');
    const id = randomUUID();
    const now = new Date().toISOString();
    this.store.db
      .insert(jobs)
      .values({
        id,
        repositoryId,
        releaseId,
        status: 'queued',
        phase: 'queued',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    if (!deferred) this.startJobs([id]);
    return id;
  }
  // A batch creates task associations transactionally. Start downloads only
  // after that transaction commits, so a rollback cannot leave orphan imports.
  startJobs(ids: string[]) {
    for (const id of ids) {
      const job = this.store.db.select().from(jobs).where(eq(jobs.id, id)).get();
      if (!job || job.status !== 'queued') continue;
      const repo = this.store.db.select().from(repositories).where(eq(repositories.id, job.repositoryId)).get();
      if (!repo) continue;
      this.chain = this.chain.then(() => this.run(id, repo.fullName, repo.id, job.releaseId));
    }
  }
  private update(id: string, values: Partial<typeof jobs.$inferInsert>) {
    this.store.db
      .update(jobs)
      .set({ ...values, updatedAt: new Date().toISOString() })
      .where(eq(jobs.id, id))
      .run();
  }
  private async run(id: string, fullName: string, repositoryId: number, releaseId: number) {
    const work = path.join(this.config.dataDir, 'staging', id);
    try {
      if (this.closing) throw new AppError(503, '平台已關閉，請重新匯入');
      this.controller = new AbortController();
      const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(120000)]);
      this.update(id, { status: 'running', phase: 'resolving' });
      const { release, asset } = await this.github.resolve(fullName, releaseId);
      signal.throwIfAborted();
      await fsp.mkdir(work, { recursive: true });
      const zip = path.join(work, 'game.zip');
      this.update(id, { phase: 'downloading' });
      await this.github.download(asset, zip, this.config.maxZipBytes, signal);
      const sha256 = await fileHash(zip);
      if (asset.digest && asset.digest !== `sha256:${sha256}`)
        throw new AppError(400, '遊戲包雜湊與 GitHub 記錄不符');
      this.update(id, { phase: 'validating' });
      const extracted = path.join(work, 'extracted');
      const manifest = await extractArchive(zip, extracted, this.config);
      if (release.tag !== `v${manifest.version}`)
        throw new AppError(400, 'Release tag 必須是 v 加上 game.json 的 version，例如 v1.0.0');
      signal.throwIfAborted();
      await installVersion(this.store, this.config, extracted, manifest, {
        repositoryId,
        releaseId,
        assetId: asset.id,
        releaseTag: release.tag,
        sha256,
      }, { jobId: id });
      this.update(id, {
        status: 'completed',
        phase: 'completed',
        gameId: manifest.id,
        version: manifest.version,
      });
    } catch (error) {
      this.update(id, {
        status: 'failed',
        phase: 'failed',
        error:
          error instanceof AppError
            ? error.message
            : '匯入失敗或連線中斷，請重試；目前上架版本未受影響',
      });
    } finally {
      this.controller = undefined;
      // A durable installation intent owns its artifacts until recovery completes.
      const installation = this.store.db.select().from(installations).where(eq(installations.jobId, id)).get();
      if (!installation || installation.state === 'completed' || installation.state === 'quarantined')
        await fsp.rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  async idle() {
    await this.chain;
  }
  async close() {
    this.closing = true;
    this.controller?.abort();
    await this.chain;
  }
}
