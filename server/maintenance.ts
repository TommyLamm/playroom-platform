import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import lockfile from 'proper-lockfile';
import { z } from 'zod';
import { openStore, versions, type Store } from './db.js';
import { fileHash, installVersion, publish } from './library.js';
import { manifestSchema, isSafePath } from '../shared/manifest.js';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { recordBackupStart, recordBackupEnd, normalizeBackupSnapshot } from './operational-state.js';

async function filesIn(root: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fsp.readdir(path.join(root, prefix), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Backup does not support symbolic links');
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!isSafePath(name)) throw new Error('Unsafe backup path');
    if (entry.isDirectory()) result.push(...(await filesIn(root, name)));
    else if (entry.isFile()) result.push(name);
  }
  return result;
}

export async function backup(dataDir: string, destination: string) {
  dataDir = path.resolve(dataDir);
  destination = path.resolve(destination);
  if (!fs.existsSync(path.join(dataDir, 'platform.sqlite')))
    throw new Error('No platform database found');
  const source = new Database(path.join(dataDir, 'platform.sqlite'));
  source.pragma('busy_timeout = 5000');
  let startedAt: string | undefined;
  // Telemetry must not prevent older-schema backups or a valid backup operation.
  try { startedAt = recordBackupStart(source); } catch { /* optional operational state */ }
  try {
    if (destination === dataDir || destination.startsWith(dataDir + path.sep))
      throw new Error('Backup destination must be outside DATA_DIR');
    if (fs.existsSync(destination)) throw new Error('Backup destination must not exist');
    await fsp.mkdir(destination, { recursive: true });
    await source.backup(path.join(destination, 'platform.sqlite'));
    const snapshot = new Database(path.join(destination, 'platform.sqlite'));
    try {
      snapshot.exec('DELETE FROM sessions; DELETE FROM previews;');
      normalizeBackupSnapshot(snapshot);
      snapshot
        .prepare(
          "UPDATE import_jobs SET status='failed', phase='interrupted', error='由備份還原，請重新匯入' WHERE status IN ('queued','running')",
        )
        .run();
      const records = snapshot.prepare('SELECT game_id, version, manifest FROM versions').all() as {
        game_id: string;
        version: string;
        manifest: string;
      }[];
      for (const record of records) {
        const manifest = manifestSchema.parse(JSON.parse(record.manifest));
        if (manifest.id !== record.game_id || manifest.version !== record.version)
          throw new Error('Version metadata is inconsistent');
        const relative = path.join('games', manifest.id, manifest.version);
        await fsp.cp(path.join(dataDir, relative), path.join(destination, relative), {
          recursive: true,
          errorOnExist: true,
          force: false,
          dereference: false,
        });
      }
      snapshot.pragma('wal_checkpoint(TRUNCATE)');
      snapshot.pragma('journal_mode=DELETE');
    } finally {
      snapshot.close();
    }
    for (const suffix of ['-wal', '-shm'])
      await fsp.rm(path.join(destination, 'platform.sqlite' + suffix), { force: true });
    const entries = await filesIn(destination);
    const files = [];
    for (const name of entries)
      files.push({ path: name, sha256: await fileHash(path.join(destination, name)) });
    await fsp.writeFile(
      path.join(destination, 'backup.json'),
      JSON.stringify({ format: 1, createdAt: new Date().toISOString(), files }, null, 2),
    );
    if (startedAt) { try { recordBackupEnd(source, startedAt, true); } catch { /* optional telemetry */ } }
  } catch (error) {
    if (startedAt) { try { recordBackupEnd(source, startedAt, false); } catch { /* preserve original error */ } }
    throw error;
  } finally { source.close(); }
}

