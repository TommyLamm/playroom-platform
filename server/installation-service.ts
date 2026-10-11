import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { games, versions, jobs, installations, type Store } from './db.js';
import type { Config } from './config.js';
import { manifestSchema, isSafePath, type GameManifest } from '../shared/manifest.js';
import { validateDirectory } from './archive.js';
import { directoryInventory, safeDataPath, syncDirectory } from './version-files.js';
import { AppError } from './errors.js';

const sourceSchema = z.object({
  repositoryId: z.number().int().positive().nullable(), releaseId: z.number().int().positive().nullable(),
  assetId: z.number().int().positive().nullable(), releaseTag: z.string().nullable(), sha256: z.string().min(1),
}).strict().refine((s) => s.repositoryId === null || (s.releaseId !== null && s.assetId !== null && /^[a-f0-9]{64}$/.test(s.sha256)), 'Invalid release provenance');
export type InstallSource = z.infer<typeof sourceSchema>;
type Installation = typeof installations.$inferSelect;
export type InstallCheckpoint = 'prepared' | 'moved' | 'registered' | 'quarantine-intent' | 'quarantine-moved';
type Checkpoint = (phase: InstallCheckpoint) => void | Promise<void>;
const now = () => new Date().toISOString();
const exists = async (filename: string) => !!await fs.lstat(filename).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return undefined; throw e; });
const recordFor = (store: Store, id: string, version: string) => store.db.select().from(versions).where(and(eq(versions.gameId, id), eq(versions.version, version))).get();
const finalRelative = (m: GameManifest) => `games/${m.id}/${m.version}`;

