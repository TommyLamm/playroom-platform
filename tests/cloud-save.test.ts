import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../server/db.js';
import { createApplication } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { backup, restore, seedDemos } from '../server/maintenance.js';
import { progressData } from '../shared/cloud-save.js';

test('cloud saves isolate accounts, survive sessions and recovery, and reject stale writes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-cloud-save-'));
  const config = getConfig({ dataDir: path.join(root, 'data'), clientDir: path.join(root, 'none'), production: false });
  const store = openStore(config.dataDir);
  await seedDemos(store, config);
  const app = await createApplication(config, store);
  t.after(async () => { await app.close(); store.sqlite.close(); await fs.rm(root, { recursive: true, force: true }); });
  type Headers = Record<string, string>;
  const base = { host: new URL(config.platformOrigin).host, origin: config.platformOrigin };
  let remote = 1;
  const req = (url: string, body?: unknown, headers: Headers = {}) => app.platform.inject({ method: body === undefined ? 'GET' : 'POST', url, payload: body as object, headers: { ...base, ...headers }, remoteAddress: `192.0.2.${remote++}` });
  const auth = (response: Awaited<ReturnType<typeof req>>) => ({ cookie: String(response.headers['set-cookie']).split(';')[0], 'x-csrf-token': response.json().csrf });
  const password = 'cloud-save-test-password';
  const alice = auth(await req('/api/v1/register', { username: 'alice', password }));
  const bob = auth(await req('/api/v1/register', { username: 'bob', password }));
  const url = '/api/v1/games/signal-tap/save';
  const input = { data: { stage: 7, inventory: ['key'], best: 42 }, revision: 0, formatVersion: 1, version: '1.2.1', requestId: randomUUID() };
  await t.test('private reads, strict input, Origin, CSRF and version validation', async () => {
    assert.equal((await req(url)).statusCode, 401);
    assert.equal((await req(url, input)).statusCode, 401);
    assert.equal((await req(url, undefined, alice)).json(), null);
    assert.equal((await req(`${url}?username=alice`, undefined, bob)).statusCode, 400);
    assert.equal((await req(url, { ...input, userId: 2 }, alice)).statusCode, 400);
    assert.equal((await req(url, input, { ...alice, 'x-csrf-token': '' })).statusCode, 403);
    assert.equal((await req(url, input, { ...alice, origin: config.gamesOrigin })).statusCode, 403);
    assert.equal((await req(url, { ...input, version: '99.0.0' }, alice)).statusCode, 404);
    for (const data of [null, [], { huge: '字'.repeat(24000) }, { bad: null, huge: 'a'.repeat(100000) }]) {
      assert.ok([400, 413].includes((await req(url, { ...input, data }, alice)).statusCode));
    }
    assert.equal((await req(url, { ...input, revision: -1 }, alice)).statusCode, 400);
    assert.equal((await req(url, { ...input, formatVersion: 0 }, alice)).statusCode, 400);
  });
  await t.test('cross-device sessions, game isolation, idempotency and atomic conflicts', async () => {
    const first = await req(url, input, alice);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().saved, true);
    assert.equal(first.json().revision, 1);
    assert.deepEqual((await req(url, input, alice)).json(), first.json());
    assert.equal((await req(url, { ...input, data: { stage: 8 } }, alice)).statusCode, 409);
    assert.equal((await req(url, undefined, bob)).json(), null);
    assert.equal((await req('/api/v1/games/color-hunt/save', undefined, alice)).json(), null);
    const secondDevice = auth(await req('/api/v1/login', { username: 'ALICE', password }));
    assert.deepEqual((await req(url, undefined, secondDevice)).json().data, input.data);
    const writes = await Promise.all([alice, secondDevice].map((headers, index) => req(url, { ...input, revision: 1, data: { stage: 8 + index }, requestId: randomUUID() }, headers)));
    assert.deepEqual(writes.map((r) => r.statusCode).sort(), [200, 409]);
    assert.equal((await req(url, undefined, alice)).json().revision, 2);
    assert.equal((await req(url, { ...input, requestId: randomUUID() }, alice)).statusCode, 409);
    await req('/api/v1/logout', {}, secondDevice);
    assert.equal((await req(url, undefined, secondDevice)).statusCode, 401);
    assert.equal((await req(url, undefined, alice)).statusCode, 200);
    store.sqlite.prepare("UPDATE games SET published=0 WHERE id='signal-tap'").run();
    assert.equal((await req(url, undefined, alice)).statusCode, 404);
    assert.equal((await req(url, { ...input, revision: 2 }, alice)).statusCode, 404);
    store.sqlite.prepare("UPDATE games SET published=1 WHERE id='signal-tap'").run();
  });
  await t.test('backup and restore retain progress while clearing sessions; v9 upgrades preserve accounts', async () => {
    const expected = (await req(url, undefined, alice)).json();
    await backup(config.dataDir, path.join(root, 'backup'));
    await restore(path.join(root, 'backup'), path.join(root, 'restored'));
    const restored = openStore(path.join(root, 'restored'));
    try {
      assert.equal(restored.sqlite.pragma('user_version', { simple: true }), 10);
      assert.equal(restored.sqlite.pragma('integrity_check', { simple: true }), 'ok');
      assert.equal((restored.sqlite.prepare('SELECT COUNT(*) n FROM sessions').get() as { n: number }).n, 0);
      const saved = restored.sqlite.prepare('SELECT data,revision FROM cloud_saves WHERE game_id=?').get('signal-tap') as { data: string; revision: number };
      assert.deepEqual(JSON.parse(saved.data), expected.data);
      assert.equal(saved.revision, expected.revision);
      restored.sqlite.exec('DROP TABLE cloud_saves; PRAGMA user_version=9');
    } finally { restored.sqlite.close(); }
    const upgraded = openStore(path.join(root, 'restored'));
    try {
      assert.equal(upgraded.sqlite.pragma('user_version', { simple: true }), 10);
      assert.equal((upgraded.sqlite.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n, 2);
      assert.deepEqual(upgraded.sqlite.pragma('foreign_key_check'), []);
      assert.equal((upgraded.sqlite.prepare('SELECT COUNT(*) n FROM cloud_saves').get() as { n: number }).n, 0);
    } finally { upgraded.sqlite.close(); }
  });
  await t.test('limits are shared across sessions for each account', async () => {
    const more = auth(await req('/api/v1/login', { username: 'bob', password }));
    let limited = false;
    for (let index = 0; index < 65; index++) {
      const response = await req(url, { ...input, data: { index }, revision: index, requestId: randomUUID() }, index % 2 ? bob : more);
      if (response.statusCode === 429) { limited = true; break; }
      assert.equal(response.statusCode, 200, response.body);
    }
    assert.equal(limited, true);
  });
});

test('progress payload rejects unsupported values, excessive nesting and oversized UTF-8', () => {
  for (const data of [{ value: undefined }, { value: NaN }, { value: new Date() }, { value: BigInt(1) }, { value: () => {} }]) assert.equal(progressData.safeParse(data).success, false);
  let deep: Record<string, unknown> = {};
  for (let n = 0; n < 35; n++) deep = { child: deep };
  assert.equal(progressData.safeParse(deep).success, false);
  assert.equal(progressData.safeParse({ nested: { list: [1, true, null, '字'] } }).success, true);
});
