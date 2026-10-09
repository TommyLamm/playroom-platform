import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getConfig } from '../server/config.js';
import { openStore } from '../server/db.js';
import { createApplication } from '../server/app.js';
import { backup, restore, seedDemos } from '../server/maintenance.js';
import { passwordHash } from '../server/auth.js';

const password = 'settings-player-password';
type Headers = Record<string, string>;
async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-settings-'));
  const config = getConfig({ dataDir: path.join(root, 'data'), clientDir: path.join(root, 'none'), production: false });
  const store = openStore(config.dataDir);
  await seedDemos(store, config);
  const app = await createApplication(config, store);
  t.after(async () => { await app.close(); store.sqlite.close(); await fs.rm(root, { recursive: true, force: true }); });
  let address = 1;
  const req = (url: string, body?: unknown, headers: Headers = {}) => app.platform.inject({
    method: body === undefined ? 'GET' : 'POST', url, payload: body as object,
    headers: { host: new URL(config.platformOrigin).host, origin: config.platformOrigin, ...headers },
    remoteAddress: `192.0.2.${address++}`,
  });
  const signIn = async (username: string, register = true) => {
    const response = await req(`/api/v1/${register ? 'register' : 'login'}`, { username, password });
    assert.ok([200, 201].includes(response.statusCode), response.body);
    return { cookie: String(response.headers['set-cookie']).split(';')[0], 'x-csrf-token': response.json().csrf };
  };
  return { root, config, store, app, req, signIn };
}

test('account settings are own-only with strict input, CSRF and Origin checks', async (t) => {
  const { req, signIn, config } = await fixture(t);
  const alice = await signIn('settings_alice');
  const bob = await signIn('settings_bob');
  assert.equal((await req('/api/v1/me/settings')).statusCode, 401);
  assert.deepEqual((await req('/api/v1/me/settings', undefined, alice)).json(), { careerVisibility: 'public', otherSessions: 0 });
  assert.equal((await req('/api/v1/me/settings?userId=1', undefined, alice)).statusCode, 400);
  assert.equal((await req('/api/v1/me/settings', { careerVisibility: 'private', userId: 2 }, alice)).statusCode, 400);
  assert.equal((await req('/api/v1/me/settings', { careerVisibility: 'secret' }, alice)).statusCode, 400);
  assert.equal((await req('/api/v1/me/settings', { careerVisibility: 'private' }, { ...alice, 'x-csrf-token': 'bad' })).statusCode, 403);
  assert.equal((await req('/api/v1/me/settings', { careerVisibility: 'private' }, { ...alice, origin: config.gamesOrigin })).statusCode, 403);
  for (const [url, body] of [
    ['/api/v1/me/password', { currentPassword: password, newPassword: 'new-settings-password' }],
    ['/api/v1/me/sessions/revoke', { currentPassword: password }],
  ] as const) {
    assert.equal((await req(url, body, { ...alice, 'x-csrf-token': 'bad' })).statusCode, 403);
    assert.equal((await req(url, body, { ...alice, origin: config.gamesOrigin })).statusCode, 403);
    assert.equal((await req(url, { ...body, userId: 2 }, alice)).statusCode, 400);
  }
  assert.equal((await req('/api/v1/me/settings', { careerVisibility: 'limited' }, alice)).json().careerVisibility, 'limited');
  assert.equal((await req('/api/v1/me/settings', undefined, bob)).json().careerVisibility, 'public');
});

test('career visibility redacts activity for guests, protects private careers and preserves public boards', async (t) => {
  const { req, signIn, store } = await fixture(t);
  const alice = await signIn('privacy_alice');
  const bob = await signIn('privacy_bob');
  store.sqlite.prepare("UPDATE users SET role='admin' WHERE username='privacy_bob'").run();
  const play = (await req('/api/v1/games/signal-tap/plays', { version: '1.2.0', requestId: randomUUID() }, alice)).json().playId;
  const run = (await req(`/api/v1/plays/${play}/runs`, { requestId: randomUUID() }, alice)).json().runId;
  assert.equal((await req(`/api/v1/runs/${run}/finish`, { score: 12 }, alice)).statusCode, 200);
  const career = (headers: Headers = {}) => req('/api/v1/players/privacy_alice/career', undefined, headers);
  assert.equal((await career()).json().activityVisible, true);
  await req('/api/v1/me/settings', { careerVisibility: 'limited' }, alice);
  for (const headers of [{}, bob]) {
    const limited = (await career(headers)).json();
    assert.equal(limited.activityVisible, false);
    assert.deepEqual(limited.totals, { games: 1, opens: null, completedRuns: null, activeMs: null });
    assert.equal(limited.games[0].opens, null);
    assert.equal(limited.games[0].completedRuns, null);
    assert.equal(limited.games[0].activeMs, null);
    assert.equal(limited.games[0].lastPlayedAt, null);
    assert.equal(limited.games[0].bests[0].score, 12);
  }
  assert.equal((await career(alice)).json().totals.opens, 1);
  await req('/api/v1/me/settings', { careerVisibility: 'private' }, alice);
  const missing = await req('/api/v1/players/unknown_player/career');
  for (const headers of [{}, bob]) {
    const hidden = await career(headers);
    assert.equal(hidden.statusCode, 404);
    assert.deepEqual(hidden.json(), missing.json());
  }
  assert.equal((await career(alice)).json().activityVisible, true);
  assert.equal((await req('/api/v1/me/results', undefined, alice)).json().total, 1);
  assert.equal((await req('/api/v1/games/signal-tap/leaderboards/classic')).json().entries[0].username, 'privacy_alice');
});