const backupSchema = z.object({
  format: z.literal(1),
  createdAt: z.string(),
  files: z.array(
    z.object({ path: z.string().refine(isSafePath), sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  ),
});
export async function restore(source: string, dataDir: string) {
  source = path.resolve(source);
  dataDir = path.resolve(dataDir);
  const manifest = backupSchema.parse(
    JSON.parse(await fsp.readFile(path.join(source, 'backup.json'), 'utf8')),
  );
  if (!manifest.files.some((f) => f.path === 'platform.sqlite'))
    throw new Error('Backup is missing its database');
  if (fs.existsSync(dataDir) && (await fsp.readdir(dataDir)).length)
    throw new Error(
      'Restore requires an empty DATA_DIR; preserve the existing data and restore into a new directory or volume',
    );
  for (const file of manifest.files) {
    const sourceFile = path.join(source, file.path);
    if (!(await fsp.lstat(sourceFile)).isFile() || (await fileHash(sourceFile)) !== file.sha256)
      throw new Error(`Backup checksum mismatch: ${file.path}`);
  }
  const check = new Database(path.join(source, 'platform.sqlite'), { readonly: true });
  try {
    if (check.pragma('integrity_check', { simple: true }) !== 'ok')
      throw new Error('Backup database integrity check failed');
    if (![1, 2, 3, 4, 5, 6, 7, 8, 9].includes(check.pragma('user_version', { simple: true }) as number))
      throw new Error('Unsupported database version');
    for (const row of check.prepare('SELECT manifest FROM versions').all() as {
      manifest: string;
    }[]) {
      const game = manifestSchema.parse(JSON.parse(row.manifest));
      for (const name of [game.entry, game.cover])
        if (!manifest.files.some((f) => f.path === `games/${game.id}/${game.version}/${name}`))
          throw new Error('Backup is missing required game files');
    }
  } finally {
    check.close();
  }
  await fsp.mkdir(dataDir, { recursive: true });
  const unlock = await lockfile.lock(dataDir, {
    realpath: false,
    stale: 30000,
    lockfilePath: path.join(dataDir, '.platform.lock'),
  });
  try {
    if ((await fsp.readdir(dataDir)).some((name) => name !== '.platform.lock'))
      throw new Error('Restore destination is no longer empty');
    for (const file of manifest.files) {
      const destination = path.join(dataDir, file.path);
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.copyFile(path.join(source, file.path), destination, fs.constants.COPYFILE_EXCL);
    }
    const restored = openStore(dataDir);
    restored.sqlite.close();
  } finally {
    await unlock();
  }
}

export async function seedDemos(
  store: Store,
  config: Config,
  exampleDir = path.resolve('examples/starter'),
) {
  for (const mode of ['signal', 'colors']) {
    const base = manifestSchema.parse(
      JSON.parse(await fsp.readFile(path.join(exampleDir, 'game.json'), 'utf8')),
    );
    const manifest =
      mode === 'signal'
        ? base
        : manifestSchema.parse({
            ...base,
            id: 'color-hunt',
            name: '色彩尋蹤',
            description: '相似的色彩裡，藏著一格小小的不同。放慢呼吸，讓眼睛帶你找到答案。',
            tags: ['觀察', '輕鬆玩'],
            instructions:
              '按下開始後，找出並點擊顏色不同的方格。在 20 秒內完成越多次，分數越高。支援滑鼠與觸控。',
          });
    if (
      store.db
        .select()
        .from(versions)
        .all()
        .some((v) => v.gameId === manifest.id && v.version === manifest.version)
    )
      continue;
    const stage = path.join(config.dataDir, 'staging', `demo-${manifest.id}-${Date.now()}`);
    await fsp.mkdir(stage, { recursive: true });
    try {
      await fsp.cp(exampleDir, stage, { recursive: true });
      await fsp.writeFile(path.join(stage, 'game.json'), JSON.stringify(manifest, null, 2));
      await fsp.writeFile(path.join(stage, 'config.json'), JSON.stringify({ mode }));
      if (mode === 'colors')
        await fsp.copyFile(path.join(stage, 'cover-colors.png'), path.join(stage, 'cover.png'));
      const hash = await fileHash(path.join(stage, 'game.json'));
      await installVersion(store, config, stage, manifest, {
        repositoryId: null,
        releaseId: null,
        assetId: null,
        releaseTag: null,
        sha256: hash,
      });
      publish(store, manifest.id, manifest.version);
    } finally {
      await fsp.rm(stage, { recursive: true, force: true });
    }
  }
}
