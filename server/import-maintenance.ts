import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import lockfile from 'proper-lockfile';
import { games, versions, installations, jobs, previews, type Store } from './db.js';
import { CURRENT_SCHEMA_VERSION } from './database/version.js';
import { diagnoseInstallation, repairInstallation } from './installation-service.js';
import { directoryInventory, safeDataPath, syncDirectory } from './version-files.js';
import { gameId, gameVersion, isSafePath } from '../shared/manifest.js';
import type { Config } from './config.js';

export async function withImportMaintenance<T>(config: Config, action: (store: Store) => Promise<T>) {
  const database = await safeDataPath(config.dataDir, 'platform.sqlite');
  const lock = await safeDataPath(config.dataDir, '.platform.lock');
  const unlock = await lockfile.lock(config.dataDir, { realpath: false, stale: 30000, lockfilePath: lock });
  try {
    // No migrations/PRAGMA writes: diagnosis never upgrades or repairs a database.
    const sqlite = new Database(database, { readonly: true, fileMustExist: true });
    try {
      if (sqlite.pragma('user_version', { simple: true }) !== CURRENT_SCHEMA_VERSION) throw new Error('Start the current platform once to upgrade the database before diagnosis');
      return await action({ sqlite, db: drizzle(sqlite) });
    } finally { sqlite.close(); }
  } finally { await unlock(); }
}

export async function withImportRepair<T>(config: Config, action: (store: Store) => Promise<T>) {
  const database = await safeDataPath(config.dataDir, 'platform.sqlite');
  const lock = await safeDataPath(config.dataDir, '.platform.lock');
  const unlock = await lockfile.lock(config.dataDir, { realpath: false, stale: 30000, lockfilePath: lock });
  try {
    const sqlite = new Database(database, { fileMustExist: true });
    try {
      if (sqlite.pragma('user_version', { simple: true }) !== CURRENT_SCHEMA_VERSION) throw new Error('Database upgrade required before repair');
      sqlite.pragma('foreign_keys=ON'); sqlite.pragma('synchronous=FULL'); sqlite.pragma('busy_timeout=5000');
      return await action({ sqlite, db: drizzle(sqlite) });
    } finally { sqlite.close(); }
  } finally { await unlock(); }
}

async function children(config: Config, relative: string) {
  const root = await safeDataPath(config.dataDir, relative);
  return fs.readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
}
type Artifact = { id: string; path: string; reason: string; action: 'quarantine' | 'blocked' };
export async function importDiagnosis(store: Store, config: Config) {
  const rows = store.db.select().from(installations).all();
  const reports = [];
  for (const row of rows) reports.push(await diagnoseInstallation(store, config, row));
  const registered = new Set(store.db.select().from(versions).all().map((v) => `games/${v.gameId}/${v.version}`));
  const knownFinal = new Set(rows.filter((r) => r.state !== 'quarantined').map((r) => `games/${r.gameId}/${r.version}`));
  const knownStage = rows.filter((r) => !['completed', 'quarantined'].includes(r.state)).map((r) => r.stagingPath);
  const artifacts: Artifact[] = [];
  for (const game of await children(config, 'games')) {
    if (!game.isDirectory() || !gameId.safeParse(game.name).success) {
      artifacts.push({ id: `blocked:games/${game.name}`, path: `games/${game.name}`, reason: 'Unsafe or unknown game directory; no automatic file operation', action: 'blocked' }); continue;
    }
    for (const version of await children(config, `games/${game.name}`)) {
      const relative = `games/${game.name}/${version.name}`;
      if (registered.has(relative) || knownFinal.has(relative)) continue;
      artifacts.push({ id: `orphan:${relative}`, path: relative, reason: 'No registered version or durable installation provenance', action: version.isDirectory() && gameVersion.safeParse(version.name).success ? 'quarantine' : 'blocked' });
    }
  }
  for (const stage of await children(config, 'staging')) {
    const relative = `staging/${stage.name}`;
    if (knownStage.some((r) => r === relative || r.startsWith(relative + '/'))) continue;
    artifacts.push({ id: `orphan:${relative}`, path: relative, reason: 'Staging without a pending installation; retain for inspection', action: stage.isDirectory() && isSafePath(relative) ? 'quarantine' : 'blocked' });
  }
  const quarantines = [];
  for (const entry of await children(config, 'quarantine')) {
    if (!entry.isDirectory() || !isSafePath(entry.name)) { quarantines.push({ path: `quarantine/${entry.name}`, reason: 'Unsafe quarantine entry' }); continue; }
    try {
      const reasonFile = await safeDataPath(config.dataDir, `quarantine/${entry.name}/reason.json`);
      quarantines.push({ path: `quarantine/${entry.name}`, details: JSON.parse(await fs.readFile(reasonFile, 'utf8')) });
    } catch { quarantines.push({ path: `quarantine/${entry.name}`, reason: 'Incomplete quarantine; inspect its installation intent' }); }
  }
  return { installations: reports, artifacts, quarantines };
}