test('password change rotates the current session and revokes all others without affecting another player', async (t) => {
  const { req, signIn } = await fixture(t);
  const alice = await signIn('password_alice');
  const second = await signIn('password_alice', false);
  const bob = await signIn('password_bob');
  assert.equal((await req('/api/v1/me/settings', undefined, alice)).json().otherSessions, 1);
  assert.equal((await req('/api/v1/me/password', { currentPassword: 'incorrect', newPassword: 'new-player-password' }, alice)).statusCode, 400);
  assert.equal((await req('/api/v1/me/password', { currentPassword: password, newPassword: 'short' }, alice)).statusCode, 400);
  const changed = await req('/api/v1/me/password', { currentPassword: password, newPassword: 'new-player-password' }, alice);
  assert.equal(changed.statusCode, 200, changed.body);
  assert.notEqual(changed.json().session.csrf, alice['x-csrf-token']);
  const rotated = { cookie: String(changed.headers['set-cookie']).split(';')[0], 'x-csrf-token': changed.json().session.csrf };
  for (const headers of [alice, second]) assert.equal((await req('/api/v1/me/settings', undefined, headers)).statusCode, 401);
  assert.equal((await req('/api/v1/me/settings', undefined, rotated)).json().otherSessions, 0);
  assert.equal((await req('/api/v1/me/settings', undefined, bob)).statusCode, 200);
  assert.equal((await req('/api/v1/login', { username: 'password_alice', password })).statusCode, 401);
  assert.equal((await req('/api/v1/login', { username: 'password_alice', password: 'new-player-password' })).statusCode, 200);
});

test('revoking other devices keeps current session and applies sensitive limits per account', async (t) => {
  const { req, signIn } = await fixture(t);
  const alice = await signIn('devices_alice');
  const second = await signIn('devices_alice', false);
  const bob = await signIn('devices_bob');
  assert.equal((await req('/api/v1/me/sessions/revoke', { currentPassword: 'wrong' }, alice)).statusCode, 400);
  assert.deepEqual((await req('/api/v1/me/sessions/revoke', { currentPassword: password }, alice)).json(), { revoked: 1 });
  assert.equal((await req('/api/v1/me/settings', undefined, alice)).statusCode, 200);
  assert.equal((await req('/api/v1/me/settings', undefined, second)).statusCode, 401);
  assert.equal((await req('/api/v1/me/settings', undefined, bob)).statusCode, 200);
  const third = await signIn('devices_alice', false);
  for (let i = 0; i < 3; i++) {
    const url = i % 2 ? '/api/v1/me/password' : '/api/v1/me/sessions/revoke';
    const body = i % 2 ? { currentPassword: 'wrong', newPassword: 'new-settings-password' } : { currentPassword: 'wrong' };
    assert.equal((await req(url, body, i % 2 ? third : alice)).statusCode, 400);
  }
  assert.equal((await req('/api/v1/me/sessions/revoke', { currentPassword: password }, third)).statusCode, 429);
  assert.equal((await req('/api/v1/me/sessions/revoke', { currentPassword: password }, bob)).statusCode, 200);
});

test('visibility update limits span sessions and keep another account independent', async (t) => {
  const { req, signIn } = await fixture(t);
  const alice = await signIn('visibility_limit');
  const second = await signIn('visibility_limit', false);
  const bob = await signIn('visibility_other');
  for (let i = 0; i < 30; i++) assert.equal((await req('/api/v1/me/settings', { careerVisibility: 'limited' }, i % 2 ? second : alice)).statusCode, 200);
  assert.equal((await req('/api/v1/me/settings', { careerVisibility: 'public' }, second)).statusCode, 429);
  assert.equal((await req('/api/v1/me/settings', { careerVisibility: 'private' }, bob)).statusCode, 200);
});