function validateJournal(row: Installation) {
  z.string().uuid().parse(row.id);
  const manifest = manifestSchema.parse(row.manifest);
  if (row.gameId !== manifest.id || row.version !== manifest.version || !isSafePath(row.stagingPath) || !row.stagingPath.startsWith('staging/')) throw new Error('Invalid installation identity or staging path');
  const source = sourceSchema.parse(row.source);
  if (source.repositoryId !== null && source.releaseTag !== `v${manifest.version}`) throw new Error('Release tag mismatch');
  z.array(z.object({ path: z.string().refine(isSafePath), size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).parse(row.files);
  return { manifest, source };
}

function assertImportRules(store: Store, manifest: GameManifest, source: InstallSource) {
  const existing = store.db.select().from(games).where(eq(games.id, manifest.id)).get();
  if (existing && existing.repositoryId !== source.repositoryId) throw new AppError(409, '此遊戲 ID 已由另一個來源使用');
  if (source.repositoryId !== null) {
    const associated = store.db.select().from(games).where(eq(games.repositoryId, source.repositoryId)).get();
    if (associated && associated.id !== manifest.id) throw new AppError(409, '同一個 repository 只能對應一個遊戲 ID');
  }
  if (manifest.leaderboard) for (const old of store.db.select().from(versions).where(eq(versions.gameId, manifest.id)).all()) {
    const board = manifest.leaderboard, previous = old.manifest.leaderboard;
    if (previous?.id === board.id && (previous.order !== board.order || previous.unit !== board.unit || previous.minScore !== board.minScore || previous.maxScore !== board.maxScore)) throw new AppError(409, '計分規則已變更，請使用新的 leaderboard.id');
  }
  return existing;
}

function assertJob(store: Store, row: Installation) {
  if (!row.jobId) return;
  const job = store.db.select().from(jobs).where(eq(jobs.id, row.jobId)).get();
  if (!job || job.repositoryId !== row.source.repositoryId || job.releaseId !== row.source.releaseId) throw new Error('Installation job provenance mismatch');
}

async function verify(config: Config, directory: string, row: Installation) {
  const { manifest } = validateJournal(row);
  const files = await directoryInventory(directory, config);
  if (JSON.stringify(files) !== JSON.stringify(row.files) || JSON.stringify(await validateDirectory(directory)) !== JSON.stringify(manifest)) throw new Error('Installation content does not match validated manifest and file hashes');
}
function mark(store: Store, row: Installation, state: Installation['state'], reason: string | null = null) {
  store.db.update(installations).set({ state, reason, updatedAt: now() }).where(eq(installations.id, row.id)).run();
}
function complete(store: Store, row: Installation) {
  store.db.transaction((tx) => {
    tx.update(installations).set({ state: 'completed', reason: null, updatedAt: now() }).where(eq(installations.id, row.id)).run();
    if (row.jobId) tx.update(jobs).set({ status: 'completed', phase: 'completed', gameId: row.gameId, version: row.version, error: null, updatedAt: now() }).where(eq(jobs.id, row.jobId)).run();
  });
}
function register(store: Store, row: Installation) {
  const { manifest, source } = validateJournal(row);
  store.db.transaction((tx) => {
    const existing = assertImportRules(store, manifest, source);
    if (recordFor(store, manifest.id, manifest.version)) throw new Error('Version already registered');
    if (!existing) tx.insert(games).values({ id: manifest.id, repositoryId: source.repositoryId }).run();
    const { repositoryId: _repository, ...metadata } = source;
    tx.insert(versions).values({ gameId: manifest.id, version: manifest.version, manifest, ...metadata, importedAt: row.createdAt }).run();
    tx.update(installations).set({ state: 'registered', reason: null, updatedAt: now() }).where(eq(installations.id, row.id)).run();
  });
}

export async function installVersion(store: Store, config: Config, directory: string, value: GameManifest, input: InstallSource, options: { jobId?: string; checkpoint?: Checkpoint } = {}) {
  const manifest = manifestSchema.parse(value), source = sourceSchema.parse(input);
  assertImportRules(store, manifest, source);
  if (recordFor(store, manifest.id, manifest.version)) throw new AppError(409, '此版本已匯入，請提高 game.json 的版本號');
  const relative = path.relative(path.resolve(config.dataDir), path.resolve(directory)).split(path.sep).join('/');
  if (!isSafePath(relative) || !relative.startsWith('staging/')) throw new Error('Installation must use DATA_DIR/staging');
  directory = await safeDataPath(config.dataDir, relative);
  const destination = await safeDataPath(config.dataDir, finalRelative(manifest));
  if (await exists(destination)) throw new AppError(409, '版本目錄已存在，請先執行匯入診斷');
  if (source.repositoryId !== null && source.releaseTag !== `v${manifest.version}`) throw new Error('Release tag mismatch');
  if (options.jobId) {
    const job = store.db.select().from(jobs).where(eq(jobs.id, options.jobId)).get();
    if (!job || job.repositoryId !== source.repositoryId || job.releaseId !== source.releaseId) throw new Error('Installation job provenance mismatch');
  }
  const files = await directoryInventory(directory, config, true);
  if (JSON.stringify(await validateDirectory(directory)) !== JSON.stringify(manifest)) throw new Error('Installation manifest mismatch');
  const timestamp = now();
  const row: Installation = { id: randomUUID(), jobId: options.jobId ?? null, gameId: manifest.id, version: manifest.version, stagingPath: relative, manifest, source, files, state: 'prepared', reason: null, createdAt: timestamp, updatedAt: timestamp };
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await syncDirectory(path.join(config.dataDir, 'games'));
  await syncDirectory(config.dataDir);
  store.db.insert(installations).values(row).run();
  // After this durable intent, preserve artifacts on every failure for reconciliation.
  await options.checkpoint?.('prepared');
  await safeDataPath(config.dataDir, relative);
  await safeDataPath(config.dataDir, finalRelative(manifest));
  if (await exists(destination)) throw new Error('Installation destination appeared; no files overwritten');
  await fs.rename(directory, destination);
  await syncDirectory(path.dirname(directory));
  await syncDirectory(path.dirname(destination));
  await options.checkpoint?.('moved');
  await verify(config, destination, row);
  register(store, row);
  await options.checkpoint?.('registered');
  complete(store, row);
}

export type InstallationDiagnosis = { id: string; jobId: string | null; gameId: string; version: string; state: string; action: 'recover' | 'quarantine' | 'none' | 'blocked'; reason: string; staging: boolean; final: boolean; registered: boolean };
export async function diagnoseInstallation(store: Store, config: Config, row: Installation): Promise<InstallationDiagnosis> {
  const result: InstallationDiagnosis = { id: row.id, jobId: row.jobId, gameId: row.gameId, version: row.version, state: row.state, action: 'blocked', reason: '', staging: false, final: false, registered: false };
  try {
    const { manifest, source } = validateJournal(row);
    assertJob(store, row);
    if (row.state === 'quarantined') {
      result.action = 'none'; result.reason = row.reason || 'Quarantined; retained for manual inspection'; return result;
    }
    const stage = await safeDataPath(config.dataDir, row.stagingPath), final = await safeDataPath(config.dataDir, finalRelative(manifest));
    result.staging = await exists(stage); result.final = await exists(final);
    const stored = recordFor(store, manifest.id, manifest.version);
    result.registered = !!stored;
    if (stored) {
      const game = store.db.select().from(games).where(eq(games.id, row.gameId)).get();
      if (stored.sha256 !== source.sha256 || stored.releaseId !== source.releaseId || stored.assetId !== source.assetId || stored.releaseTag !== source.releaseTag || game?.repositoryId !== source.repositoryId || JSON.stringify(stored.manifest) !== JSON.stringify(manifest)) throw new Error('Registered version belongs to different installation; protected from changes');
      if (!result.final) throw new Error('Registered version files are missing; restore a verified backup');
      await verify(config, final, row);
      if (result.staging) throw new Error('Registered version has conflicting staging artifacts; protected from changes');
      result.action = row.state === 'completed' ? 'none' : 'recover';
      result.reason = 'Registered content verified; only task completion may change';
    } else if (row.state === 'quarantining') {
      result.action = 'quarantine';
      result.reason = row.reason || 'Quarantine intent';
    } else if (result.final && result.staging) {
      result.action = 'quarantine'; result.reason = 'Conflicting final and staging directories';
    } else if (!result.final && !result.staging) {
      result.action = 'quarantine'; result.reason = 'Installation content is missing';
    } else {
      try { await verify(config, result.final ? final : stage, row); assertImportRules(store, manifest, source); result.action = 'recover'; result.reason = 'Complete validated content can be registered without publishing'; }
      catch (error) { result.action = 'quarantine'; result.reason = (error as Error).message; }
    }
  } catch (error) { result.reason = (error as Error).message; }
  return result;
}

async function quarantine(store: Store, config: Config, row: Installation, reason: string, checkpoint?: Checkpoint) {
  // Persist the destination/intent before moving anything; deterministic names make retries safe.
  validateJournal(row);
  if (recordFor(store, row.gameId, row.version)) throw new Error('Registered files cannot be quarantined');
  mark(store, row, 'quarantining', reason);
  await checkpoint?.('quarantine-intent');
  const root = await safeDataPath(config.dataDir, `quarantine/${row.id}`);
  await fs.mkdir(root, { recursive: true });
  await syncDirectory(path.dirname(root)); await syncDirectory(config.dataDir);
  for (const [name, relative] of [['final', finalRelative(row.manifest)], ['staging', row.stagingPath]]) {
    const from = await safeDataPath(config.dataDir, relative!);
    const to = await safeDataPath(config.dataDir, `quarantine/${row.id}/${name}`);
    if (await exists(from)) {
      if (await exists(to)) throw new Error('Quarantine destination already exists; no files overwritten');
      await fs.rename(from, to);
      await syncDirectory(path.dirname(from)); await syncDirectory(root);
      await checkpoint?.('quarantine-moved');
    }
  }
  const reasonPath = await safeDataPath(config.dataDir, `quarantine/${row.id}/reason.json`);
  await fs.writeFile(reasonPath, JSON.stringify({ installationId: row.id, jobId: row.jobId, gameId: row.gameId, version: row.version, reason }, null, 2), { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'EEXIST') throw e; });
  const reasonFile = await fs.open(reasonPath, 'r+'); try { await reasonFile.sync(); } finally { await reasonFile.close(); }
  await syncDirectory(root);
  store.db.transaction((tx) => {
    tx.update(installations).set({ state: 'quarantined', reason, updatedAt: now() }).where(eq(installations.id, row.id)).run();
    if (row.jobId) tx.update(jobs).set({ status: 'failed', phase: 'quarantined', error: `匯入成品已隔離：${reason}`, updatedAt: now() }).where(eq(jobs.id, row.jobId)).run();
  });
}

export async function repairInstallation(store: Store, config: Config, id: string, checkpoint?: Checkpoint) {
  const row = store.db.select().from(installations).where(eq(installations.id, id)).get();
  if (!row) throw new Error('Unknown installation ID; run imports:diagnose first');
  const report = await diagnoseInstallation(store, config, row);
  if (report.action === 'blocked') { if (row.state !== 'quarantining') mark(store, row, 'blocked', report.reason); throw new Error(report.reason); }
  if (report.action === 'none') return report;
  if (report.action === 'quarantine') await quarantine(store, config, row, report.reason, checkpoint);
  else {
    if (!report.registered) {
      const destination = await safeDataPath(config.dataDir, finalRelative(row.manifest));
      if (!report.final) {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await syncDirectory(path.join(config.dataDir, 'games')); await syncDirectory(config.dataDir);
        const stage = await safeDataPath(config.dataDir, row.stagingPath);
        await safeDataPath(config.dataDir, finalRelative(row.manifest));
        if (await exists(destination)) throw new Error('Recovery destination appeared; no files overwritten');
        await fs.rename(stage, destination);
        await syncDirectory(path.dirname(stage)); await syncDirectory(path.dirname(destination));
        await checkpoint?.('moved');
      }
      await verify(config, destination, row);
      register(store, row); await checkpoint?.('registered');
    }
    complete(store, row);
  }
  return diagnoseInstallation(store, config, store.db.select().from(installations).where(eq(installations.id, id)).get()!);
}

export async function recoverInstallations(store: Store, config: Config) {
  const rows = store.db.select().from(installations).where(inArray(installations.state, ['prepared', 'registered', 'quarantining', 'blocked'])).all();
  for (const row of rows) {
    try { await repairInstallation(store, config, row.id); }
    catch (error) {
      const current = store.db.select().from(installations).where(eq(installations.id, row.id)).get()!;
      // Do not erase a durable quarantine intent after interruption.
      if (current.state !== 'quarantining') mark(store, row, 'blocked', (error as Error).message);
      if (row.jobId) store.db.update(jobs).set({ status: 'failed', phase: 'recovery-blocked', error: '匯入恢復需維護檢查；執行 imports:diagnose', updatedAt: now() }).where(eq(jobs.id, row.jobId)).run();
    }
  }
}
