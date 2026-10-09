import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConfig } from '../server/config.js';
import { createApplication } from '../server/app.js';
import { openStore, users } from '../server/db.js';
import { passwordHash } from '../server/auth.js';
import { seedDemos, backup, restore } from '../server/maintenance.js';
import { fakeGitHub } from './helpers.js';
import { userRoleSchema, type UserRole } from '../shared/account.js';

const gameRoutes = [
  ['GET', '/overview'], ['POST', '/repositories'], ['GET', '/repositories/1/releases'],
  ['POST', '/imports'], ['POST', '/games/signal-tap/preview'], ['POST', '/games/signal-tap/publish'], ['POST', '/games/signal-tap/unpublish'],
  ['GET', '/github-owners'], ['POST', '/github-owners'], ['POST', '/github-owners/example/remove'], ['GET', '/github-owners/example/repositories'],
  ['GET', '/sources'], ['POST', '/repositories/1/state'], ['POST', '/repositories/1/check'],
  ['GET', '/import-batches'], ['POST', '/import-batches'], ['GET', '/import-batches/test'],
  ['POST', '/source-checks'], ['GET', '/source-checks/current'], ['POST', '/publish-batches'], ['POST', '/games/signal-tap/review'],
] as const;
const restrictedRoutes = [
  ['GET', '/analytics'], ['GET', '/visitors'], ['GET', '/visitors/records'],
  ['GET', '/updates'], ['POST', '/updates/check'], ['POST', '/updates'],
  ['GET', '/accounts'], ['POST', '/accounts/1/role'],
] as const;

test('every role enforces management boundaries; game managers can import, preview and publish', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-permissions-'));
  const config = getConfig({ dataDir: path.join(root, 'data'), production: false });
  const store = openStore(config.dataDir);
  const hashed = await passwordHash('permission-test-password');
  for (const role of userRoleSchema.options) store.db.insert(users).values({ username: role, role, password: hashed }).run();
  await seedDemos(store, config);
  const app = await createApplication(config, store, { github: await fakeGitHub(root) });
  t.after(async () => { await app.close(); store.sqlite.close(); await fs.rm(root, { recursive: true, force: true }); });
  const auth = {} as Record<UserRole, Record<string, string>>;
  for (const role of userRoleSchema.options) {
    const login = await app.platform.inject({ method: 'POST', url: '/api/v1/login', headers: { host: new URL(config.platformOrigin).host, origin: config.platformOrigin }, payload: { username: role, password: 'permission-test-password' } });
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().role, role);
    auth[role] = { cookie: String(login.headers['set-cookie']).split(';')[0], 'x-csrf-token': login.json().csrf };
  }
  const request = (role: UserRole | undefined, method: 'GET' | 'POST', route: string, payload: object = {}) => app.platform.inject({ method, url: `/api/v1/admin${route}`, headers: { host: new URL(config.platformOrigin).host, origin: config.platformOrigin, ...(role ? auth[role] : {}) }, ...(method === 'POST' ? { payload } : {}) });
  for (const [method, route] of [...gameRoutes, ...restrictedRoutes]) {
    assert.equal((await request(undefined, method, route)).statusCode, 401, `guest ${route}`);
    assert.equal((await request('player', method, route)).statusCode, 403, `player ${route}`);
  }
  for (const [method, route] of gameRoutes) assert.equal((await request('analyst', method, route)).statusCode, 403, `analyst ${route}`);
  for (const [method, route] of restrictedRoutes) assert.equal((await request('game_manager', method, route)).statusCode, 403, `game manager ${route}`);
  for (const [method, route] of restrictedRoutes.filter(([, route]) => !['/analytics', '/visitors'].includes(route))) assert.equal((await request('analyst', method, route)).statusCode, 403, `analyst ${route}`);
  const analytics = await request('analyst', 'GET', '/analytics');
  assert.equal(analytics.statusCode, 200);
  assert.ok(analytics.json().totals);
  assert.equal('storage' in analytics.json(), false);
  assert.equal('backup' in analytics.json(), false);
  assert.equal((await request('analyst', 'GET', '/visitors')).statusCode, 200);
  const adminAnalytics = await request('admin', 'GET', '/analytics');
  assert.ok(adminAnalytics.json().storage);
  assert.ok(adminAnalytics.json().backup);
  assert.equal((await request('admin', 'GET', '/visitors/records')).statusCode, 200);
  assert.equal((await request('admin', 'GET', '/updates')).statusCode, 200);
  const accounts = (await request('admin', 'GET', '/accounts')).json();
  assert.equal(accounts.total, 4);
  assert.ok(accounts.accounts.every((account: Record<string, unknown>) => !('password' in account) && !('csrf' in account)));
  for (const route of ['/overview', '/sources', '/github-owners', '/import-batches']) assert.equal((await request('game_manager', 'GET', route)).statusCode, 200);
  const repo = await request('game_manager', 'POST', '/repositories', { fullName: 'example/game' });
  assert.equal(repo.statusCode, 201);
  const id = repo.json().repository.id;
  assert.equal((await request('game_manager', 'GET', `/repositories/${id}/releases`)).statusCode, 200);
  assert.equal((await request('game_manager', 'POST', `/repositories/${id}/check`)).statusCode, 200);
  assert.equal((await request('game_manager', 'POST', '/github-owners', { login: 'example' })).statusCode, 200);
  assert.equal((await request('game_manager', 'GET', '/github-owners/example/repositories')).statusCode, 200);
  assert.equal((await request('game_manager', 'POST', '/imports', { repositoryId: id, releaseId: 101 })).statusCode, 202);
  for (let attempt = 0; attempt < 100; attempt++) {
    const overview = (await request('game_manager', 'GET', '/overview')).json();
    if (overview.jobs[0]?.status === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal((await request('game_manager', 'GET', '/overview')).json().jobs[0].status, 'completed');
  assert.equal((await request('game_manager', 'POST', '/games/test-game/review', { version: '1.0.0', approved: true })).statusCode, 200);
  for (const route of ['/games/test-game/preview', '/games/test-game/publish', '/games/test-game/unpublish']) assert.equal((await request('game_manager', 'POST', route, { version: '1.0.0' })).statusCode, 200, route);
  const csrf = auth.game_manager['x-csrf-token'];
  auth.game_manager['x-csrf-token'] = 'invalid';
  assert.equal((await request('game_manager', 'POST', '/games/test-game/publish', { version: '1.0.0' })).statusCode, 403);
  auth.game_manager['x-csrf-token'] = csrf;
});