test('asynchronous password checks cannot mutate after logout or accept an in-flight old-password login', async (t) => {
  const { req, signIn, app, store } = await fixture(t);
  let mutation: (() => void) | undefined;
  app.platform.addHook('preHandler', async (request) => {
    if (request.url === '/api/v1/me/password' || request.url === '/api/v1/me/sessions/revoke' || request.url === '/api/v1/login') {
      const action = mutation;
      mutation = undefined;
      if (action) setImmediate(action);
    }
  });
  const alice = await signIn('race_alice');
  const oldHash = (store.sqlite.prepare("SELECT password FROM users WHERE username='race_alice'").get() as { password: string }).password;
  mutation = () => { store.sqlite.prepare("DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE username='race_alice')").run(); };
  assert.equal((await req('/api/v1/me/password', { currentPassword: password, newPassword: 'different-player-password' }, alice)).statusCode, 401);
  assert.equal((store.sqlite.prepare("SELECT password FROM users WHERE username='race_alice'").get() as { password: string }).password, oldHash);
  const next = await signIn('race_alice', false);
  mutation = () => { store.sqlite.prepare("DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE username='race_alice')").run(); };
  assert.equal((await req('/api/v1/me/sessions/revoke', { currentPassword: password }, next)).statusCode, 401);
  const changedHash = await passwordHash('different-player-password');
  const last = await signIn('race_alice', false);
  mutation = () => { store.sqlite.prepare("UPDATE users SET password=? WHERE username='race_alice'").run(changedHash); };
  assert.equal((await req('/api/v1/me/password', { currentPassword: password, newPassword: 'must-not-overwrite-password' }, last)).statusCode, 401);
  assert.equal((store.sqlite.prepare("SELECT password FROM users WHERE username='race_alice'").get() as { password: string }).password, changedHash);
  store.sqlite.prepare("DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE username='race_alice')").run();
  store.sqlite.prepare("UPDATE users SET password=? WHERE username='race_alice'").run(oldHash);
  mutation = () => { store.sqlite.prepare("UPDATE users SET password=? WHERE username='race_alice'").run(changedHash); };
  assert.equal((await req('/api/v1/login', { username: 'race_alice', password })).statusCode, 401);
  assert.equal((store.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id=(SELECT id FROM users WHERE username='race_alice')").get() as { count: number }).count, 0);
});

test('settings survive backups and schema-four migration preserves sessions, favorites and records', async (t) => {
  const { req, signIn, root, config, store } = await fixture(t);
  const alice = await signIn('backup_alice');
  await req('/api/v1/me/settings', { careerVisibility: 'private' }, alice);
  const play = (await req('/api/v1/games/signal-tap/plays', { version: '1.2.0', requestId: randomUUID() }, alice)).json().playId;
  const run = (await req(`/api/v1/plays/${play}/runs`, { requestId: randomUUID() }, alice)).json().runId;
  assert.equal((await req(`/api/v1/runs/${run}/finish`, { score: 7 }, alice)).statusCode, 200);
  await backup(config.dataDir, path.join(root, 'backup'));
  await restore(path.join(root, 'backup'), path.join(root, 'restored'));
  const recovered = openStore(path.join(root, 'restored'));
  try {
    assert.equal(recovered.sqlite.pragma('user_version', { simple: true }), 9);
    assert.equal((recovered.sqlite.prepare('SELECT career_visibility FROM account_settings').get() as { career_visibility: string }).career_visibility, 'private');
    assert.equal((recovered.sqlite.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count, 0);
    assert.equal((recovered.sqlite.prepare('SELECT score FROM runs WHERE id=?').get(run) as { score: number }).score, 7);
  } finally { recovered.sqlite.close(); }
  const favorite = await req('/api/v1/me/favorites/signal-tap', { favorite: true }, alice);
  // Existing library API remains usable independent of account visibility.
  assert.equal(favorite.statusCode, 200);
  store.sqlite.exec('DROP TABLE import_batch_items; DROP TABLE import_batches; DROP TABLE github_owners; ALTER TABLE repositories DROP COLUMN archived; ALTER TABLE repositories DROP COLUMN checked_at; ALTER TABLE repositories DROP COLUMN check_error; ALTER TABLE repositories DROP COLUMN cached_releases; DROP TABLE visitor_events; DROP TABLE account_settings; DROP TABLE score_submission_metrics; DROP TABLE operational_state; PRAGMA user_version=4;');
  const migrated = openStore(config.dataDir);
  try {
    assert.equal(migrated.sqlite.pragma('user_version', { simple: true }), 9);
    assert.equal((migrated.sqlite.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count, 1);
    assert.equal((migrated.sqlite.prepare('SELECT COUNT(*) AS count FROM versions').get() as { count: number }).count, 2);
    assert.equal((migrated.sqlite.prepare('SELECT COUNT(*) AS count FROM favorites').get() as { count: number }).count, 1);
    assert.equal((migrated.sqlite.prepare('SELECT score FROM best_scores').get() as { score: number }).score, 7);
    assert.equal((migrated.sqlite.prepare('SELECT score FROM runs WHERE id=?').get(run) as { score: number }).score, 7);
    assert.deepEqual(migrated.sqlite.pragma('foreign_key_check'), []);
  } finally { migrated.sqlite.close(); }
});
