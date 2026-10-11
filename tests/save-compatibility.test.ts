import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, users } from '../server/db.js';
import { getConfig } from '../server/config.js';
import { createApplication } from '../server/app.js';
import { passwordHash } from '../server/auth.js';
import { installVersion, publish } from '../server/library.js';
import { backup, restore } from '../server/maintenance.js';
import { testManifest } from './helpers.js';
import { MAX_SAVE_SNAPSHOTS } from '../shared/cloud-save.js';

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-save-formats-'));
  const config = getConfig({ dataDir: path.join(root, 'data'), clientDir: path.join(root, 'none'), production: false });
  const store = openStore(config.dataDir);
  const password = 'save-formats-test-password';
  store.db.insert(users).values(['alice', 'bob', 'manager'].map((username, index) => ({ username, password: '', role: index === 2 ? 'admin' as const : 'player' as const }))).run();
  store.sqlite.prepare('UPDATE users SET password=?').run(await passwordHash(password));
  async function install(version: string, readableFormats?: number[], writeFormat = 1) {
    const manifest = { ...testManifest, version, ...(readableFormats ? { schemaVersion: 2 as const, cloudSave: { readableFormats, writeFormat } } : {}) };
    const stage = path.join(config.dataDir, 'staging', 'stage-' + version);
    await fs.cp('examples/starter', stage, { recursive: true });
    await fs.writeFile(path.join(stage, 'game.json'), JSON.stringify(manifest));
    await installVersion(store, config, stage, manifest, { repositoryId: null, releaseId: null, assetId: null, releaseTag: null, sha256: 'fixture' });
    store.sqlite.prepare('UPDATE versions SET reviewed_at=? WHERE game_id=? AND version=?').run(new Date().toISOString(), testManifest.id, version);
  }
  await install('1.0.0', [1]); publish(store, testManifest.id, '1.0.0');
  await install('2.0.0', [1, 2], 2);
  await install('3.0.0', [1]);
  await install('4.0.0');
  await install('1.1.0', [1, 2], 1);
  const app = await createApplication(config, store);
  t.after(async () => { await app.close(); store.sqlite.close(); await fs.rm(root, { recursive: true, force: true }); });
  const headers = { host: new URL(config.platformOrigin).host, origin: config.platformOrigin };
  const auth = async (username: string) => {
    const response = await app.platform.inject({ method: 'POST', url: '/api/v1/login', payload: { username, password }, headers });
    assert.equal(response.statusCode, 200, response.body);
    return { ...headers, cookie: String(response.headers['set-cookie']).split(';')[0], 'x-csrf-token': response.json().csrf };
  };
  const alice = await auth('alice'), bob = await auth('bob'), manager = await auth('manager');
  const url = `/api/v1/games/${testManifest.id}/save`;
  const req = (route: string, payload?: object, session = alice) => app.platform.inject({ method: payload ? 'POST' : 'GET', url: route, headers: session, ...(payload ? { payload } : {}) });
  const write = (revision: number, formatVersion: number, version: string, data = { level: revision + 1 }, requestId = randomUUID()) => ({ data, revision, formatVersion, version, requestId });
  return { root, config, store, install, auth, alice, bob, manager, url, req, write };
}

