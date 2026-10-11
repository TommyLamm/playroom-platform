import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import lockfile from 'proper-lockfile';
import { eq } from 'drizzle-orm';
import { openStore, installations, games, versions, jobs, repositories, previews, users } from '../server/db.js';
import { getConfig } from '../server/config.js';
import { installVersion, recoverInstallations, repairInstallation, diagnoseInstallation } from '../server/installation-service.js';
import { importDiagnosis, repairImport, versionRetention, withImportMaintenance, withImportRepair } from '../server/import-maintenance.js';
import { publish } from '../server/library.js';
import { backup, restore } from '../server/maintenance.js';
import { testManifest } from './helpers.js';
import { createApplication } from '../server/app.js';

const source = { repositoryId: 1, releaseId: 102, assetId: 1102, releaseTag: 'v2.0.0', sha256: 'b'.repeat(64) };
async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-recovery-'));
  const config = getConfig({ dataDir: path.join(root, 'data'), clientDir: path.join(root, 'none'), production: false });
  let store = openStore(config.dataDir);
  store.db.insert(repositories).values({ id: 1, fullName: 'example/game', createdAt: new Date().toISOString() }).run();
  const jobId = randomUUID();
  const stage = path.join(config.dataDir, 'staging', jobId, 'extracted');
  const manifest = { ...testManifest, version: '2.0.0' };
  async function content(directory: string, version = '2.0.0') {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'game.json'), JSON.stringify({ ...testManifest, version }));
    await fs.writeFile(path.join(directory, 'index.html'), '<html>immutable game</html>');
    await fs.writeFile(path.join(directory, 'cover.png'), 'cover');
  }
  const oldStage = path.join(config.dataDir, 'staging', 'old');
  await content(oldStage, '1.0.0');
  await installVersion(store, config, oldStage, testManifest, { ...source, releaseId: 101, assetId: 1101, releaseTag: 'v1.0.0', sha256: 'a'.repeat(64) });
  publish(store, testManifest.id, '1.0.0');
  store.db.insert(jobs).values({ id: jobId, repositoryId: 1, releaseId: 102, status: 'running', phase: 'validating', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).run();
  await content(stage);
  t.after(async () => { if (store.sqlite.open) store.sqlite.close(); await fs.rm(root, { recursive: true, force: true }); });
  const journal = () => store.db.select().from(installations).where(eq(installations.jobId, jobId)).get()!;
  const installInterrupted = async (phase: string) => assert.rejects(installVersion(store, config, stage, manifest, source, { jobId, checkpoint(p) { if (p === phase) throw new Error('injected interruption'); } }), /injected interruption/);
  return { root, config, stage, manifest, jobId, journal, installInterrupted, content, get store() { return store; }, reopen() { if (store.sqlite.open) store.sqlite.close(); store = openStore(config.dataDir); return store; } };
}

