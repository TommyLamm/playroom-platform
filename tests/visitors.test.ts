import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApplication } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { openStore, users } from '../server/db.js';
import { hashToken, passwordHash } from '../server/auth.js';
import { backup, restore, seedDemos } from '../server/maintenance.js';
import type { VisitorAnalytics, VisitorRecords } from '../shared/visitors.js';

test('visitor analytics records anonymous and authenticated activity with server-derived geography', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-visitors-'));
  const config = getConfig({ dataDir: path.join(root, 'data'), clientDir: path.join(root, 'none'), production: false });
  const store = openStore(config.dataDir);
  await seedDemos(store, config);
  store.db.insert(users).values({ username: 'visitor-admin', role: 'admin', password: await passwordHash('visitor-admin-password') }).run();
  const app = await createApplication(config, store);
  t.after(async () => { await app.close(); store.sqlite.close(); await fs.rm(root, { recursive: true, force: true }); });
  const base = { host: new URL(config.platformOrigin).host, origin: config.platformOrigin };
  const req = (url: string, body?: unknown, headers: Record<string, string> = {}, remoteAddress = '8.8.8.8') => app.platform.inject({
    method: body === undefined ? 'GET' : 'POST', url, payload: body as object, headers: { ...base, ...headers }, remoteAddress,
  });
  const cookie = (response: Awaited<ReturnType<typeof req>>) => String(response.headers['set-cookie']).split(';')[0];
  const admin = { cookie: cookie(await req('/api/v1/login', { username: 'visitor-admin', password: 'visitor-admin-password' })) };
  const player = { cookie: cookie(await req('/api/v1/register', { username: 'visitor-player', password: 'visitor-player-password' })) };
  const event = (changes = {}) => ({ kind: 'page_view', path: '/', requestId: randomUUID(), ...changes });
  const view = async (days = 7) => {
    const response = await req(`/api/v1/admin/visitors?days=${days}`, undefined, admin);
    assert.equal(response.statusCode, 200, response.body); return response.json() as VisitorAnalytics;
  };
  const records = async (query = '') => {
    const response = await req(`/api/v1/admin/visitors/records?days=7${query}`, undefined, admin);
    assert.equal(response.statusCode, 200, response.body); return response.json() as VisitorRecords;
  };
  let guestCookie = '';
  await t.test('records IP and country without trusting client fields, protects cookie and deduplicates retries', async () => {
    const input = event({ referrer: 'https://search.example/find?secret=hidden#token', requestId: randomUUID() });
    const first = await req('/api/v1/visits', input, { 'user-agent': 'Visitor test browser' });
    assert.equal(first.statusCode, 204, first.body);
    guestCookie = cookie(first);
    assert.match(String(first.headers['set-cookie']), /HttpOnly/);
    assert.match(String(first.headers['set-cookie']), /SameSite=Strict/);
    assert.match(String(first.headers['set-cookie']), /Max-Age=2592000/);
    assert.equal((await req('/api/v1/visits', input, { cookie: guestCookie })).statusCode, 204);
    assert.deepEqual((await view()).totals, { visitors: 1, pageViews: 1, gameOpens: 0 });
    const row = (await records()).records[0];
    assert.equal(row.country, 'US'); assert.equal(row.ip, '8.8.8.8');
    assert.equal(row.referrerHost, 'search.example'); assert.equal(row.userAgent, 'Visitor test browser');
    assert.equal(row.username, null);
    assert.equal(row.visitor, hashToken(guestCookie.split('=')[1]));
    assert.ok(!JSON.stringify(row).includes('secret')); assert.ok(!JSON.stringify(row).includes(guestCookie.split('=')[1]));
    for (const extra of [{ ip: '1.2.3.4' }, { country: 'HK' }, { userId: 1 }, { occurredAt: 1 }])
      assert.equal((await req('/api/v1/visits', event(extra))).statusCode, 400);
  });
  await t.test('same browser remains one visitor across login and IP changes, supports IPv6 and unknown addresses', async () => {
    assert.equal((await req('/api/v1/visits', event({ path: '/games/signal-tap' }), { cookie: `${guestCookie}; ${player.cookie}` }, '2001:4860:4860::8888')).statusCode, 204);
    const row = (await records('&ip=2001%3A4860%3A4860%3A%3A8888')).records[0];
    assert.equal(row.country, 'US'); assert.equal(row.username, 'visitor-player');
    assert.equal((await req('/api/v1/visits', event(), { cookie: guestCookie }, '127.0.0.1')).statusCode, 204);
    assert.equal((await records('&country=unknown')).total, 1);
    assert.deepEqual((await view()).totals, { visitors: 1, pageViews: 3, gameOpens: 0 });
    const countries = (await view()).countries;
    assert.equal(countries.find((r) => r.country === 'US')!.visitors, 1);
    assert.equal(countries.find((r) => r.country === null)!.visitors, 1);
  });
  await t.test('forwarded IP is accepted only through trusted proxy and country headers are ignored', async () => {
    const headers = { cookie: guestCookie, 'x-forwarded-for': '2001:4860:4860::8888', 'cf-ipcountry': 'HK' };
    await req('/api/v1/visits', event(), headers, '127.0.0.1');
    await req('/api/v1/visits', event(), { ...headers, 'x-forwarded-for': '9.9.9.9' });
    const rows = (await records()).records;
    assert.equal(rows[0].ip, '8.8.8.8'); assert.equal(rows[0].country, 'US');
    assert.equal(rows[1].ip, '2001:4860:4860::8888'); assert.equal(rows[1].country, 'US');
  });
  await t.test('only administrators can read summaries and activity, and malformed filters fail', async () => {
    for (const route of ['/api/v1/admin/visitors', '/api/v1/admin/visitors/records']) {
      assert.equal((await req(route)).statusCode, 401);
      assert.equal((await req(route, undefined, player)).statusCode, 403);
    }
    for (const query of ['days=1', 'days=7&days=30', 'userId=1'])
      assert.equal((await req(`/api/v1/admin/visitors?${query}`, undefined, admin)).statusCode, 400);
    for (const query of ['page=0', 'page=1.5', 'page=100001', 'ip=invalid', 'country=US%27', 'kind=login', 'visitor=abc', 'gameId=../foo'])
      assert.equal((await req(`/api/v1/admin/visitors/records?${query}`, undefined, admin)).statusCode, 400);
  });
  await t.test('only published games and public paths are recorded; admin and previews are excluded', async () => {
    const input = event({ kind: 'game_open', path: '/play/signal-tap', gameId: 'signal-tap', version: '1.2.0' });
    assert.equal((await req('/api/v1/visits', input, { cookie: guestCookie })).statusCode, 204);
    assert.equal((await req('/api/v1/visits', input, { cookie: guestCookie })).statusCode, 204);
    assert.equal((await req('/api/v1/visits', event({ ...input, requestId: randomUUID(), version: '99.0.0' }), { cookie: guestCookie })).statusCode, 404);
    for (const path of ['/admin', '/preview/secret', '/?token=secret', '/games/signal-tap#secret', '/api/v1/health'])
      assert.equal((await req('/api/v1/visits', event({ path }))).statusCode, 400);
    assert.equal((await req('/api/v1/visits', event({ kind: 'game_open' }))).statusCode, 400);
    assert.equal((await req('/api/v1/visits', event({ gameId: 'signal-tap' }))).statusCode, 400);
    assert.equal((await req('/api/v1/visits', event(), { origin: config.gamesOrigin })).statusCode, 403);
    const before = (await records()).total;
    assert.equal((await req('/api/v1/visits', event(), admin)).statusCode, 204);
    assert.equal((await req('/api/v1/visits', { ...input, requestId: randomUUID() }, admin)).statusCode, 204);
    assert.equal((await records()).total, before);
    assert.equal((await records('&gameId=signal-tap&kind=game_open')).total, 1);
    store.sqlite.prepare("UPDATE games SET published=0 WHERE id='signal-tap'").run();
    assert.equal((await req('/api/v1/visits', { ...input, requestId: randomUUID() }, { cookie: guestCookie })).statusCode, 404);
    const game = (await view()).games[0];
    assert.deepEqual(game, { gameId: 'signal-tap', name: '光點反應', opens: 1, visitors: 1 });
    const row = (await records('&gameId=signal-tap')).records[0];
    assert.equal(row.gameName, '光點反應'); assert.equal(row.gameVersion, '1.2.0');
    assert.equal(row.path, '/play/signal-tap');
  });
  await t.test('UTC windows, stable pagination and visitor filters retain older records', async () => {
    const today = new Date();
    const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6);
    const insert = store.sqlite.prepare(`INSERT INTO visitor_events(visitor_id,request_id,occurred_at,kind,path,ip,user_agent) VALUES (?,?,?,'page_view','/','192.0.2.1','')`);
    insert.run('a'.repeat(64), randomUUID(), start - 1);
    insert.run('b'.repeat(64), randomUUID(), start);
    for (let i = 0; i < 30; i++) insert.run('c'.repeat(64), randomUUID(), start);
    const first = await records(); const second = await records('&page=2');
    assert.equal(first.records.length, 25); assert.ok(second.records.length > 0);
    assert.equal(new Set([...first.records, ...second.records].map((row) => row.id)).size, first.total);
    assert.equal((await records(`&visitor=${'c'.repeat(64)}`)).total, 30);
    assert.equal((await records(`&visitor=${'a'.repeat(64)}`)).total, 0);
    const weekly = await view(); const monthly = await view(30);
    assert.equal(weekly.window.start, new Date(start).toISOString());
    assert.equal(weekly.daily.length, 7); assert.equal(monthly.daily.length, 30);
    assert.equal(monthly.totals.pageViews, weekly.totals.pageViews + 1);
    assert.equal(monthly.totals.visitors, weekly.totals.visitors + 1);
    assert.equal(weekly.daily.reduce((n, row) => n + row.pageViews, 0), weekly.totals.pageViews);
  });
  await t.test('backup and restore preserve visitor events and v5 migration preserves existing games and accounts', async () => {
    await backup(config.dataDir, path.join(root, 'backup'));
    await restore(path.join(root, 'backup'), path.join(root, 'restored'));
    const recovered = openStore(path.join(root, 'restored'));
    try {
      assert.equal(recovered.sqlite.pragma('user_version', { simple: true }), 7);
      assert.deepEqual(recovered.sqlite.prepare('SELECT * FROM visitor_events ORDER BY id').all(), store.sqlite.prepare('SELECT * FROM visitor_events ORDER BY id').all());
      recovered.sqlite.exec('DROP TABLE import_batch_items; DROP TABLE import_batches; DROP TABLE github_owners; ALTER TABLE repositories DROP COLUMN archived; ALTER TABLE repositories DROP COLUMN checked_at; ALTER TABLE repositories DROP COLUMN check_error; ALTER TABLE repositories DROP COLUMN cached_releases; DROP TABLE visitor_events; PRAGMA user_version=5;');
    } finally { recovered.sqlite.close(); }
    const upgraded = openStore(path.join(root, 'restored'));
    try {
      assert.equal(upgraded.sqlite.pragma('user_version', { simple: true }), 7);
      assert.equal((upgraded.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, 2);
      assert.equal((upgraded.sqlite.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }).n, 2);
      assert.equal((upgraded.sqlite.prepare('SELECT COUNT(*) AS n FROM visitor_events').get() as { n: number }).n, 0);
      assert.deepEqual(upgraded.sqlite.pragma('foreign_key_check'), []);
    } finally { upgraded.sqlite.close(); }
  });
});