// Unknown artifacts may only be isolated by an explicit ID from diagnosis.
// A synced intent precedes rename, so repeating the same command after a crash is safe.
export async function repairImport(store: Store, config: Config, id: string) {
  if (!id.startsWith('orphan:')) return repairInstallation(store, config, id);
  const relative = id.slice('orphan:'.length);
  if (!isSafePath(relative)) throw new Error('Unsafe artifact ID');
  const parts = relative.split('/');
  if (!(parts[0] === 'staging' && parts.length === 2) && !(parts[0] === 'games' && parts.length === 3 && gameId.safeParse(parts[1]).success && gameVersion.safeParse(parts[2]).success)) throw new Error('Unknown artifact ID');
  if (parts[0] === 'games' && store.db.select().from(versions).all().some((v) => v.gameId === parts[1] && v.version === parts[2])) throw new Error('Registered version files are protected');
  const known = store.db.select().from(installations).all().find((r) => (!['completed', 'quarantined'].includes(r.state) && (r.stagingPath === relative || r.stagingPath.startsWith(relative + '/'))) || (r.state !== 'quarantined' && `games/${r.gameId}/${r.version}` === relative));
  if (known) throw new Error(`Use installation ID ${known.id} for this artifact`);
  const from = await safeDataPath(config.dataDir, relative);
  const quarantineName = `orphan-${createHash('sha256').update(id).digest('hex')}`;
  const root = await safeDataPath(config.dataDir, `quarantine/${quarantineName}`);
  const to = await safeDataPath(config.dataDir, `quarantine/${quarantineName}/artifact`);
  const intentFile = await safeDataPath(config.dataDir, `quarantine/${quarantineName}/reason.json`);
  const fromStat = await fs.lstat(from).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return undefined; throw e; });
  const toStat = await fs.lstat(to).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return undefined; throw e; });
  if (fromStat && toStat) throw new Error('Quarantine conflict; no files overwritten');
  if (!fromStat && !toStat) throw new Error('Unknown artifact; run imports:diagnose first');
  if (fromStat && !fromStat.isDirectory()) throw new Error('Artifact must be a directory');
  const intent = { id, path: relative, reason: 'Unknown provenance; explicitly quarantined by maintenance' };
  await fs.mkdir(root, { recursive: true });
  await syncDirectory(path.dirname(root)); await syncDirectory(config.dataDir);
  try {
    const handle = await fs.open(intentFile, 'wx');
    try { await handle.writeFile(JSON.stringify(intent, null, 2)); await handle.sync(); } finally { await handle.close(); }
    await syncDirectory(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (JSON.stringify(JSON.parse(await fs.readFile(intentFile, 'utf8'))) !== JSON.stringify(intent)) throw new Error('Quarantine intent mismatch');
  }
  if (fromStat) { await fs.rename(from, to); await syncDirectory(path.dirname(from)); await syncDirectory(root); }
  return { id, action: 'quarantined', path: `quarantine/${quarantineName}` };
}

export async function versionRetention(store: Store, config: Config, timestamp = Date.now()) {
  const allGames = store.db.select().from(games).all();
  const allJobs = store.db.select().from(jobs).all();
  const journals = store.db.select().from(installations).all();
  const grants = store.db.select().from(previews).all();
  const telemetry = store.sqlite.prepare("SELECT value FROM operational_state WHERE key='backup'").get() as { value: string } | undefined;
  let backupRunning = false;
  try { backupRunning = JSON.parse(telemetry?.value ?? '{}').status === 'running'; } catch { /* unknown telemetry does not authorize deletion */ }
  const result = [];
  for (const version of store.db.select().from(versions).all()) {
    const game = allGames.find((g) => g.id === version.gameId)!;
    const reasons: string[] = [];
    if (game.activeVersion === version.version) reasons.push('active-version');
    if (version.publishedAt) reasons.push(game.published ? 'published-resource-and-rollback' : 'published-rollback');
    if (grants.some((g) => g.gameId === version.gameId && g.version === version.version && g.expiresAt > timestamp)) reasons.push('valid-preview');
    if (journals.some((j) => j.gameId === version.gameId && j.version === version.version && !['completed', 'quarantined'].includes(j.state)) || allJobs.some((j) => ['queued', 'running'].includes(j.status) && (j.gameId === version.gameId && j.version === version.version || j.repositoryId === game.repositoryId && j.releaseId === version.releaseId))) reasons.push('installation');
    if (store.sqlite.prepare('SELECT 1 FROM plays WHERE game_id=? AND version=? LIMIT 1').get(version.gameId, version.version)) reasons.push('career-and-leaderboard');
    if (store.sqlite.prepare('SELECT 1 FROM cloud_saves WHERE game_id=? AND game_version=? UNION ALL SELECT 1 FROM cloud_save_snapshots WHERE game_id=? AND game_version=? LIMIT 1').get(version.gameId, version.version, version.gameId, version.version)) reasons.push('save-history');
    if (backupRunning) reasons.push('backup-running');
    let bytes: number | null = null;
    try { bytes = (await directoryInventory(await safeDataPath(config.dataDir, `games/${version.gameId}/${version.version}`), config)).reduce((sum, f) => sum + f.size, 0); }
    catch { reasons.push('unsafe-or-missing-files'); }
    result.push({ gameId: version.gameId, version: version.version, bytes, resourceCandidate: reasons.length === 0, resourceBlockers: reasons, metadataCandidate: false, metadataBlockers: ['retain-version-identity-manifest-source-and-history'] });
  }
  return { dryRun: true, automaticDeletion: false, candidateBytes: result.filter((v) => v.resourceCandidate).reduce((sum, v) => sum + (v.bytes ?? 0), 0), versions: result };
}
