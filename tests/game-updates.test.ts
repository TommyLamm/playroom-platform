import { CURRENT_SCHEMA_VERSION } from '../server/database/version.js';
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
import { installVersion, publish } from '../server/library.js';
import { legacyAdminLibrary } from './fixtures/legacy-admin-library.js';
import { backup, restore } from '../server/maintenance.js';
import { compareVersions, pendingVersion, updateRelease } from '../shared/game-updates.js';
import { updateRows, isPendingUpdate } from '../client/game-update-model.js';
import type { AdminGame, Release } from '../shared/types.js';
import type { Source } from '../shared/sources.js';
import { fakeGitHub, testManifest } from './helpers.js';
import { GitHubRateLimitError } from '../server/github.js';
import { publishGame, unpublishGame, reviewGame } from '../server/game-commands.js';

async function fixture(t: TestContext, installFiles = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-game-updates-'));
  const config = getConfig({ dataDir: path.join(root, 'data'), clientDir: path.join(root, 'none'), production: false });
  const store = openStore(config.dataDir);
  const hashed = await passwordHash('updates-test-password');
  store.db.insert(users).values([{ username: 'admin', role: 'admin', password: hashed }, { username: 'manager', role: 'game_manager', password: hashed }]).run();
  async function install(id: string, version: string) {
    const manifest = { ...testManifest, id, version };
    if (!installFiles) {
      // Command/race tests need database state, not filesystem installation.
      store.db.insert(games).values({ id }).onConflictDoNothing().run();
      store.db.insert(versions).values({ gameId: id, version, manifest, sha256: 'fixture', importedAt: new Date().toISOString() }).run();
      return;
    }
    const stage = path.join(config.dataDir, 'staging', `stage-${id}-${version}`);
    await fs.cp(path.resolve('examples/starter'), stage, { recursive: true });
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
  const state = (id = 'alpha') => {
    const game = store.db.select().from(games).where(eq(games.id, id)).get()!;
    return { expectedActiveVersion: game.activeVersion, expectedPublished: game.published };
  };
  const publishVersion = (version: string, headers = manager) => req('/games/alpha/publish', { version, ...state() }, headers);
  return { root, store, config, app, github, install, req, manager, admin, state, publishVersion };
}
test('shutdown releases HTTP handlers awaiting quota-paused checks', { timeout: 5000 }, async (t) => {
  const { req, app, github } = await fixture(t);
  const ids: number[] = [];
  for (let i = 0; i < 4; i++) ids.push((await req('/repositories', { fullName: `shutdown/game-${i}` })).json().repository.id);
  github.releases = async () => { throw new GitHubRateLimitError(Date.now() + 3600000); };
  assert.equal((await req('/source-checks', {})).statusCode, 202);
  const paused = await req(`/repositories/${ids[0]}/check`, {});
  assert.equal(paused.statusCode, 200); assert.match(paused.json().source.checkError, /額度/);
  const waiting = req(`/repositories/${ids[3]}/check`, {}).then((response) => response.statusCode);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await app.close();
  assert.equal(await waiting, 200);
  assert.equal(app.checks.current()?.status, 'cancelled');
});
test('preview approval is shared, version-specific and required by both publication endpoints', async (t) => {
  const { req, admin, manager, store, install, publishVersion } = await fixture(t);
  for (const [route, payload] of [['/games/alpha/review', { version: '2.0.0', approved: true }], ['/publish-batches', { items: [] }], ['/source-checks', {}]] as const) {
    assert.equal((await req(route, payload, { ...manager, 'x-csrf-token': 'invalid' })).statusCode, 403);
    assert.equal((await req(route, payload, { ...manager, origin: 'http://127.0.0.1:3001' })).statusCode, 403);
  }
  assert.equal((await publishVersion('2.0.0')).statusCode, 409);
  const item = { gameId: 'alpha', version: '2.0.0', expectedActiveVersion: '1.0.0', expectedPublished: true };
  assert.equal((await req('/publish-batches', { items: [item] })).json().results[0].status, 'failed');
  await req('/games/alpha/preview', { version: '2.0.0' });
  assert.equal((await publishVersion('2.0.0')).statusCode, 409, 'opening preview alone is not acceptance');
  const review = await req('/games/alpha/review', { version: '2.0.0', approved: true });
  assert.equal(review.statusCode, 200); assert.equal(review.json().version.reviewedBy, 'manager');
  const visible = (await req('/games/alpha/versions/2.0.0', undefined, admin)).json().version;
  assert.equal(visible.reviewedAt, review.json().version.reviewedAt);
  await install('alpha', '3.0.0');
  assert.equal(legacyAdminLibrary(store).find((g) => g.id === 'alpha')!.versions[0].reviewedAt, null);
  await req('/games/alpha/review', { version: '2.0.0', approved: false }, admin);
  assert.equal((await publishVersion('2.0.0')).statusCode, 409);
  const revoked = store.db.select().from(versions).all().find((v) => v.gameId === 'alpha' && v.version === '2.0.0')!;
  assert.equal(revoked.reviewedBy, null); assert.equal(revoked.reviewedAt, null);
  assert.equal((await req('/games/alpha/review', { version: '9.0.0', approved: true })).statusCode, 404);
});
test('batch publishing isolates failures, retries safely and rejects stale publication state', async (t) => {
  const { req, store, state, publishVersion } = await fixture(t);
  await req('/games/alpha/review', { version: '2.0.0', approved: true });
  const alpha = { gameId: 'alpha', version: '2.0.0', expectedActiveVersion: '1.0.0', expectedPublished: true };
  const beta = { gameId: 'beta', version: '1.0.0', expectedActiveVersion: null, expectedPublished: false };
  const first = (await req('/publish-batches', { items: [alpha, beta] })).json().results;
  assert.deepEqual(first.map((r: { status: string }) => r.status), ['published', 'failed']);
  assert.equal((await req('/publish-batches', { items: [alpha] })).json().results[0].status, 'skipped');
  await req('/games/alpha/unpublish', state());
  assert.equal((await req('/publish-batches', { items: [{ ...alpha, expectedActiveVersion: '2.0.0', expectedPublished: false }] })).json().results[0].status, 'published', 'the current published version can be relisted');
  await req('/games/beta/review', { version: '1.0.0', approved: true });
  store.db.update(games).set({ activeVersion: '0.5.0' }).where(eq(games.id, 'beta')).run();
  const conflict = (await req('/publish-batches', { items: [beta] })).json().results[0];
  assert.equal(conflict.status, 'failed'); assert.match(conflict.error, /其他管理者/);
  const retry = { ...beta, expectedActiveVersion: '0.5.0' };
  store.db.update(games).set({ published: true }).where(eq(games.id, 'beta')).run();
  assert.equal((await req('/publish-batches', { items: [retry] })).json().results[0].status, 'failed', 'publication state is checked too');
  assert.equal((await req('/publish-batches', { items: [{ ...retry, expectedPublished: true }] })).json().results[0].status, 'published');
  await req('/games/alpha/review', { version: '2.0.0', approved: false });
  assert.equal((await publishVersion('1.0.0')).statusCode, 200, 'historical rollback remains available');
  assert.equal((await publishVersion('2.0.0')).statusCode, 200, 'already published version needs no new review');
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
    assert.equal(restored.sqlite.pragma('user_version', { simple: true }), CURRENT_SCHEMA_VERSION);
    assert.deepEqual(restored.db.select().from(versions).all(), before);
    restored.sqlite.exec('ALTER TABLE versions DROP COLUMN reviewed_by; ALTER TABLE versions DROP COLUMN reviewed_at; DROP TABLE installations; DROP TABLE cloud_save_snapshots; DROP INDEX cloud_saves_game_format; ALTER TABLE cloud_saves DROP COLUMN source_snapshot_id; PRAGMA user_version=8;');
  } finally { restored.sqlite.close(); }
  await backup(path.join(root, 'v9-restored'), path.join(root, 'v8-backup'));
  await restore(path.join(root, 'v8-backup'), path.join(root, 'v8-restored'));
  const upgraded = openStore(path.join(root, 'v8-restored'));
  try {
    assert.equal(upgraded.sqlite.pragma('user_version', { simple: true }), CURRENT_SCHEMA_VERSION);
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

test('older unpublished versions do not make a current game pending or become selectable updates', () => {
  const release: Release = { id: 3, tag: 'v0.1.3', name: 'v0.1.3', publishedAt: '2026-10-10', prerelease: false, asset: { id: 3, name: 'game.zip', size: 10 } };
  const source = { id: 1, fullName: 'owner/wecraft', archived: false, checkError: null, checkedAt: '2026-10-10', importedReleaseIds: [3], status: 'current', releases: [release] } as Source;
  const game = { id: 'wecraft', repositoryId: 1, activeVersion: '0.1.3', published: true,
    versions: ['0.1.3', '0.1.0'].map((version, id) => ({ id, version, publishedAt: version === '0.1.3' ? '2026-10-10' : null, manifest: { ...testManifest, name: 'WeCraft' } })) } as AdminGame;
  for (const choices of [{}, { wecraft: '0.1.0' }]) {
    const [row] = updateRows([source], [game], choices);
    assert.equal(row.state, 'current'); assert.equal(isPendingUpdate(row), false);
    assert.equal(row.draft, undefined); assert.deepEqual(row.drafts, []);
  }
  game.versions.unshift({ ...game.versions[1], id: 4, version: '0.2.0-beta' });
  const [manual] = updateRows([source], [game]);
  assert.equal(manual.state, 'manual'); assert.deepEqual(manual.drafts.map((v) => v.version), ['0.2.0-beta']);
  assert.equal(updateRows([source], [game], { wecraft: '0.2.0-beta' })[0].draft?.version, '0.2.0-beta');
  game.versions.unshift({ ...game.versions[1], id: 5, version: '0.2.0', publishedAt: null });
  assert.equal(updateRows([source], [game])[0].draft?.version, '0.2.0');
});

test('publication rejects old unpublished drafts and batch downgrades while preserving explicit historical rollback', async (t) => {
  const { req, install, store, publishVersion } = await fixture(t);
  await install('alpha', '0.5.0');
  await req('/games/alpha/review', { version: '0.5.0', approved: true });
  assert.equal((await publishVersion('0.5.0')).statusCode, 409);
  const oldDraft = { gameId: 'alpha', version: '0.5.0', expectedActiveVersion: '1.0.0', expectedPublished: true };
  assert.match((await req('/publish-batches', { items: [oldDraft] })).json().results[0].error, /高於/);
  await req('/games/alpha/review', { version: '2.0.0', approved: true });
  assert.equal((await publishVersion('2.0.0')).statusCode, 200);
  const oldPublished = { ...oldDraft, version: '1.0.0', expectedActiveVersion: '2.0.0' };
  assert.match((await req('/publish-batches', { items: [oldPublished] })).json().results[0].error, /高於/);
  assert.equal(store.db.select().from(games).where(eq(games.id, 'alpha')).get()!.activeVersion, '2.0.0');
  assert.equal((await publishVersion('1.0.0')).statusCode, 200);
});

test('single and batch commands share validation, permissions and stable business errors', async (t) => {
  const { req, manager, state } = await fixture(t, false);
  assert.equal((await req('/games/alpha/publish', { version: '2.0.0' })).json().code, 'VALIDATION_ERROR');
  assert.equal((await req('/games/alpha/unpublish', {})).json().code, 'VALIDATION_ERROR');
  assert.equal((await req('/games/alpha/publish', { version: '2.0.0', ...state(), extra: true })).statusCode, 400);
  const item = { gameId: 'alpha', version: '2.0.0', ...state() };
  const single = await req('/games/alpha/publish', item);
  assert.equal(single.statusCode, 400, 'gameId is in the path, not the single body');
  const { gameId: _, ...body } = item;
  const blocked = await req('/games/alpha/publish', body);
  const batch = (await req('/publish-batches', { items: [item] })).json().results[0];
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().code, 'REVIEW_REQUIRED');
  assert.equal(batch.code, blocked.json().code); assert.equal(batch.error, blocked.json().error);
  for (const route of ['/games/alpha/publish', '/games/alpha/unpublish', '/publish-batches']) {
    assert.equal((await req(route, body, { ...manager, 'x-csrf-token': 'wrong' })).json().code, 'CSRF_INVALID');
    assert.equal((await req(route, body, { ...manager, origin: 'https://outside.invalid' })).json().code, 'ORIGIN_REJECTED');
    assert.equal((await req(route, body, { ...manager, cookie: '' })).json().code, 'AUTH_REQUIRED');
  }
});

test('two administrators cannot replace a changed state; retries skip only the same target', async (t) => {
  const { req, admin, install, state, store } = await fixture(t, false);
  await install('alpha', '3.0.0');
  await req('/games/alpha/review', { version: '2.0.0', approved: true });
  await req('/games/alpha/review', { version: '3.0.0', approved: true });
  const expected = state();
  const responses = await Promise.all([
    req('/games/alpha/publish', { version: '2.0.0', ...expected }),
    req('/games/alpha/publish', { version: '3.0.0', ...expected }, admin),
  ]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
  const loser = responses.find((r) => r.statusCode === 409)!;
  assert.equal(loser.json().code, 'STATE_CONFLICT'); assert.deepEqual(loser.json().details, { activeVersion: state().expectedActiveVersion, published: true });
  const winner = state().expectedActiveVersion!;
  assert.deepEqual((await req('/games/alpha/publish', { version: winner, ...expected })).json(), { ok: true, status: 'skipped' });
  assert.equal((await req('/publish-batches', { items: [{ gameId: 'alpha', version: winner, ...expected }] })).json().results[0].status, 'skipped');
  const untouched = store.db.select().from(versions).all().find((v) => v.version === (winner === '2.0.0' ? '3.0.0' : '2.0.0'))!;
  assert.equal(untouched.publishedAt, null);
  assert.equal((await req('/games/alpha/publish', { version: '1.0.0', ...expected })).json().code, 'STATE_CONFLICT');
  const current = state();
  assert.equal((await req('/games/alpha/unpublish', current)).json().status, 'unpublished');
  assert.equal((await req('/games/alpha/unpublish', current)).json().status, 'skipped');
  assert.equal((await req('/games/alpha/unpublish', expected)).json().code, 'STATE_CONFLICT', 'hidden newer version is still a changed state');
});

test('publish and unpublish races stop the stale command in either order', async (t) => {
  const { req, admin, state, store } = await fixture(t, false);
  await req('/games/alpha/review', { version: '2.0.0', approved: true });
  for (const unpublishFirst of [true, false]) {
    publish(store, 'alpha', '1.0.0');
    const expected = state();
    const operations = [
      () => req('/games/alpha/publish', { version: '2.0.0', ...expected }),
      () => req('/games/alpha/unpublish', expected, admin),
    ];
    if (unpublishFirst) operations.reverse();
    const responses = await Promise.all(operations.map((run) => run()));
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
    assert.equal(responses.find((r) => r.statusCode === 409)!.json().code, 'STATE_CONFLICT');
    const actual = state();
    assert.deepEqual(actual, unpublishFirst ? { expectedActiveVersion: '1.0.0', expectedPublished: false } : { expectedActiveVersion: '2.0.0', expectedPublished: true });
  }
});

test('revoked permissions and review are checked at commit, and database errors stay private', async (t) => {
  const { req, admin, state, store } = await fixture(t, false);
  const approval = (await req('/games/alpha/review', { version: '2.0.0', approved: true })).json().version;
  const repeated = (await req('/games/alpha/review', { version: '2.0.0', approved: true }, admin)).json().version;
  assert.equal(repeated.reviewedBy, approval.reviewedBy); assert.equal(repeated.reviewedAt, approval.reviewedAt);
  await req('/games/alpha/review', { version: '2.0.0', approved: false }, admin);
  const item = { gameId: 'alpha', version: '2.0.0', ...state() };
  assert.equal((await req('/publish-batches', { items: [item] })).json().results[0].code, 'REVIEW_REQUIRED');
  const actor = store.db.select().from(users).where(eq(users.username, 'manager')).get()!;
  store.db.update(users).set({ role: 'player' }).where(eq(users.id, actor.id)).run();
  for (const run of [() => publishGame(store, actor.id, item, 'single'), () => publishGame(store, actor.id, item, 'batch'),
    () => unpublishGame(store, actor.id, 'alpha', state()), () => reviewGame(store, actor.id, 'alpha', { version: '2.0.0', approved: true })])
    assert.throws(run, (e: unknown) => (e as { code: string }).code === 'PERMISSION_DENIED');
  assert.equal((await req('/games/alpha/publish', { version: '2.0.0', ...state() })).json().code, 'PERMISSION_DENIED');
  assert.equal((await req('/publish-batches', { items: [item] })).statusCode, 403);
  await req('/games/alpha/review', { version: '2.0.0', approved: true }, admin);
  await req('/games/beta/review', { version: '1.0.0', approved: true }, admin);
  store.sqlite.exec("CREATE TRIGGER fail_command BEFORE UPDATE ON games WHEN NEW.id='alpha' BEGIN SELECT RAISE(ABORT,'private database message'); END;");
  const failed = await req('/games/alpha/publish', { version: '2.0.0', ...state() }, admin);
  assert.equal(failed.statusCode, 500); assert.equal(failed.json().code, 'INTERNAL_ERROR'); assert.ok(!failed.body.includes('private database'));
  const results = (await req('/publish-batches', { items: [item, { gameId: 'beta', version: '1.0.0', expectedActiveVersion: null, expectedPublished: false }] }, admin)).json().results;
  assert.deepEqual(results.map((r: { code: string | null }) => r.code), ['INTERNAL_ERROR', null]);
  assert.equal(results[1].status, 'published'); assert.ok(!JSON.stringify(results).includes('private database'));
  assert.equal(state().expectedActiveVersion, '1.0.0');
  assert.equal(store.db.select().from(versions).all().find((v) => v.gameId === 'alpha' && v.version === '2.0.0')!.publishedAt, null, 'publish transaction rolls back the version marker too');
});

test('rate limits and missing endpoints expose stable codes', async (t) => {
  const { app, manager, req } = await fixture(t, false);
  assert.equal((await req('/missing')).json().code, 'NOT_FOUND');
  let response;
  for (let i = 0; i < 11; i++) response = await app.platform.inject({ method: 'POST', url: '/api/v1/login', headers: manager,
    payload: { username: 'missing', password: 'wrong-password' } });
  assert.equal(response!.statusCode, 429); assert.equal(response!.json().code, 'RATE_LIMITED');
});