for (const phase of ['prepared', 'moved', 'registered']) test(`SIGKILL at ${phase}: startup restores the import once without publishing or changing the active game`, async (t) => {
  const f = await fixture(t);
  f.store.sqlite.close();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('tests/fixtures/interrupt-install.ts'), f.config.dataDir, f.jobId, phase], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '', killed = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Checkpoint timeout: ${output} ${errors}`)); }, 15000);
    child.stdout.on('data', (chunk) => { output += String(chunk); if (!killed && output.includes(`checkpoint:${phase}`)) { killed = true; child.kill('SIGKILL'); } });
    child.stderr.on('data', (chunk) => { errors += String(chunk); });
    child.on('error', reject);
    child.on('exit', () => { clearTimeout(timer); killed ? resolve() : reject(new Error(errors || 'Child exited before checkpoint')); });
  });
  const store = f.reopen();
  const app = await createApplication(f.config, store);
  await app.close();
  await recoverInstallations(store, f.config);
  assert.equal(f.journal().state, 'completed');
  assert.equal(store.db.select().from(versions).all().length, 2);
  assert.equal(store.db.select().from(jobs).where(eq(jobs.id, f.jobId)).get()!.status, 'completed');
  assert.deepEqual(store.db.select().from(games).get(), { id: testManifest.id, repositoryId: 1, activeVersion: '1.0.0', published: true });
  assert.equal(store.db.select().from(versions).where(eq(versions.version, '2.0.0')).get()!.publishedAt, null);
});

test('recovery can itself stop after move and registration, then resume idempotently', async (t) => {
  const f = await fixture(t); await f.installInterrupted('prepared');
  for (const stop of ['moved', 'registered']) {
    await assert.rejects(repairInstallation(f.store, f.config, f.journal().id, (phase) => { if (phase === stop) throw new Error('recovery stopped'); }), /recovery stopped/);
    f.reopen();
  }
  await recoverInstallations(f.store, f.config); await recoverInstallations(f.store, f.config);
  assert.equal(f.journal().state, 'completed');
  assert.equal(f.store.db.select().from(versions).all().length, 2);
});

test('corrupt unregistered content is quarantined; interrupted quarantine resumes and remains private', async (t) => {
  const f = await fixture(t); await f.installInterrupted('moved');
  const final = path.join(f.config.dataDir, 'games', testManifest.id, '2.0.0');
  await fs.writeFile(path.join(final, 'index.html'), 'corrupted');
  const report = await diagnoseInstallation(f.store, f.config, f.journal());
  assert.equal(report.action, 'quarantine');
  await assert.rejects(repairInstallation(f.store, f.config, f.journal().id, (phase) => { if (phase === 'quarantine-moved') throw new Error('stopped'); }), /stopped/);
  f.reopen(); await recoverInstallations(f.store, f.config); await recoverInstallations(f.store, f.config);
  assert.equal(f.journal().state, 'quarantined');
  assert.equal(f.store.db.select().from(versions).all().length, 1);
  assert.equal(await fs.readFile(path.join(f.config.dataDir, 'quarantine', f.journal().id, 'final', 'index.html'), 'utf8'), 'corrupted');
  const reason = JSON.parse(await fs.readFile(path.join(f.config.dataDir, 'quarantine', f.journal().id, 'reason.json'), 'utf8'));
  assert.equal(reason.jobId, f.jobId); assert.match(reason.reason, /hashes/);
  const app = await createApplication(f.config, f.store);
  try {
    const headers = { host: new URL(f.config.gamesOrigin).host };
    assert.equal((await app.assets.inject({ url: '/games/test-game/1.0.0/index.html', headers })).statusCode, 200);
    assert.equal((await app.assets.inject({ url: '/games/test-game/2.0.0/index.html', headers })).statusCode, 404);
    assert.equal((await app.assets.inject({ url: `/quarantine/${f.journal().id}/final/index.html`, headers })).statusCode, 404);
  } finally { await app.close(); }
});

test('both final and staging artifacts are preserved in quarantine; no destination is overwritten', async (t) => {
  const f = await fixture(t); await f.installInterrupted('prepared');
  const final = path.join(f.config.dataDir, 'games', testManifest.id, '2.0.0');
  await f.content(final); await fs.writeFile(path.join(final, 'index.html'), 'unknown conflicting final');
  await recoverInstallations(f.store, f.config);
  const root = path.join(f.config.dataDir, 'quarantine', f.journal().id);
  assert.equal(await fs.readFile(path.join(root, 'final', 'index.html'), 'utf8'), 'unknown conflicting final');
  assert.equal(await fs.readFile(path.join(root, 'staging', 'index.html'), 'utf8'), '<html>immutable game</html>');
  assert.equal(f.journal().state, 'quarantined');
});

test('registered identity conflicts and damaged registered files are blocked, never overwritten or isolated', async (t) => {
  const f = await fixture(t); await f.installInterrupted('registered');
  const final = path.join(f.config.dataDir, 'games', testManifest.id, '2.0.0');
  f.store.db.update(versions).set({ sha256: 'c'.repeat(64) }).where(eq(versions.version, '2.0.0')).run();
  await recoverInstallations(f.store, f.config);
  assert.equal(f.journal().state, 'blocked');
  assert.ok(await fs.stat(final));
  assert.equal(f.store.db.select().from(versions).where(eq(versions.version, '2.0.0')).get()!.sha256, 'c'.repeat(64));
  f.store.db.update(versions).set({ sha256: source.sha256 }).where(eq(versions.version, '2.0.0')).run();
  await fs.writeFile(path.join(final, 'index.html'), 'damage');
  await recoverInstallations(f.store, f.config);
  assert.equal(f.journal().state, 'blocked');
  assert.equal(await fs.readFile(path.join(final, 'index.html'), 'utf8'), 'damage');
});

test('traversal and symlink ancestors block recovery without touching outside files', async (t) => {
  const f = await fixture(t); await f.installInterrupted('prepared');
  const original = f.journal().stagingPath;
  f.store.db.update(installations).set({ stagingPath: '../../outside' }).where(eq(installations.id, f.journal().id)).run();
  await recoverInstallations(f.store, f.config); assert.equal(f.journal().state, 'blocked');
  f.store.db.update(installations).set({ stagingPath: original }).where(eq(installations.id, f.journal().id)).run();
  const outside = path.join(f.root, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'sentinel'), 'untouched');
  const gameRoot = path.join(f.config.dataDir, 'games', testManifest.id);
  await fs.rename(gameRoot, gameRoot + '-saved');
  await fs.symlink(outside, gameRoot, process.platform === 'win32' ? 'junction' : 'dir');
  await recoverInstallations(f.store, f.config); assert.equal(f.journal().state, 'blocked');
  assert.deepEqual(await fs.readdir(outside), ['sentinel']);
  await fs.unlink(gameRoot); await fs.rename(gameRoot + '-saved', gameRoot);
});

test('unknown artifacts have read-only diagnosis and explicitly repeatable quarantine', async (t) => {
  const f = await fixture(t);
  const unknown = path.join(f.config.dataDir, 'games', 'unknown-game', '3.0.0'); await f.content(unknown, '3.0.0');
  const before = f.store.sqlite.serialize();
  const diagnosis = await importDiagnosis(f.store, f.config);
  const artifact = diagnosis.artifacts.find((a) => a.path === 'games/unknown-game/3.0.0')!;
  assert.equal(artifact.action, 'quarantine'); assert.deepEqual(f.store.sqlite.serialize(), before);
  const first = await repairImport(f.store, f.config, artifact.id);
  assert.deepEqual(await repairImport(f.store, f.config, artifact.id), first);
  await assert.rejects(repairImport(f.store, f.config, 'orphan:games/test-game/1.0.0'), /protected/);
  await assert.rejects(repairImport(f.store, f.config, 'orphan:staging/../../escape'), /Unsafe/);
});

test('a destination appearing after durable intent cannot replace another directory', async (t) => {
  const f = await fixture(t);
  const destination = path.join(f.config.dataDir, 'games', testManifest.id, '2.0.0');
  await assert.rejects(installVersion(f.store, f.config, f.stage, f.manifest, source, { jobId: f.jobId, async checkpoint(phase) { if (phase === 'prepared') { await fs.mkdir(destination); await fs.writeFile(path.join(destination, 'marker'), 'preserved'); } } }), /no files overwritten/);
  assert.equal(await fs.readFile(path.join(destination, 'marker'), 'utf8'), 'preserved');
  assert.ok(await fs.stat(f.stage));
});

test('files with symlinks or hard links are never trusted for registration or backup', async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside-file'); await fs.writeFile(outside, 'preserved');
  await fs.link(outside, path.join(f.stage, 'linked.txt'));
  await assert.rejects(installVersion(f.store, f.config, f.stage, f.manifest, source, { jobId: f.jobId }), /hard links/);
  await fs.unlink(path.join(f.stage, 'linked.txt'));
  await f.installInterrupted('prepared');
  const outsideDirectory = path.join(f.root, 'outside-directory'); await fs.mkdir(outsideDirectory);
  await fs.writeFile(path.join(outsideDirectory, 'sentinel'), 'untouched');
  await fs.symlink(outsideDirectory, path.join(f.stage, 'linked-directory'), process.platform === 'win32' ? 'junction' : 'dir');
  await recoverInstallations(f.store, f.config);
  assert.equal(f.journal().state, 'quarantined');
  assert.equal(await fs.readFile(outside, 'utf8'), 'preserved');
  assert.equal(f.store.db.select().from(versions).all().length, 1);
  await fs.link(outside, path.join(f.config.dataDir, 'games', testManifest.id, '1.0.0', 'linked.txt'));
  await assert.rejects(backup(f.config.dataDir, path.join(f.root, 'bad-backup')), /hard links/);
});

test('maintenance diagnosis and repair refuse the live data-directory lock and diagnosis opens read-only', async (t) => {
  const f = await fixture(t);
  const unlock = await lockfile.lock(f.config.dataDir, { realpath: false, lockfilePath: path.join(f.config.dataDir, '.platform.lock') });
  try {
    await assert.rejects(withImportMaintenance(f.config, async () => true), { code: 'ELOCKED' });
    await assert.rejects(withImportRepair(f.config, async () => true), { code: 'ELOCKED' });
  } finally { await unlock(); }
  const result = await withImportMaintenance(f.config, async (store) => {
    assert.equal(store.sqlite.readonly, true);
    return importDiagnosis(store, f.config);
  });
  assert.ok(result.installations.length);
});

test('retention reports space only; published history, previews, tasks, career, saves and backup block resources while all metadata stays', async (t) => {
  const f = await fixture(t); await installVersion(f.store, f.config, f.stage, f.manifest, source, { jobId: f.jobId });
  let report = await versionRetention(f.store, f.config);
  assert.equal(report.versions.find((v) => v.version === '1.0.0')!.resourceCandidate, false);
  assert.equal(report.versions.find((v) => v.version === '2.0.0')!.resourceCandidate, true);
  assert.ok(report.candidateBytes > 0); assert.ok(report.versions.every((v) => !v.metadataCandidate));
  f.store.db.insert(previews).values({ tokenHash: 'grant', gameId: testManifest.id, version: '2.0.0', expiresAt: Date.now() + 60000 }).run();
  report = await versionRetention(f.store, f.config); assert.deepEqual(report.versions[1].resourceBlockers, ['valid-preview']);
  f.store.db.delete(previews).run();
  f.store.db.insert(users).values({ id: 1, username: 'player', password: 'fixture' }).run();
  f.store.sqlite.prepare('INSERT INTO plays(id,user_id,session_hash,request_id,game_id,version,game_name,started_at,last_heartbeat_at) VALUES(?,1,?,?,?,?,?,1,1)').run('play', 'session', 'request', testManifest.id, '2.0.0', 'Test');
  f.store.sqlite.prepare('INSERT INTO cloud_saves(user_id,game_id,data,revision,format_version,game_version,updated_at,request_id) VALUES(1,?,\'{}\',1,1,?,\'now\',\'save\')').run(testManifest.id, '2.0.0');
  f.store.sqlite.prepare("INSERT INTO operational_state VALUES('backup',?)").run(JSON.stringify({ status: 'running' }));
  report = await versionRetention(f.store, f.config);
  assert.deepEqual(report.versions[1].resourceBlockers, ['career-and-leaderboard', 'save-history', 'backup-running']);
  assert.equal(report.candidateBytes, 0);
});

test('backup during each installation boundary contains only complete registered files and restores without staging', async (t) => {
  const f = await fixture(t);
  for (const stop of ['prepared', 'moved', 'registered']) {
    if (stop === 'prepared') await f.installInterrupted(stop);
    else await assert.rejects(repairInstallation(f.store, f.config, f.journal().id, (phase) => { if (phase === stop) throw new Error('stop'); }), /stop/);
    const destination = path.join(f.root, 'backup-' + stop);
    await backup(f.config.dataDir, destination);
    await assert.rejects(fs.stat(path.join(destination, 'staging')), /ENOENT/);
    await assert.rejects(fs.stat(path.join(destination, 'quarantine')), /ENOENT/);
    const restoredDir = path.join(f.root, 'restored-' + stop); await restore(destination, restoredDir);
    const restored = openStore(restoredDir);
    try {
      await recoverInstallations(restored, { ...f.config, dataDir: restoredDir });
      assert.equal(restored.db.select().from(versions).all().length, stop === 'registered' ? 2 : 1);
      assert.ok(restored.db.select().from(installations).all().every((i) => i.state === 'completed'));
      assert.equal(restored.db.select().from(games).get()!.activeVersion, '1.0.0');
    } finally { restored.sqlite.close(); }
  }
});
