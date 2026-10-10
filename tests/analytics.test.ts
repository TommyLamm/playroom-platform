import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, users } from '../server/db.js';
import { createApplication } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { passwordHash } from '../server/auth.js';
import { backup, restore, seedDemos } from '../server/maintenance.js';
import { readBackupState } from '../server/operational-state.js';
import type { OperationalAnalytics } from '../shared/analytics.js';

test('admin operational analytics and backup telemetry', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-analytics-'));
  const config = getConfig({ dataDir: path.join(root, 'data'), clientDir: path.join(root, 'none'), production: false });
  const store = openStore(config.dataDir);
  await seedDemos(store, config);
  store.db.insert(users).values({ username: 'operator', password: await passwordHash('operator-password'), role: 'admin', createdAt: new Date().toISOString() }).run();
  const app = await createApplication(config, store);
  t.after(async () => { await app.close(); store.sqlite.close(); await fs.rm(root, { recursive: true, force: true }); });
  type Headers = Record<string, string>;
  const base = { host: new URL(config.platformOrigin).host, origin: config.platformOrigin };
  let remote = 1;
  const req = (url: string, body?: unknown, headers: Headers = {}) => app.platform.inject({ method: body === undefined ? 'GET' : 'POST', url, payload: body as object, headers: { ...base, ...headers }, remoteAddress: `192.0.2.${remote++}` });
  const auth = (response: Awaited<ReturnType<typeof req>>) => ({ cookie: String(response.headers['set-cookie']).split(';')[0], 'x-csrf-token': response.json().csrf });
  const admin = auth(await req('/api/v1/login', { username: 'operator', password: 'operator-password' }));
  const alice = auth(await req('/api/v1/register', { username: 'analytics-alice', password: 'analytics-password' }));
  const bob = auth(await req('/api/v1/register', { username: 'analytics-bob', password: 'analytics-password' }));
  async function open(headers: Headers, game = 'signal-tap') {
    const response = await req(`/api/v1/games/${game}/plays`, { version: '1.2.1', requestId: randomUUID() }, headers);
    assert.equal(response.statusCode, 201, response.body); return response.json().playId as string;
  }
  async function run(headers: Headers, playId: string) {
    const response = await req(`/api/v1/plays/${playId}/runs`, { requestId: randomUUID() }, headers);
    assert.equal(response.statusCode, 201, response.body); return response.json().runId as string;
  }
  const finish = (headers: Headers, id: string, score: unknown) => req(`/api/v1/runs/${id}/finish`, { score }, headers);
  const view = async (days: 7 | 30 = 7) => {
    const response = await req(`/api/v1/admin/analytics?days=${days}`, undefined, admin);
    assert.equal(response.statusCode, 200, response.body); return response.json() as OperationalAnalytics;
  };
  await t.test('only administrators can read aggregates and query inputs are strict', async () => {
    assert.equal((await req('/api/v1/admin/analytics')).statusCode, 401);
    assert.equal((await req('/api/v1/admin/analytics', undefined, alice)).statusCode, 403);
    for (const query of ['days=1', 'days=07', 'days=7&days=30', 'userId=1', 'days=7&gameId=signal-tap'])
      assert.equal((await req(`/api/v1/admin/analytics?${query}`, undefined, admin)).statusCode, 400);
    assert.equal((await view()).submissions.failureRate, null);
    assert.equal((await view()).backup.status, 'never');
  });
  const alicePlay = await open(alice);
  const aliceRun = await run(alice, alicePlay);
  await t.test('only owned authenticated attempts count; duplicates, rejections and retries count individually', async () => {
    assert.equal((await finish({}, aliceRun, 5)).statusCode, 401);
    assert.equal((await finish(bob, aliceRun, 5)).statusCode, 404);
    assert.equal((await finish(alice, randomUUID(), 5)).statusCode, 404);
    assert.equal((await finish({ ...alice, 'x-csrf-token': '' }, aliceRun, 5)).statusCode, 403);
    assert.equal((await finish({ ...alice, origin: config.gamesOrigin }, aliceRun, 5)).statusCode, 403);
    assert.equal((await view()).submissions.attempts, 0);
    assert.equal((await finish(alice, aliceRun, -1)).statusCode, 400);
    assert.equal((await finish(alice, aliceRun, 5)).statusCode, 200);
    assert.equal((await finish(alice, aliceRun, 5)).statusCode, 200);
    assert.equal((await finish(alice, aliceRun, 6)).statusCode, 409);
    const data = await view();
    assert.deepEqual([data.submissions.success, data.submissions.rejected, data.submissions.attempts], [2, 2, 4]);
    assert.equal(data.submissions.failureRate, .5);
    assert.equal(data.totals.completedRuns, 1);
  });
  await t.test('server errors are persisted and retry outcomes remain visible', async () => {
    const id = await run(alice, alicePlay);
    store.sqlite.exec(`CREATE TEMP TRIGGER fail_result BEFORE UPDATE ON runs WHEN NEW.id='${id}' BEGIN SELECT RAISE(ABORT,'test failure'); END`);
    assert.equal((await finish(alice, id, 10)).statusCode, 500);
    store.sqlite.exec('DROP TRIGGER fail_result');
    assert.equal((await finish(alice, id, 10)).statusCode, 200);
    const data = await view();
    assert.equal(data.submissions.serverError, 1);
    assert.equal(data.submissions.success, 3);
    assert.equal(data.totals.completedRuns, 2);
  });
  await t.test('telemetry errors do not change successful gameplay responses', async () => {
    const id = await run(alice, alicePlay);
    store.sqlite.exec("CREATE TEMP TRIGGER fail_metric BEFORE INSERT ON score_submission_metrics BEGIN SELECT RAISE(ABORT,'test metric failure'); END");
    assert.equal((await finish(alice, id, 12)).statusCode, 200);
    store.sqlite.exec('DROP TRIGGER fail_metric');
    assert.equal((await view()).totals.completedRuns, 3);
  });
  await t.test('UTC windows count recent completions of older plays and retain unlisted history', async () => {
    const now = Date.now();
    const today = new Date();
    const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6);
    const bobPlay = await open(bob);
    const bobRun = await run(bob, bobPlay);
    assert.equal((await finish(bob, bobRun, 25)).statusCode, 200);
    store.sqlite.prepare('UPDATE plays SET started_at=?,last_heartbeat_at=? WHERE id=?').run(start - 86400000, start - 86400000, bobPlay);
    const colorPlay = await open(alice, 'color-hunt');
    await open(bob, 'color-hunt');
    store.sqlite.prepare('UPDATE games SET published=0 WHERE id=?').run('color-hunt');
    // A play outside 7 days remains visible in 30 days but its completion is outside both.
    const old = await open(alice);
    const oldRun = await run(alice, old);
    await finish(alice, oldRun, 8);
    store.sqlite.prepare('UPDATE plays SET started_at=?,last_heartbeat_at=? WHERE id=?').run(start - 86400000, start - 86400000, old);
    store.sqlite.prepare('UPDATE runs SET finished_at=? WHERE id=?').run(now - 31 * 86400000, oldRun);
    store.sqlite.prepare("INSERT INTO score_submission_metrics(day,game_id,outcome,count) VALUES (?,?,?,?)").run(new Date(start - 86400000).toISOString().slice(0,10), 'signal-tap', 'rejected', 7);
    const data = await view();
    assert.equal(data.window.start, new Date(start).toISOString());
    assert.equal(data.window.timezone, 'UTC');
    assert.equal(data.totals.activePlayers, 2);
    assert.equal(data.totals.opens, 3);
    assert.equal(data.totals.completedRuns, 4);
    assert.deepEqual(data.games.map((game) => [game.gameId, game.opens, game.completedRuns]), [['color-hunt', 2, 0], ['signal-tap', 1, 4]]);
    assert.equal(data.games[0].published, false);
    assert.equal(data.games[0].name, '色彩尋蹤');
    assert.equal(data.submissions.daily.length, 7);
    const longer = await view(30);
    assert.equal(longer.totals.opens, 5);
    assert.equal(longer.submissions.rejected - data.submissions.rejected, 7);
    const serialized = JSON.stringify(data);
    for (const secret of ['analytics-alice', 'analytics-bob', 'tokenHash', 'session_hash', 'password', config.dataDir]) assert.ok(!serialized.includes(secret));
    assert.ok(colorPlay);
  });
  await t.test('storage reports regular game bytes and shares a bounded cache', async () => {
    const first = await view();
    assert.ok(first.storage.dataBytes !== null && first.storage.dataBytes > 0);
    assert.ok(first.storage.gameBytes !== null && first.storage.gameBytes > 0);
    assert.ok(first.storage.totalBytes !== null && first.storage.totalBytes > 0);
    assert.ok(first.storage.availableBytes !== null && first.storage.availableBytes >= 0);
    assert.equal((await view(30)).storage.measuredAt, first.storage.measuredAt);
  });
  await t.test('backup only becomes successful after completion, preserves prior success on failure and normalizes restored snapshots', async () => {
    const destination = path.join(root, 'snapshot');
    const pending = backup(config.dataDir, destination);
    assert.equal(readBackupState(store.sqlite).status, 'running');
    await pending;
    const success = readBackupState(store.sqlite);
    assert.equal(success.status, 'success');
    assert.ok(success.lastSuccessAt);
    assert.equal(success.finishedAt, success.lastSuccessAt);
    await assert.rejects(backup(config.dataDir, destination), /must not exist/);
    const failed = readBackupState(store.sqlite);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.lastSuccessAt, success.lastSuccessAt);
    assert.ok(!JSON.stringify(failed).includes(root));
    const second = path.join(root, 'snapshot-2');
    await backup(config.dataDir, second);
    const restoredDir = path.join(root, 'restored');
    await restore(second, restoredDir);
    const restored = openStore(restoredDir);
    try {
      const state = readBackupState(restored.sqlite);
      assert.equal(state.status, 'failed');
      assert.equal(state.lastSuccessAt, success.lastSuccessAt);
      assert.match(state.error!, /快照/);
      assert.equal((restored.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n, 0);
      assert.equal((restored.sqlite.prepare('SELECT SUM(count) AS n FROM score_submission_metrics').get() as { n: number }).n,
        (store.sqlite.prepare('SELECT SUM(count) AS n FROM score_submission_metrics').get() as { n: number }).n);
    } finally { restored.sqlite.close(); }
    assert.equal((await view()).backup.status, 'success');
  });
});

