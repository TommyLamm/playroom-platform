import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, desc } from 'drizzle-orm';
import { games, versions, jobs, repositories, type Store } from './db.js';
import { extractArchive } from './archive.js';
import type { Config } from './config.js';
import type { GitHubSource } from './github.js';
import type { GameManifest } from '../shared/manifest.js';
import { AppError } from './errors.js';

export async function fileHash(filename: string) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

export async function installVersion(
  store: Store,
  config: Config,
  directory: string,
  manifest: GameManifest,
  source: {
    repositoryId: number | null;
    releaseId: number | null;
    assetId: number | null;
    releaseTag: string | null;
    sha256: string;
  },
) {
  const existing = store.db.select().from(games).where(eq(games.id, manifest.id)).get();
  if (existing && existing.repositoryId !== source.repositoryId)
    throw new AppError(409, '此遊戲 ID 已由另一個來源使用');
  if (source.repositoryId !== null) {
    const associated = store.db
      .select()
      .from(games)
      .where(eq(games.repositoryId, source.repositoryId))
      .get();
    if (associated && associated.id !== manifest.id)
      throw new AppError(409, '同一個 repository 只能對應一個遊戲 ID');
  }
  if (
    store.db
      .select()
      .from(versions)
      .where(and(eq(versions.gameId, manifest.id), eq(versions.version, manifest.version)))
      .get()
  )
    throw new AppError(409, '此版本已匯入，請提高 game.json 的版本號');
  const destination = path.join(config.dataDir, 'games', manifest.id, manifest.version);
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination))
    throw new AppError(409, '版本目錄已存在，請先依維護文件檢查未完成的匯入');
  await fsp.rename(directory, destination);
  try {
    store.db.transaction((tx) => {
      if (!existing)
        tx.insert(games).values({ id: manifest.id, repositoryId: source.repositoryId }).run();
      const { repositoryId: _repo, ...metadata } = source;
      tx.insert(versions)
        .values({
          gameId: manifest.id,
          version: manifest.version,
          manifest,
          ...metadata,
          importedAt: new Date().toISOString(),
        })
        .run();
    });
  } catch (error) {
    await fsp.rm(destination, { recursive: true, force: true });
    throw error;
  }
}

export function publish(store: Store, id: string, version: string) {
  const stored = store.db
    .select()
    .from(versions)
    .where(and(eq(versions.gameId, id), eq(versions.version, version)))
    .get();
  if (!stored) throw new AppError(404, '找不到此遊戲版本');
  store.db.transaction((tx) => {
    tx.update(versions)
      .set({ publishedAt: stored.publishedAt || new Date().toISOString() })
      .where(eq(versions.id, stored.id))
      .run();
    tx.update(games).set({ activeVersion: version, published: true }).where(eq(games.id, id)).run();
  });
}

export function adminLibrary(store: Store) {
  const allVersions = store.db.select().from(versions).orderBy(desc(versions.id)).all();
  return store.db
    .select()
    .from(games)
    .all()
    .map((game) => ({ ...game, versions: allVersions.filter((v) => v.gameId === game.id) }));
}

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
  enqueue(repositoryId: number, releaseId: number) {
    if (this.closing) throw new AppError(503, '平台正在關閉');
    const pending = this.store.db
      .select()
      .from(jobs)
      .where(inArray(jobs.status, ['queued', 'running']))
      .all();
    if (pending.length >= 10) throw new AppError(429, '等待匯入的任務已滿，請稍後重試');
    if (pending.some((j) => j.repositoryId === repositoryId && j.releaseId === releaseId))
      throw new AppError(409, '此 Release 已在匯入佇列中');
    const repo = this.store.db
      .select()
      .from(repositories)
      .where(eq(repositories.id, repositoryId))
      .get();
    if (!repo) throw new AppError(404, '找不到 repository');
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
    this.chain = this.chain.then(() => this.run(id, repo.fullName, repositoryId, releaseId));
    return id;
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
      });
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