test('account assignments protect the last administrator, reject stale changes and take effect on live sessions', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-role-changes-'));
  const config = getConfig({ dataDir: path.join(root, 'data'), production: false });
  const store = openStore(config.dataDir);
  const password = await passwordHash('permission-test-password');
  store.db.insert(users).values([{ id: 1, username: 'admin', role: 'admin', password }, { id: 2, username: 'player', role: 'player', password }]).run();
  const app = await createApplication(config, store);
  t.after(async () => { await app.close(); store.sqlite.close(); await fs.rm(root, { recursive: true, force: true }); });
  const headers = { host: new URL(config.platformOrigin).host, origin: config.platformOrigin };
  const login = async (username: string) => {
    const response = await app.platform.inject({ method: 'POST', url: '/api/v1/login', headers, payload: { username, password: 'permission-test-password' } });
    return { ...headers, cookie: String(response.headers['set-cookie']).split(';')[0], 'x-csrf-token': response.json().csrf };
  };
  const admin = await login('admin');
  const player = await login('player');
  const change = (id: number, role: string, expectedRole: string, actingHeaders = admin) => app.platform.inject({ method: 'POST', url: `/api/v1/admin/accounts/${id}/role`, headers: actingHeaders, payload: { role, expectedRole } });
  assert.equal((await change(1, 'player', 'admin')).statusCode, 409);
  assert.equal((await change(2, 'owner', 'player')).statusCode, 400);
  assert.equal((await change(999, 'player', 'player')).statusCode, 404);
  assert.equal((await change(2, 'admin', 'player', player)).statusCode, 403);
  assert.equal((await change(2, 'game_manager', 'player', { ...admin, 'x-csrf-token': 'bad' })).statusCode, 403);
  assert.equal((await change(2, 'game_manager', 'player')).statusCode, 200);
  assert.equal((await change(2, 'analyst', 'player')).statusCode, 409);
  assert.equal((await app.platform.inject({ url: '/api/v1/admin/overview', headers: player })).statusCode, 200);
  assert.equal((await change(2, 'analyst', 'game_manager')).statusCode, 200);
  assert.equal((await app.platform.inject({ url: '/api/v1/admin/overview', headers: player })).statusCode, 403);
  assert.equal((await app.platform.inject({ url: '/api/v1/admin/analytics', headers: player })).statusCode, 200);
  assert.equal((await app.platform.inject({ url: '/api/v1/session', headers: player })).json().role, 'analyst');
  assert.equal((await change(2, 'admin', 'analyst')).statusCode, 200);
  assert.equal((await change(1, 'game_manager', 'admin')).statusCode, 200);
  assert.equal((await change(2, 'player', 'admin', player)).statusCode, 409);
  assert.equal((await change(2, 'player', 'admin')).statusCode, 403);
  for (let i = 0; i < 22; i++) store.db.insert(users).values({ username: `extra_${i}`, password }).run();
  const first = (await app.platform.inject({ url: '/api/v1/admin/accounts', headers: player })).json();
  assert.equal(first.total, 24); assert.equal(first.accounts.length, 20);
  assert.equal((await app.platform.inject({ url: '/api/v1/admin/accounts?page=2', headers: player })).json().accounts.length, 4);
  assert.equal((await app.platform.inject({ url: '/api/v1/admin/accounts?search=%25', headers: player })).json().total, 0);
  const destination = path.join(root, 'backup');
  await backup(config.dataDir, destination); await restore(destination, path.join(root, 'restored'));
  const restored = openStore(path.join(root, 'restored'));
  try {
    assert.equal(restored.db.select().from(users).all().find((u) => u.id === 1)?.role, 'game_manager');
    assert.deepEqual(restored.sqlite.prepare('SELECT * FROM sessions').all(), []);
    assert.deepEqual(restored.sqlite.pragma('foreign_key_check'), []);
  } finally { restored.sqlite.close(); }
});