test('visitor records expire after 90 days and production cookies are secure', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-visitor-retention-'));
  const config = getConfig({ dataDir: root, clientDir: path.join(root, 'none'), platformOrigin: 'https://play.example.com', gamesOrigin: 'https://games.example.com', production: true });
  const store = openStore(root);
  const insert = store.sqlite.prepare(`INSERT INTO visitor_events(visitor_id,request_id,occurred_at,kind,path,ip,user_agent) VALUES (?,?,?,'page_view','/','127.0.0.1','')`);
  for (const age of [89, 91]) insert.run(hashToken(randomUUID()), randomUUID(), Date.now() - age * 86400000);
  const app = await createApplication(config, store);
  t.after(async () => { await app.close(); store.sqlite.close(); await fs.rm(root, { recursive: true, force: true }); });
  assert.equal((store.sqlite.prepare('SELECT COUNT(*) AS n FROM visitor_events').get() as { n: number }).n, 1);
  const visit = await app.platform.inject({ method: 'POST', url: '/api/v1/visits', headers: { host: 'play.example.com', origin: config.platformOrigin }, payload: { requestId: randomUUID(), kind: 'page_view', path: '/' } });
  assert.equal(visit.statusCode, 204, visit.body);
  assert.match(String(visit.headers['set-cookie']), /^__Host-playroom-visitor=/);
  assert.match(String(visit.headers['set-cookie']), /Secure/);
  assert.ok(!String(visit.headers['set-cookie']).includes('Domain='));
  for (let i = 0; i < 119; i++) {
    const response = await app.platform.inject({ method: 'POST', url: '/api/v1/visits', headers: { host: 'play.example.com', origin: config.platformOrigin, cookie: String(visit.headers['set-cookie']).split(';')[0] }, payload: { requestId: randomUUID(), kind: 'page_view', path: '/' } });
    assert.equal(response.statusCode, 204);
  }
  const limited = await app.platform.inject({ method: 'POST', url: '/api/v1/visits', headers: { host: 'play.example.com', origin: config.platformOrigin }, payload: { requestId: randomUUID(), kind: 'page_view', path: '/' } });
  assert.equal(limited.statusCode, 429);
});