test('analytics storage failures show unknown and schema4 backups remain compatible', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-storage-'));
  const actual = path.join(root, 'data');
  const store = openStore(actual);
  const config = getConfig({ dataDir: path.join(root, 'missing'), clientDir: path.join(root, 'none'), production: false });
  store.db.insert(users).values({ username: 'admin-storage', password: await passwordHash('storage-password'), role: 'admin', createdAt: new Date().toISOString() }).run();
  const app = await createApplication(config, store);
  t.after(async () => { await app.close(); store.sqlite.close(); await fs.rm(root, { recursive: true, force: true }); });
  const login = await app.platform.inject({ method: 'POST', url: '/api/v1/login', payload: { username: 'admin-storage', password: 'storage-password' }, headers: { host: new URL(config.platformOrigin).host, origin: config.platformOrigin } });
  const response = await app.platform.inject({ url: '/api/v1/admin/analytics', headers: { host: new URL(config.platformOrigin).host, cookie: String(login.headers['set-cookie']).split(';')[0] } });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(Object.values(response.json().storage).slice(0,4), [null, null, null, null]);
  store.sqlite.exec('DROP TABLE import_batch_items; DROP TABLE import_batches; DROP TABLE github_owners; ALTER TABLE repositories DROP COLUMN archived; ALTER TABLE repositories DROP COLUMN checked_at; ALTER TABLE repositories DROP COLUMN check_error; ALTER TABLE repositories DROP COLUMN cached_releases; DROP TABLE visitor_events; DROP TABLE operational_state; DROP TABLE score_submission_metrics; DROP TABLE account_settings; PRAGMA user_version=4;');
  await backup(actual, path.join(root, 'legacy-backup'));
  await restore(path.join(root, 'legacy-backup'), path.join(root, 'legacy-restored'));
  const restored = openStore(path.join(root, 'legacy-restored'));
  try {
    assert.equal(restored.sqlite.pragma('user_version', { simple: true }), 10);
    assert.equal(readBackupState(restored.sqlite).status, 'never');
  } finally { restored.sqlite.close(); }
});