test('v7 role constraint migrates without changing account IDs, sessions or references', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-roles-migration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = openStore(root);
  const password = await passwordHash('existing-password');
  store.db.insert(users).values([{ id: 1, username: 'ExistingAdmin', role: 'admin', password }, { id: 5, username: 'ExistingPlayer', role: 'player', password }]).run();
  store.sqlite.exec(`INSERT INTO account_settings VALUES (5,'private'); INSERT INTO sessions VALUES ('token',5,'csrf',${Date.now() + 100000});`);
  store.sqlite.pragma('foreign_keys = OFF');
  store.sqlite.exec(`CREATE TABLE users_v7 (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL COLLATE NOCASE UNIQUE,password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player','admin')),created_at TEXT NOT NULL DEFAULT '');
    INSERT INTO users_v7 SELECT * FROM users; DROP TABLE users; ALTER TABLE users_v7 RENAME TO users; UPDATE sqlite_sequence SET seq=50 WHERE name='users'; PRAGMA user_version=7;`);
  store.sqlite.close();
  const upgraded = openStore(root);
  try {
    assert.equal(upgraded.sqlite.pragma('user_version', { simple: true }), 9);
    assert.equal(upgraded.db.select().from(users).all()[0].password, password);
    assert.equal((upgraded.sqlite.prepare('SELECT user_id FROM sessions').get() as { user_id: number }).user_id, 5);
    assert.equal((upgraded.sqlite.prepare('SELECT career_visibility FROM account_settings WHERE user_id=5').get() as { career_visibility: string }).career_visibility, 'private');
    upgraded.sqlite.prepare("UPDATE users SET role='game_manager' WHERE id=5").run();
    assert.ok(upgraded.db.insert(users).values({ username: 'NewAnalyst', role: 'analyst', password }).returning().get()!.id > 50);
    assert.throws(() => upgraded.sqlite.prepare("UPDATE users SET role='owner' WHERE id=5").run());
    assert.throws(() => upgraded.db.insert(users).values({ username: 'EXISTINGPLAYER', password }).run());
    assert.equal(upgraded.sqlite.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(upgraded.sqlite.pragma('foreign_key_check'), []);
  } finally { upgraded.sqlite.close(); }
});