test('format migration, old tabs, publication checks, private recovery and backups', async (t) => {
  const { root, config, store, auth, alice, bob, manager, url, req, write } = await fixture(t);
  assert.equal((await req(url + '?version=1.0.0')).json(), null);
  assert.equal((await req(url + '?version=2.0.0')).statusCode, 404);
  const first = write(0, 1, '1.0.0', { level: 7 });
  assert.equal((await req(url, first)).statusCode, 200);
  publish(store, testManifest.id, '2.0.0');
  const migration = write(1, 2, '2.0.0', { level: 8 });
  const migrated = await req(url, migration);
  assert.equal(migrated.statusCode, 200, migrated.body);
  assert.deepEqual((await req(url, migration)).json(), migrated.json());
  const snapshots = (await req(url + '/snapshots')).json();
  assert.equal(snapshots.snapshots.length, 1);
  assert.equal(snapshots.revision, 2);
  const before = store.sqlite.prepare('SELECT * FROM cloud_save_snapshots').get() as Record<string, unknown>;
  assert.equal(before.data, JSON.stringify(first.data));
  assert.equal(before.revision, 1); assert.equal(before.game_version, '1.0.0'); assert.equal(before.request_id, first.requestId);

  for (const response of [await req(url + '?version=1.0.0'), await req(url, write(2, 1, '1.0.0')), await req(url, write(2, 1, '2.0.0'))]) {
    assert.equal(response.statusCode, 409); assert.equal(response.json().code, 'SAVE_FORMAT_INCOMPATIBLE');
  }
  assert.equal((await req(url, { ...migration, data: { level: 99 } })).json().code, 'REQUEST_ID_REUSED');
  assert.equal((await req(url, write(1, 2, '2.0.0'))).json().code, 'SAVE_REVISION_CONFLICT');
  assert.equal((await req(url + '?version=2.0.0')).json().revision, 2);
  const adminBase = `/api/v1/admin/games/${testManifest.id}`;
  const summary = (await req(adminBase + '/versions/1.0.0', undefined, manager)).json();
  assert.deepEqual(summary.saveCompatibility, { status: 'incompatible', total: 1, affected: 1, formats: [{ formatVersion: 2, count: 1, compatibility: 'incompatible' }] });
  assert.equal(JSON.stringify(summary).includes('level'), false, 'manager gets no private data');
  assert.equal((await req(adminBase + '/publish', { version: '1.0.0', expectedActiveVersion: '2.0.0', expectedPublished: true }, manager)).json().code, 'SAVE_FORMAT_INCOMPATIBLE');
  const batch = await req('/api/v1/admin/publish-batches', { items: [{ gameId: testManifest.id, version: '3.0.0', expectedActiveVersion: '2.0.0', expectedPublished: true }] }, manager);
  assert.equal(batch.json().results[0].status, 'failed'); assert.match(batch.json().results[0].error, /存檔/);
  assert.equal((await req(adminBase + '/versions/4.0.0', undefined, manager)).json().saveCompatibility.status, 'unknown');
  publish(store, testManifest.id, '1.1.0'); // Explicitly compatible historical target may write format 1.
  assert.equal((await req(url)).json().formatVersion, 2);
  // After an intentional restore to format 1 and rollback, the older writer may not introduce format 2.
  const restoreInput = { snapshotId: snapshots.snapshots[0].id, revision: 2, requestId: randomUUID() };
  assert.equal((await req(url + '/restore', restoreInput, bob)).statusCode, 409);
  assert.equal((await req(url + '/restore', { ...restoreInput, revision: 0 }, bob)).statusCode, 404);
  assert.equal((await req(url + '/restore', { ...restoreInput, revision: 0 }, manager)).statusCode, 404);
  assert.deepEqual((await req(url + '/snapshots', undefined, manager)).json().snapshots, []);
  assert.equal((await req(url + '/restore', restoreInput, { ...alice, 'x-csrf-token': '' })).statusCode, 403);
  assert.equal((await req(url + '/restore', restoreInput, { ...alice, origin: config.gamesOrigin })).statusCode, 403);
  const restored = await req(url + '/restore', restoreInput);
  assert.equal(restored.statusCode, 200, restored.body);
  assert.deepEqual(restored.json().data, first.data); assert.equal(restored.json().revision, 3);
  assert.deepEqual((await req(url + '/restore', restoreInput)).json(), restored.json());
  assert.equal((await req(url + '/restore', { ...restoreInput, snapshotId: 999 })).json().code, 'REQUEST_ID_REUSED');
  assert.equal((await req(url, write(2, 1, '1.1.0'))).json().code, 'SAVE_REVISION_CONFLICT');
  publish(store, testManifest.id, '1.0.0');
  assert.equal((await req(url, write(3, 2, '2.0.0'))).json().code, 'SAVE_FORMAT_INCOMPATIBLE');
  publish(store, testManifest.id, '2.0.0');
  const second = await auth('alice');
  const competing = await Promise.all([req(url + '/restore', { ...restoreInput, revision: 3, requestId: randomUUID() }), req(url, write(3, 2, '2.0.0'), second)]);
  assert.deepEqual(competing.map((response) => response.statusCode).sort(), [200, 409]);
  assert.equal((await req(url)).json().revision, 4);
  await req('/api/v1/logout', {}, second);
  assert.equal((await req(url + '/restore', { ...restoreInput, revision: 4, requestId: randomUUID() }, second)).statusCode, 401);

  const current = store.sqlite.prepare('SELECT * FROM cloud_saves').all();
  const history = store.sqlite.prepare('SELECT * FROM cloud_save_snapshots ORDER BY id').all();
  await backup(config.dataDir, path.join(root, 'backup'));
  await restore(path.join(root, 'backup'), path.join(root, 'restored'));
  const recovered = openStore(path.join(root, 'restored'));
  try {
    assert.deepEqual(recovered.sqlite.prepare('SELECT * FROM cloud_saves').all(), current);
    assert.deepEqual(recovered.sqlite.prepare('SELECT * FROM cloud_save_snapshots ORDER BY id').all(), history);
    assert.deepEqual(recovered.sqlite.pragma('foreign_key_check'), []);
  } finally { recovered.sqlite.close(); }
  const analytics = (await req('/api/v1/admin/analytics', undefined, manager)).json();
  assert.equal(analytics.storage.snapshotCount, history.length);
  assert.ok(analytics.storage.snapshotDataBytes > 0);
});

