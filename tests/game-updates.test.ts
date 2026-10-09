import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { eq } from 'drizzle-orm';
import { getConfig } from '../server/config.js';
import { openStore, users, games, versions } from '../server/db.js';
import { createApplication } from '../server/app.js';
import { passwordHash } from '../server/auth.js';
import { installVersion, publish, adminLibrary } from '../server/library.js';
import { backup, restore } from '../server/maintenance.js';
import { compareVersions, pendingVersion, updateRelease } from '../shared/game-updates.js';
import type { AdminGame, Release } from '../shared/types.js';
import type { Source } from '../shared/sources.js';
import { fakeGitHub, testManifest } from './helpers.js';
import { GitHubRateLimitError } from '../server/github.js';

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-game-updates-'));
  const config = getConfig({ dataDir: path.join(root, 'data'), clientDir: path.join(root, 'none'), production: false });
  const store = openStore(config.dataDir);
  const hashed = await passwordHash('updates-test-password');
  store.db.insert(users).values([{ username: 'admin', role: 'admin', password: hashed }, { username: 'manager', role: 'game_manager', password: hashed }]).run();
  async function install(id: string, version: string) {
    const stage = path.join(root, `stage-${id}-${version}`);
    await fs.cp(path.resolve('examples/starter'), stage, { recursive: true });
    const manifest = { ...testManifest, id, version };
    await fs.writeFile(path.join(stage, 'game.json'), JSON.stringify(manifest));
    await installVersion(store, config, stage, manifest, { repositoryId: null, releaseId: null, assetId: null, releaseTag: null, sha256: 'fixture' });
  }
  await install('alpha', '1.0.0'); publish(store, 'alpha', '1.0.0');
  await install('alpha', '2.0.0'); await install('beta', '1.0.0');
  const github = await fakeGitHub(root);
  const app = await createApplication(config, store, { github });
  t.after(async () => { await app.close(); if (store.sqlite.open) store.sqlite.close(); await fs.rm(root, { recursive: true, force: true }); });
  const publicHeaders = { host: new URL(config.platformOrigin).host, origin: config.platformOrigin };
  async function login(username: string) {
    const result = await app.platform.inject({ method: 'POST', url: '/api/v1/login', payload: { username, password: 'updates-test-password' }, headers: publicHeaders });
    return { ...publicHeaders, cookie: String(result.headers['set-cookie']).split(';')[0], 'x-csrf-token': result.json().csrf };
  }
  const manager = await login('manager'), admin = await login('admin');
  const req = (route: string, payload?: object, headers = manager) => app.platform.inject({ url: `/api/v1/admin${route}`, method: payload ? 'POST' : 'GET', headers, ...(payload ? { payload } : {}) });
  return { root, store, config, app, github, install, req, manager, admin };
}
test('shutdown releases HTTP handlers awaiting quota-paused checks', { timeout: 5000 }, async (t) => {
  const { req, app, github } = await fixture(t);
  const ids: number[] = [];
  for (let i = 0; i < 4; i++) ids.push((await req('/repositories', { fullName: `shutdown/game-${i}` })).json().repository.id);
  github.releases = async () => { throw new GitHubRateLimitError(Date.now() + 3600000); };
  assert.equal((await req('/source-checks', {})).statusCode, 202);
  const waiting = req(`/repositories/${ids[3]}/check`, {}).then((response) => response.statusCode);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await app.close();
  assert.equal(await waiting, 200);
  assert.equal(app.checks.current()?.status, 'cancelled');
});
test('preview approval is shared, version-specific and required by both publication endpoints', async (t) => {
  const { req, admin, manager, store, install } = await fixture(t);
  for (const [route, payload] of [['/games/alpha/review', { version: '2.0.0', approved: true }], ['/publish-batches', { items: [] }], ['/source-checks', {}]] as const) {
    assert.equal((await req(route, payload, { ...manager, 'x-csrf-token': 'invalid' })).statusCode, 403);
    assert.equal((await req(route, payload, { ...manager, origin: 'http://127.0.0.1:3001' })).statusCode, 403);
  }
  assert.equal((await req('/games/alpha/publish', { version: '2.0.0' })).statusCode, 409);
  const item = { gameId: 'alpha', version: '2.0.0', expectedActiveVersion: '1.0.0', expectedPublished: true };
  assert.equal((await req('/publish-batches', { items: [item] })).json().results[0].status, 'failed');
  await req('/games/alpha/preview', { version: '2.0.0' });
  assert.equal((await req('/games/alpha/publish', { version: '2.0.0' })).statusCode, 409, 'opening preview alone is not acceptance');
  const review = await req('/games/alpha/review', { version: '2.0.0', approved: true });
  assert.equal(review.statusCode, 200); assert.equal(review.json().version.reviewedBy, 'manager');
  const visible = (await req('/overview', undefined, admin)).json().games.find((g: AdminGame) => g.id === 'alpha').versions.find((v: { version: string }) => v.version === '2.0.0');
  assert.equal(visible.reviewedAt, review.json().version.reviewedAt);
  await install('alpha', '3.0.0');
  assert.equal(adminLibrary(store).find((g) => g.id === 'alpha')!.versions[0].reviewedAt, null);
  await req('/games/alpha/review', { version: '2.0.0', approved: false }, admin);
  assert.equal((await req('/games/alpha/publish', { version: '2.0.0' })).statusCode, 409);
  const revoked = store.db.select().from(versions).all().find((v) => v.gameId === 'alpha' && v.version === '2.0.0')!;
  assert.equal(revoked.reviewedBy, null); assert.equal(revoked.reviewedAt, null);
  assert.equal((await req('/games/alpha/review', { version: '9.0.0', approved: true })).statusCode, 404);
});
test('batch publishing isolates failures, retries safely and rejects stale publication state', async (t) => {
  const { req, store } = await fixture(t);
  await req('/games/alpha/review', { version: '2.0.0', approved: true });
  const alpha = { gameId: 'alpha', version: '2.0.0', expectedActiveVersion: '1.0.0', expectedPublished: true };
  const beta = { gameId: 'beta', version: '1.0.0', expectedActiveVersion: null, expectedPublished: false };
  const first = (await req('/publish-batches', { items: [alpha, beta] })).json().results;
  assert.deepEqual(first.map((r: { status: string }) => r.status), ['published', 'failed']);
  assert.equal((await req('/publish-batches', { items: [alpha] })).json().results[0].status, 'skipped');
  await req('/games/beta/review', { version: '1.0.0', approved: true });
  store.db.update(games).set({ activeVersion: '0.5.0' }).where(eq(games.id, 'beta')).run();
  const conflict = (await req('/publish-batches', { items: [beta] })).json().results[0];
  assert.equal(conflict.status, 'failed'); assert.match(conflict.error, /其他管理者/);
  const retry = { ...beta, expectedActiveVersion: '0.5.0' };
  store.db.update(games).set({ published: true }).where(eq(games.id, 'beta')).run();
  assert.equal((await req('/publish-batches', { items: [retry] })).json().results[0].status, 'failed', 'publication state is checked too');
  assert.equal((await req('/publish-batches', { items: [{ ...retry, expectedPublished: true }] })).json().results[0].status, 'published');
  await req('/games/alpha/review', { version: '2.0.0', approved: false });
  assert.equal((await req('/games/alpha/publish', { version: '1.0.0' })).statusCode, 200, 'historical rollback remains available');
  assert.equal((await req('/games/alpha/publish', { version: '2.0.0' })).statusCode, 200, 'already published version needs no new review');
  assert.equal((await req('/publish-batches', { items: [alpha, alpha] })).statusCode, 400);
  assert.equal((await req('/publish-batches', { items: Array.from({ length: 101 }, (_, i) => ({ ...alpha, gameId: `game-${i}` })) })).statusCode, 400);
  assert.equal((await req('/publish-batches', { items: [] })).statusCode, 400);
});
test('v9 approval survives reopening and backup/restore; v8 backups migrate without approving drafts', async (t) => {
  const { store, req, root, config, app } = await fixture(t);
  await req('/games/alpha/review', { version: '2.0.0', approved: true });
  await app.close();
  const before = store.db.select().from(versions).all();
  store.sqlite.close();
  const reopened = openStore(config.dataDir);
  try { assert.deepEqual(reopened.db.select().from(versions).all(), before); } finally { reopened.sqlite.close(); }
  await backup(config.dataDir, path.join(root, 'v9-backup'));
  await restore(path.join(root, 'v9-backup'), path.join(root, 'v9-restored'));
  const restored = openStore(path.join(root, 'v9-restored'));
  try {
    assert.equal(restored.sqlite.pragma('user_version', { simple: true }), 9);
    assert.deepEqual(restored.db.select().from(versions).all(), before);
    restored.sqlite.exec('ALTER TABLE versions DROP COLUMN reviewed_by; ALTER TABLE versions DROP COLUMN reviewed_at; PRAGMA user_version=8;');
  } finally { restored.sqlite.close(); }
  await backup(path.join(root, 'v9-restored'), path.join(root, 'v8-backup'));
  await restore(path.join(root, 'v8-backup'), path.join(root, 'v8-restored'));
  const upgraded = openStore(path.join(root, 'v8-restored'));
  try {
    assert.equal(upgraded.sqlite.pragma('user_version', { simple: true }), 9);
    assert.ok(upgraded.db.select().from(versions).all().every((v) => v.reviewedAt === null && v.reviewedBy === null));
    assert.equal(upgraded.db.select().from(games).all().find((g) => g.id === 'alpha')!.activeVersion, '1.0.0');
    assert.deepEqual(upgraded.sqlite.pragma('foreign_key_check'), []);
  } finally { upgraded.sqlite.close(); }
});
test('automatic candidates use latest stable release and never downgrade or silently choose prereleases', () => {
  const release = (id: number, tag: string, date: string, prerelease = false): Release => ({ id, tag, publishedAt: date, prerelease, name: tag, asset: { id, name: 'game.zip', size: 10 } });
  const game = { activeVersion: '2.0.0', versions: [], published: true } as unknown as AdminGame;
  const source = { archived: false, checkError: null, importedReleaseIds: [], status: 'available', releases: [release(1, 'v1.0.0', '2026-10-10'), release(2, 'v3.0.0', '2026-10-09'), release(3, 'v4.0.0-beta', '2026-10-11', true)] } as Source;
  assert.equal(updateRelease(source, game), undefined, 'newest by publication time is old, do not fall back');
  source.releases = source.releases.filter((r) => r.id !== 1);
  assert.equal(updateRelease(source, game)?.id, 2);
  source.importedReleaseIds = [2]; assert.equal(updateRelease(source, game), undefined);
  assert.ok(compareVersions('10.0.0', '2.0.0') > 0); assert.ok(compareVersions('2.0.0', '2.0.0-beta') > 0);
  assert.ok(compareVersions('2.0.0-beta.10', '2.0.0-beta.2') > 0);
  assert.ok(compareVersions('9007199254740993.0.0', '9007199254740992.0.0') > 0);
  game.versions = ['3.0.0-beta', '1.0.0', '3.0.0'].map((version) => ({ version, publishedAt: null })) as AdminGame['versions'];
  assert.equal(pendingVersion(game)?.version, '3.0.0');
});
