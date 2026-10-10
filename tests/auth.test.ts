import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { getConfig } from '../server/config.js';
import { createApplication } from '../server/app.js';
import { passwordHash, verifyPassword } from '../server/auth.js';
import { openStore, users, sessions } from '../server/db.js';
import { backup, restore } from '../server/maintenance.js';

test('registration creates only players; roles protect every management endpoint', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-accounts-'));
  const config = getConfig({ dataDir: path.join(root, 'data'), production: false });
  const store = openStore(config.dataDir);
  store.db
    .insert(users)
    .values({
      username: 'Admin',
      role: 'admin',
      password: await passwordHash('administrator-password'),
    })
    .run();
  const app = await createApplication(config, store);
  t.after(async () => {
    await app.close();
    store.sqlite.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  let address = 1;
  const request = (url: string, body?: unknown, extra: Record<string, string> = {}) =>
    app.platform.inject({
      method: body === undefined ? 'GET' : 'POST',
      url,
      headers: {
        host: new URL(config.platformOrigin).host,
        origin: config.platformOrigin,
        ...extra,
      },
      payload: body as object,
      remoteAddress: `192.0.2.${address++}`,
    });
  assert.equal(
    (
      await request('/api/v1/register', {
        username: 'cheater',
        password: 'player-password',
        role: 'admin',
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await request('/api/v1/register', { username: 'admin', password: 'player-password' }))
      .statusCode,
    409,
  );
  assert.equal(
    (await request('/api/v1/register', { username: 'player', password: 'short' })).statusCode,
    400,
  );
  assert.equal(
    (await request('/api/v1/register', { username: 'bad name', password: 'player-password' }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await request(
        '/api/v1/register',
        { username: 'player', password: 'player-password' },
        { origin: config.gamesOrigin },
      )
    ).statusCode,
    403,
  );
  const registration = await request('/api/v1/register', {
    username: ' Player.One ',
    password: 'player-password',
  });
  assert.equal(registration.statusCode, 201);
  assert.equal(registration.json().role, 'player');
  assert.equal(registration.json().username, 'Player.One');
  assert.ok(String(registration.headers['set-cookie']).includes('HttpOnly'));
  const headers = {
    cookie: String(registration.headers['set-cookie']).split(';')[0],
    'x-csrf-token': registration.json().csrf,
  };
  const player = store.db.select().from(users).where(eq(users.username, 'player.one')).get()!;
  assert.equal(player.username, 'Player.One');
  assert.notEqual(player.password, 'player-password');
  assert.ok(await verifyPassword('player-password', player.password));
  assert.equal((await request('/api/v1/session', undefined, headers)).json().role, 'player');
  assert.equal((await request('/api/v1/session', undefined, headers)).json().username, 'Player.One');
  for (const spelling of ['Player.One', 'player.one', 'PLAYER.ONE']) {
    const career = await request(`/api/v1/players/${spelling}/career`, undefined, headers);
    assert.equal(career.statusCode, 200);
    assert.equal(career.json().username, 'Player.One');
  }
  assert.equal(
    (await request('/api/v1/register', { username: 'PLAYER.ONE', password: 'another-password' }))
      .statusCode,
    409,
  );
  const duplicates = await Promise.all([
    request('/api/v1/register', { username: 'racing-player', password: 'player-password' }),
    request('/api/v1/register', { username: 'RACING-PLAYER', password: 'player-password' }),
  ]);
  assert.deepEqual(duplicates.map((r) => r.statusCode).sort(), [201, 409]);
  for (const [url, body] of [
    ['/api/v1/admin/overview', undefined],
    ['/api/v1/admin/repositories', { fullName: 'example/game' }],
    ['/api/v1/admin/repositories/1/releases', undefined],
    ['/api/v1/admin/imports', { repositoryId: 1, releaseId: 101 }],
    ['/api/v1/admin/games/test-game/preview', { version: '1.0.0' }],
    ['/api/v1/admin/games/test-game/publish', { version: '1.0.0' }],
    ['/api/v1/admin/games/test-game/unpublish', {}],
  ] as const)
    assert.equal((await request(url, body, headers)).statusCode, 403, url);
  assert.equal((await request('/api/v1/games', undefined, headers)).statusCode, 200);
  assert.equal(
    (await request('/api/v1/logout', {}, { ...headers, 'x-csrf-token': 'invalid' })).statusCode,
    403,
  );
  assert.equal((await request('/api/v1/logout', {}, headers)).statusCode, 200);
  assert.equal((await request('/api/v1/session', undefined, headers)).json().authenticated, false);
  assert.equal(
    (await request('/api/v1/login', { username: 'PLAYER.ONE', password: 'incorrect' })).statusCode,
    401,
  );
  const login = await request('/api/v1/login', {
    username: 'PLAYER.ONE',
    password: 'player-password',
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().role, 'player');
  assert.equal(login.json().username, 'Player.One');
  const lowercaseLogin = await request('/api/v1/login', {
    username: 'player.one', password: 'player-password',
  });
  assert.equal(lowercaseLogin.statusCode, 200);
  assert.equal(lowercaseLogin.json().username, 'Player.One');
  const adminLogin = await request('/api/v1/login', {
    username: 'admin',
    password: 'administrator-password',
  });
  assert.equal(adminLogin.json().role, 'admin');
  const adminHeaders = {
    cookie: String(adminLogin.headers['set-cookie']).split(';')[0],
    'x-csrf-token': adminLogin.json().csrf,
  };
  assert.equal((await request('/api/v1/admin/overview', undefined, adminHeaders)).statusCode, 200);
  store.db.update(users).set({ role: 'player' }).where(eq(users.username, 'Admin')).run();
  assert.equal((await request('/api/v1/admin/overview', undefined, adminHeaders)).statusCode, 403);
  assert.equal((await request('/api/v1/session', undefined, adminHeaders)).json().role, 'player');
  const destination = path.join(root, 'backup');
  await backup(config.dataDir, destination);
  await restore(destination, path.join(root, 'restored'));
  const restored = openStore(path.join(root, 'restored'));
  try {
    assert.equal(restored.db.select().from(users).all().length, 3);
    assert.equal(
      restored.db.select().from(users).where(eq(users.username, 'player.one')).get()?.role,
      'player',
    );
    assert.equal(restored.db.select().from(sessions).all().length, 0);
    assert.equal(restored.db.select().from(users).where(eq(users.username, 'player.one')).get()?.username, 'Player.One');
  } finally {
    restored.sqlite.close();
  }
  store.db.update(sessions).set({ expiresAt: 0 }).run();
  assert.equal(
    (await request('/api/v1/session', undefined, adminHeaders)).json().authenticated,
    false,
  );
});

test('version-one database migrates administrator, sessions and game data without resetting them', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-migration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const old = new Database(path.join(root, 'platform.sqlite'));
  const password = await passwordHash('existing-admin-password');
  old.exec(`
    CREATE TABLE admins (id INTEGER PRIMARY KEY CHECK(id = 1), username TEXT NOT NULL UNIQUE, password TEXT NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE repositories (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    CREATE TABLE games (id TEXT PRIMARY KEY, active_version TEXT);
    CREATE TABLE versions (id INTEGER PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id), version TEXT NOT NULL,
      manifest TEXT NOT NULL, sha256 TEXT NOT NULL, release_id INTEGER, asset_id INTEGER, release_tag TEXT,
      imported_at TEXT NOT NULL, published_at TEXT);
    CREATE INDEX sessions_expiry ON sessions(expires_at);
    INSERT INTO games VALUES ('existing-game', '1.0.0');
    PRAGMA user_version = 1;
  `);
  old.prepare('INSERT INTO admins VALUES (1, ?, ?)').run('ExistingAdmin', password);
  old
    .prepare('INSERT INTO sessions VALUES (?, 1, ?, ?)')
    .run('legacy-token-hash', 'legacy-csrf', Date.now() + 100000);
  old.close();
  const store = openStore(root);
  try {
    assert.equal(store.sqlite.pragma('user_version', { simple: true }), 9);
    assert.equal(store.db.select().from(users).get()?.role, 'admin');
    assert.equal(store.db.select().from(users).get()?.password, password);
    assert.equal(store.db.select().from(sessions).get()?.userId, 1);
    assert.equal(store.db.select().from(sessions).get()?.csrf, 'legacy-csrf');
    assert.deepEqual(store.sqlite.prepare('SELECT * FROM games').get(), {
      id: 'existing-game',
      active_version: '1.0.0',
    });
    assert.deepEqual(store.sqlite.pragma('foreign_key_check'), []);
  } finally {
    store.sqlite.close();
  }
  const reopened = openStore(root);
  try {
    assert.equal(reopened.db.select().from(users).all().length, 1);
  } finally {
    reopened.sqlite.close();
  }
});

test('public registration rate limits repeated attempts', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-rate-limit-'));
  const config = getConfig({ dataDir: root, production: false });
  const store = openStore(root);
  const app = await createApplication(config, store);
  t.after(async () => {
    await app.close();
    store.sqlite.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  for (let i = 0; i < 6; i++) {
    const response = await app.platform.inject({
      method: 'POST',
      url: '/api/v1/register',
      headers: { host: new URL(config.platformOrigin).host, origin: config.platformOrigin },
      payload: { username: 'ab', password: 'short' },
    });
    assert.equal(response.statusCode, i < 5 ? 400 : 429);
  }
});