test('snapshot failures roll back saves; legacy writes, bounded retention and eviction retries', async (t) => {
  const { store, req, url, write } = await fixture(t);
  await req(url, write(0, 1, '1.0.0'));
  publish(store, testManifest.id, '2.0.0');
  store.sqlite.exec("CREATE TRIGGER fail_snapshot BEFORE INSERT ON cloud_save_snapshots BEGIN SELECT RAISE(ABORT,'injected snapshot failure'); END");
  const migration = write(1, 2, '2.0.0');
  const failed = await req(url, migration);
  assert.equal(failed.statusCode, 500); assert.equal(failed.body.includes('injected snapshot'), false);
  assert.equal((await req(url)).json().revision, 1);
  assert.equal((await req(url + '/snapshots')).json().snapshots.length, 0);
  store.sqlite.exec('DROP TRIGGER fail_snapshot');
  assert.equal((await req(url, migration)).statusCode, 200);
  publish(store, testManifest.id, '4.0.0'); // Unknown retains legacy behavior, with snapshots on format changes.
  for (let revision = 2; revision < 25; revision++) {
    const response = await req(url, write(revision, revision + 1, '4.0.0'));
    assert.equal(response.statusCode, 200, response.body);
  }
  const history = (await req(url + '/snapshots')).json();
  assert.equal(history.snapshots.length, MAX_SAVE_SNAPSHOTS);
  assert.equal(history.snapshots.at(-1).revision, 5);
  const restoreInput = { revision: 25, snapshotId: history.snapshots.at(-1).id, requestId: randomUUID() };
  // Failure after insertion/pruning must restore both the old save and evicted snapshot.
  store.sqlite.exec("CREATE TRIGGER fail_save BEFORE UPDATE ON cloud_saves BEGIN SELECT RAISE(ABORT,'injected save failure'); END");
  assert.equal((await req(url + '/restore', restoreInput)).statusCode, 500);
  assert.deepEqual((await req(url + '/snapshots')).json(), history);
  assert.equal((await req(url)).json().revision, 25);
  store.sqlite.exec('DROP TRIGGER fail_save');
  const recovered = await req(url + '/restore', restoreInput);
  assert.equal(recovered.statusCode, 200, recovered.body);
  assert.equal(recovered.json().revision, 26);
  assert.equal(store.sqlite.prepare('SELECT 1 FROM cloud_save_snapshots WHERE id=?').get(restoreInput.snapshotId), undefined);
  assert.deepEqual((await req(url + '/restore', restoreInput)).json(), recovered.json(), 'retry survives source snapshot eviction');
  assert.equal((await req(url + '/snapshots')).json().snapshots.length, MAX_SAVE_SNAPSHOTS);
});
