import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApplication } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { openStore } from '../server/db.js';
import { backup, restore, seedDemos } from '../server/maintenance.js';

test('player library: private recent games, synced favorites, migrations and backups', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-library-'));
  const config = getConfig({ dataDir: path.join(root, 'data'), clientDir: path.join(root, 'none'), production: false });
  const store = openStore(config.dataDir);
  await seedDemos(store, config);
  const app = await createApplication(config, store);
  t.after(async () => {
    await app.close();
    store.sqlite.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  type Headers = Record<string, string>;
  let address = 1;
  const req = (url: string, body?: unknown, headers: Headers = {}) => app.platform.inject({
    method: body === undefined ? 'GET' : 'POST', url, payload: body as object,
    headers: { host: new URL(config.platformOrigin).host, origin: config.platformOrigin, ...headers },
    remoteAddress: `192.0.2.${address++}`,
  });
  const credentials = { username: 'library_alice', password: 'player-library-password' };
  const signIn = async (url: string, details = credentials): Promise<Headers> => {
    const response = await req(url, details);
    assert.ok([200, 201].includes(response.statusCode), response.body);
    return { cookie: String(response.headers['set-cookie']).split(';')[0], 'x-csrf-token': response.json().csrf };
  };
  const alice = await signIn('/api/v1/register');
  const bob = await signIn('/api/v1/register', { ...credentials, username: 'library_bob' });
  const aliceId = (store.sqlite.prepare('SELECT id FROM users WHERE username=?').get(credentials.username) as { id: number }).id;
  const bobId = (store.sqlite.prepare('SELECT id FROM users WHERE username=?').get('library_bob') as { id: number }).id;
  const library = async (headers = alice) => {
    const response = await req('/api/v1/me/library', undefined, headers);
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const favorite = (id: string, value: boolean, headers = alice) => req(`/api/v1/me/favorites/${id}`, { favorite: value }, headers);

  await t.test('auth, CSRF, Origin and strict inputs protect account-only endpoints', async () => {
    assert.equal((await req('/api/v1/me/library')).statusCode, 401);
    assert.equal((await favorite('signal-tap', true, {})).statusCode, 401);
    for (const query of ['username=library_bob', `userId=${bobId}`, 'page=1'])
      assert.equal((await req(`/api/v1/me/library?${query}`, undefined, alice)).statusCode, 400);
    assert.equal((await favorite('signal-tap', true, { ...alice, 'x-csrf-token': 'wrong' })).statusCode, 403);
    assert.equal((await favorite('signal-tap', true, { ...alice, origin: config.gamesOrigin })).statusCode, 403);
    for (const body of [{ favorite: 1 }, { favorite: true, userId: bobId }, {}])
      assert.equal((await req('/api/v1/me/favorites/signal-tap', body, alice)).statusCode, 400);
    assert.equal((await favorite('missing-game', true)).statusCode, 404);
    assert.equal((await favorite('Bad_ID', true)).statusCode, 400);
    assert.deepEqual(await library(), { recent: [], favorites: [] });
  });
  await t.test('favorites are idempotent, preserve first creation, and synchronize across sessions', async () => {
    assert.deepEqual((await favorite('signal-tap', true)).json(), { favorite: true });
    const first = (await library()).favorites[0];
    assert.equal(first.gameId, 'signal-tap');
    assert.equal((await favorite('signal-tap', true)).statusCode, 200);
    assert.deepEqual((await library()).favorites, [first]);
    assert.deepEqual((await library(bob)).favorites, []);
    const otherDevice = await signIn('/api/v1/login');
    assert.deepEqual((await library(otherDevice)).favorites, [first]);
    assert.equal((await favorite('color-hunt', true, otherDevice)).statusCode, 200);
    store.sqlite.prepare('UPDATE favorites SET created_at=? WHERE user_id=? AND game_id=?').run(1000, aliceId, 'signal-tap');
    store.sqlite.prepare('UPDATE favorites SET created_at=? WHERE user_id=? AND game_id=?').run(2000, aliceId, 'color-hunt');
    assert.deepEqual((await library()).favorites.map((item: { gameId: string }) => item.gameId), ['color-hunt', 'signal-tap']);
    store.sqlite.prepare('UPDATE favorites SET created_at=2000 WHERE user_id=?').run(aliceId);
    assert.deepEqual((await library()).favorites.map((item: { gameId: string }) => item.gameId), ['color-hunt', 'signal-tap']);
    await favorite('signal-tap', false, bob);
    assert.equal((await library()).favorites.length, 2);
    assert.deepEqual((await favorite('signal-tap', false)).json(), { favorite: false });
    assert.deepEqual((await favorite('signal-tap', false)).json(), { favorite: false });
    assert.deepEqual((await library(otherDevice)).favorites.map((item: { gameId: string }) => item.gameId), ['color-hunt']);
  });
  const addPlay = (userId: number, id: string, time: number, heartbeat = time) => {
    store.sqlite.prepare(`INSERT INTO plays
      (id,user_id,session_hash,request_id,game_id,version,game_name,started_at,last_heartbeat_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), userId, 'test-session', randomUUID(), id, '1.2.1', id, time, heartbeat);
  };
  await t.test('recent games deduplicate opens, order deterministically, cap at 12 and isolate accounts', async () => {
    const visit = await req('/api/v1/games/signal-tap/plays', { version: '1.2.1', requestId: randomUUID() }, bob);
    assert.equal(visit.statusCode, 201);
    assert.equal((await library(bob)).recent[0].gameId, 'signal-tap');
    for (let i = 0; i < 15; i++) {
      const id = `recent-${String(i).padStart(2, '0')}`;
      store.sqlite.prepare('INSERT INTO games (id,published) VALUES (?,1)').run(id);
      addPlay(aliceId, id, 10000 + i);
    }
    addPlay(aliceId, 'recent-01', 50000);
    addPlay(aliceId, 'recent-02', 50000);
    // Heartbeats affect activity estimates, but recent games track when a game was opened.
    addPlay(aliceId, 'recent-00', 1, 90000);
    const recent = (await library()).recent;
    assert.equal(recent.length, 12);
    assert.deepEqual(recent.slice(0, 3).map((item: { gameId: string }) => item.gameId), ['recent-01', 'recent-02', 'recent-14']);
    assert.equal(recent[0].lastPlayedAt, new Date(50000).toISOString());
    assert.equal(new Set(recent.map((item: { gameId: string }) => item.gameId)).size, 12);
    assert.ok(!recent.some((item: { gameId: string }) => item.gameId === 'recent-00'));
    assert.deepEqual((await library(bob)).recent.map((item: { gameId: string }) => item.gameId), ['signal-tap']);
  });
  await t.test('unlisted games are hidden, cannot be added, and can still be removed', async () => {
    addPlay(aliceId, 'color-hunt', 60000);
    store.sqlite.prepare('UPDATE games SET published=0 WHERE id IN (?,?)').run('color-hunt', 'recent-01');
    const hidden = await library();
    assert.deepEqual(hidden.favorites, []);
    assert.ok(!hidden.recent.some((item: { gameId: string }) => ['color-hunt', 'recent-01'].includes(item.gameId)));
    assert.equal((await favorite('color-hunt', true)).statusCode, 404);
    assert.equal((await favorite('color-hunt', false)).statusCode, 200);
    store.sqlite.prepare('UPDATE games SET published=1 WHERE id IN (?,?)').run('color-hunt', 'recent-01');
    assert.deepEqual((await library()).favorites, []);
    await favorite('color-hunt', true);
  });
  await t.test('schema 4 backup preserves favorites and records; schema 3 restores migrate without losing data', async () => {
    const backupDir = path.join(root, 'backup');
    await backup(config.dataDir, backupDir);
    const restoredDir = path.join(root, 'restored');
    await restore(backupDir, restoredDir);
    const recovered = openStore(restoredDir);
    const snapshots = Object.fromEntries(['users', 'games', 'plays', 'favorites'].map((table) => [table, store.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
    try {
      assert.equal(recovered.sqlite.pragma('user_version', { simple: true }), 10);
      for (const [table, rows] of Object.entries(snapshots))
        assert.deepEqual(recovered.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), rows);
      assert.equal((recovered.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n, 0);
      recovered.sqlite.exec('DROP TABLE import_batch_items; DROP TABLE import_batches; DROP TABLE github_owners; ALTER TABLE repositories DROP COLUMN archived; ALTER TABLE repositories DROP COLUMN checked_at; ALTER TABLE repositories DROP COLUMN check_error; ALTER TABLE repositories DROP COLUMN cached_releases; DROP TABLE visitor_events; DROP TABLE account_settings; DROP TABLE score_submission_metrics; DROP TABLE operational_state; DROP TABLE favorites; PRAGMA user_version=3;');
      recovered.sqlite.prepare('INSERT INTO sessions (token_hash,user_id,csrf,expires_at) VALUES (?,?,?,?)').run('v3-session', aliceId, 'v3-csrf', Date.now() + 100000);
    } finally { recovered.sqlite.close(); }
    const legacyBackup = path.join(root, 'v3-backup');
    await backup(restoredDir, legacyBackup);
    await restore(legacyBackup, path.join(root, 'v3-restored'));
    const restoredV3 = openStore(path.join(root, 'v3-restored'));
    try {
      assert.equal(restoredV3.sqlite.pragma('user_version', { simple: true }), 10);
      assert.deepEqual(restoredV3.sqlite.prepare('SELECT * FROM plays ORDER BY rowid').all(), snapshots.plays);
    } finally { restoredV3.sqlite.close(); }
    const migrated = openStore(restoredDir);
    try {
      assert.equal(migrated.sqlite.pragma('user_version', { simple: true }), 10);
      for (const table of ['users', 'games', 'plays'])
        assert.deepEqual(migrated.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), snapshots[table]);
      assert.deepEqual(migrated.sqlite.prepare('SELECT token_hash,csrf FROM sessions').get(), { token_hash: 'v3-session', csrf: 'v3-csrf' });
      assert.deepEqual(migrated.sqlite.prepare('SELECT * FROM favorites').all(), []);
      assert.deepEqual(migrated.sqlite.pragma('foreign_key_check'), []);
    } finally { migrated.sqlite.close(); }
  });
  await t.test('per-account favorite limits span sessions, while another account remains independent', async () => {
    let limited = false;
    for (let i = 0; i < 65; i++) {
      const response = await favorite('signal-tap', false);
      if (response.statusCode === 429) { limited = true; break; }
      assert.equal(response.statusCode, 200, response.body);
    }
    assert.ok(limited);
    const freshSession = await signIn('/api/v1/login');
    assert.equal((await favorite('signal-tap', false, freshSession)).statusCode, 429);
    assert.equal((await favorite('signal-tap', true, bob)).statusCode, 200);
    await req('/api/v1/logout', {}, freshSession);
    assert.equal((await req('/api/v1/me/library', undefined, freshSession)).statusCode, 401);
    store.sqlite.prepare('UPDATE sessions SET expires_at=0').run();
    assert.equal((await req('/api/v1/me/library', undefined, bob)).statusCode, 401);
  });
});
