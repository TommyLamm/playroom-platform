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
import { installVersion, publish } from '../server/library.js';
import { manifestSchema } from '../shared/manifest.js';

test('careers and scores: ownership, idempotency, ranking, rules, activity and recovery', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-career-'));
  const config = getConfig({ dataDir: path.join(root, 'data'), clientDir: path.join(root, 'none'), production: false });
  const store = openStore(config.dataDir);
  await seedDemos(store, config);
  const app = await createApplication(config, store);
  t.after(async () => { await app.close(); store.sqlite.close(); await fs.rm(root, { recursive: true, force: true }); });
  type Headers = Record<string, string>;
  const base = { host: new URL(config.platformOrigin).host, origin: config.platformOrigin };
  let remote = 1;
  const req = (url: string, body?: unknown, headers: Headers = {}) => app.platform.inject({ method: body === undefined ? 'GET' : 'POST', url, payload: body as object, headers: { ...base, ...headers }, remoteAddress: `192.0.2.${remote++}` });
  async function register(username: string) {
    const response = await req('/api/v1/register', { username, password: 'career-player-password' });
    assert.equal(response.statusCode, 201, response.body);
    return { cookie: String(response.headers['set-cookie']).split(';')[0], 'x-csrf-token': response.json().csrf };
  }
  const alice = await register('alice');
  const bob = await register('bob');
  async function open(headers: Headers, version = '1.2.0') {
    const response = await req('/api/v1/games/signal-tap/plays', { version, requestId: randomUUID() }, headers);
    assert.equal(response.statusCode, 201, response.body);
    return response.json().playId as string;
  }
  async function run(playId: string, headers: Headers) {
    const response = await req(`/api/v1/plays/${playId}/runs`, { requestId: randomUUID() }, headers);
    assert.equal(response.statusCode, 201, response.body);
    return response.json().runId as string;
  }
  const finish = (id: string, score: number, headers: Headers) => req(`/api/v1/runs/${id}/finish`, { score }, headers);
  const alicePlay = await open(alice);
  const bobPlay = await open(bob);
  const aliceRun = await run(alicePlay, alice);
  await t.test('session, CSRF, Origin and ownership protect all writes and private reads', async () => {
    assert.equal((await req('/api/v1/me/results')).statusCode, 401);
    assert.equal((await req('/api/v1/me/results?username=alice', undefined, bob)).statusCode, 400);
    assert.equal((await req(`/api/v1/plays/${alicePlay}/heartbeat`, {}, bob)).statusCode, 404);
    assert.equal((await req(`/api/v1/plays/${alicePlay}/runs`, { requestId: randomUUID() }, bob)).statusCode, 404);
    assert.equal((await finish(aliceRun, 30, bob)).statusCode, 404);
    assert.equal((await finish(aliceRun, 30, {})).statusCode, 401);
    assert.equal((await req(`/api/v1/runs/${aliceRun}/finish`, { score: 30 }, { ...alice, 'x-csrf-token': '' })).statusCode, 403);
    assert.equal((await req(`/api/v1/runs/${aliceRun}/finish`, { score: 30 }, { ...alice, origin: config.gamesOrigin })).statusCode, 403);
    assert.equal((await req('/api/v1/players/missing/career')).statusCode, 404);
  });
  await t.test('zero scores, validation, immutable results and duplicate requests', async () => {
    for (const score of [-1, 1.5, 10001, Number.MAX_SAFE_INTEGER + 1]) assert.equal((await finish(aliceRun, score, alice)).statusCode, 400);
    assert.equal((await req(`/api/v1/runs/${aliceRun}/finish`, { score: 30, userId: 2 }, alice)).statusCode, 400);
    assert.equal((await finish(aliceRun, 0, alice)).statusCode, 200);
    assert.equal((await finish(aliceRun, 0, alice)).statusCode, 200);
    assert.equal((await finish(aliceRun, 1, alice)).statusCode, 409);
    const requestId = randomUUID();
    const first = await req(`/api/v1/plays/${alicePlay}/runs`, { requestId }, alice);
    const duplicate = await req(`/api/v1/plays/${alicePlay}/runs`, { requestId }, alice);
    assert.equal(first.json().runId, duplicate.json().runId);
    const visitId = randomUUID();
    const visit = await req('/api/v1/games/signal-tap/plays', { version: '1.2.0', requestId: visitId }, alice);
    const again = await req('/api/v1/games/signal-tap/plays', { version: '1.2.0', requestId: visitId }, alice);
    assert.equal(visit.json().playId, again.json().playId);
    const history = (await req('/api/v1/me/results', undefined, alice)).json();
    assert.equal(history.total, 1);
    assert.equal((await req('/api/v1/me/results', undefined, bob)).json().total, 0);
    const career = (await req('/api/v1/players/ALICE/career')).json();
    assert.equal(career.username, 'alice');
    assert.equal(career.totals.opens, 2);
    assert.equal(career.totals.completedRuns, 1);
    assert.ok(!JSON.stringify(career).includes('finishedAt'));
  });
  await t.test('best scores and ties use competition ranks and first-achieved ordering', async () => {
    assert.equal((await finish(await run(alicePlay, alice), 50, alice)).statusCode, 200);
    assert.equal((await finish(await run(bobPlay, bob), 50, bob)).statusCode, 200);
    await finish(await run(alicePlay, alice), 20, alice);
    const board = (await req('/api/v1/games/signal-tap/leaderboards/classic', undefined, alice)).json();
    assert.deepEqual(board.entries.map((r: { rank: number; score: number }) => [r.rank, r.score]), [[1, 50], [1, 50]]);
    assert.equal(board.entries[0].username, 'alice');
    assert.equal(board.me.rank, 1);
    const history = (await req('/api/v1/me/results?gameId=signal-tap&pageSize=1&page=2', undefined, alice)).json();
    assert.equal(history.total, 3);
    assert.equal(history.results.length, 1);
    assert.equal(history.results[0].score, 50);
  });
  await t.test('heartbeat excludes paused time and stale gaps', async () => {
    store.sqlite.prepare('UPDATE plays SET last_heartbeat_at=?,heartbeat_active=1 WHERE id=?').run(Date.now() - 10000, alicePlay);
    await req(`/api/v1/plays/${alicePlay}/heartbeat`, { active: false }, alice);
    const current = () => (store.sqlite.prepare('SELECT active_ms FROM plays WHERE id=?').get(alicePlay) as { active_ms: number }).active_ms;
    const active = current();
    assert.ok(active >= 10000 && active < 11000);
    store.sqlite.prepare('UPDATE plays SET last_heartbeat_at=? WHERE id=?').run(Date.now() - 10000, alicePlay);
    await req(`/api/v1/plays/${alicePlay}/heartbeat`, { active: true }, alice);
    assert.equal(current(), active);
    store.sqlite.prepare('UPDATE plays SET last_heartbeat_at=? WHERE id=?').run(Date.now() - 31000, alicePlay);
    await req(`/api/v1/plays/${alicePlay}/heartbeat`, {}, alice);
    assert.equal(current(), active);
  });
  async function install(version: string, boardId: string | null, order: 'asc' | 'desc' = 'desc', maxScore = 10000) {
    const baseManifest = JSON.parse(await fs.readFile('examples/starter/game.json', 'utf8'));
    const game = manifestSchema.parse({ ...baseManifest, version, leaderboard: boardId ? { id: boardId, order, unit: '分', minScore: 0, maxScore } : undefined });
    const stage = path.join(root, `stage-${randomUUID()}`);
    await fs.cp('examples/starter', stage, { recursive: true });
    await fs.writeFile(path.join(stage, 'game.json'), JSON.stringify(game));
    await installVersion(store, config, stage, game, { repositoryId: null, releaseId: null, assetId: null, releaseTag: null, sha256: 'a'.repeat(64) });
    return game;
  }
  await t.test('rule-compatible versions share boards, changed rules need a new board, ascending boards work', async () => {
    await install('1.3.0', 'classic');
    publish(store, 'signal-tap', '1.3.0');
    const nextPlay = await open(alice, '1.3.0');
    await finish(await run(nextPlay, alice), 60, alice);
    assert.equal((await req('/api/v1/games/signal-tap/leaderboards/classic')).json().entries[0].score, 60);
    await assert.rejects(install('1.4.0', 'classic', 'asc'), /leaderboard.id/);
    await assert.rejects(install('1.4.0', 'classic', 'desc', 100), /leaderboard.id/);
    await install('2.0.0', 'speed', 'asc');
    publish(store, 'signal-tap', '2.0.0');
    const speedA = await open(alice, '2.0.0');
    const speedB = await open(bob, '2.0.0');
    await finish(await run(speedA, alice), 100, alice);
    await finish(await run(speedA, alice), 80, alice);
    await finish(await run(speedB, bob), 90, bob);
    const board = (await req('/api/v1/games/signal-tap/leaderboards/speed', undefined, bob)).json();
    assert.deepEqual(board.entries.map((r: { score: number }) => r.score), [80, 90]);
    assert.equal(board.me.rank, 2);
    assert.equal((await req('/api/v1/games/signal-tap/leaderboards')).json().boards.length, 2);
    assert.equal((await req('/api/v1/games/signal-tap/leaderboards')).json().activeBoardId, 'speed');
    // Previously published versions remain valid while the game is listed.
    await finish(await run(alicePlay, alice), 65, alice);
    await install('3.0.0', null);
    publish(store, 'signal-tap', '3.0.0');
    const unsupported = await open(alice, '3.0.0');
    assert.equal((await req(`/api/v1/plays/${unsupported}/runs`, { requestId: randomUUID() }, alice)).statusCode, 400);
  });
  await t.test('backup restores all records and clears sessions; v2 migrates without resetting accounts', async () => {
    const destination = path.join(root, 'backup');
    await backup(config.dataDir, destination);
    const restoredDir = path.join(root, 'restored');
    await restore(destination, restoredDir);
    const recovered = openStore(restoredDir);
    try {
      assert.equal(recovered.sqlite.pragma('user_version', { simple: true }), 7);
      for (const table of ['plays', 'runs', 'best_scores']) assert.deepEqual(recovered.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), store.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
      assert.equal((recovered.sqlite.prepare('SELECT COUNT(*) n FROM sessions').get() as { n: number }).n, 0);
      recovered.sqlite.exec('DROP TABLE import_batch_items; DROP TABLE import_batches; DROP TABLE github_owners; ALTER TABLE repositories DROP COLUMN archived; ALTER TABLE repositories DROP COLUMN checked_at; ALTER TABLE repositories DROP COLUMN check_error; ALTER TABLE repositories DROP COLUMN cached_releases; DROP TABLE visitor_events; DROP TABLE account_settings; DROP TABLE score_submission_metrics; DROP TABLE operational_state; DROP TABLE favorites; DROP TABLE best_scores; DROP TABLE runs; DROP TABLE plays; PRAGMA user_version=2;');
    } finally { recovered.sqlite.close(); }
    const upgraded = openStore(restoredDir);
    try {
      assert.equal(upgraded.sqlite.pragma('user_version', { simple: true }), 7);
      assert.equal((upgraded.sqlite.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n, 2);
    } finally { upgraded.sqlite.close(); }
  });
  await t.test('unlisting stops writes and leaderboards but preserves careers and private history', async () => {
    const pending = await run(alicePlay, alice);
    store.sqlite.prepare('UPDATE games SET published=0 WHERE id=?').run('signal-tap');
    assert.equal((await finish(pending, 70, alice)).statusCode, 404);
    assert.equal((await req(`/api/v1/plays/${alicePlay}/heartbeat`, {}, alice)).statusCode, 404);
    assert.equal((await req('/api/v1/games/signal-tap/leaderboards')).statusCode, 404);
    assert.equal((await req('/api/v1/games/signal-tap/leaderboards/classic')).statusCode, 404);
    const career = (await req('/api/v1/players/alice/career')).json();
    assert.equal(career.games[0].published, false);
    assert.equal(career.games[0].bests[0].rank, null);
    assert.ok((await req('/api/v1/me/results', undefined, alice)).json().total > 0);
    store.sqlite.prepare('UPDATE games SET published=1 WHERE id=?').run('signal-tap');
  });
  await t.test('a new login cannot finish a run from an older session; account rate limits span sessions', async () => {
    const pending = await run(bobPlay, bob);
    const login = await req('/api/v1/login', { username: 'bob', password: 'career-player-password' });
    const newBob = { cookie: String(login.headers['set-cookie']).split(';')[0], 'x-csrf-token': login.json().csrf };
    assert.equal((await finish(pending, 50, newBob)).statusCode, 404);
    await req('/api/v1/logout', {}, bob);
    assert.equal((await finish(pending, 50, bob)).statusCode, 401);
    let limited = false;
    for (let i = 0; i < 35; i++) {
      const response = await req('/api/v1/games/signal-tap/plays', { version: '1.2.0', requestId: randomUUID() }, newBob);
      if (response.statusCode === 429) { limited = true; break; }
      assert.equal(response.statusCode, 201, response.body);
    }
    assert.ok(limited);
    const loginAgain = await req('/api/v1/login', { username: 'bob', password: 'career-player-password' });
    const newestBob = { cookie: String(loginAgain.headers['set-cookie']).split(';')[0], 'x-csrf-token': loginAgain.json().csrf };
    assert.equal((await req('/api/v1/games/signal-tap/plays', { version: '1.2.0', requestId: randomUUID() }, newestBob)).statusCode, 429);
  });
  await t.test('top 100 remains bounded while a player outside the list still sees their rank', async () => {
    store.sqlite.transaction(() => {
      for (let i = 0; i < 105; i++) {
        const userId = Number(store.sqlite.prepare("INSERT INTO users (username,password,role) VALUES (?,?,'player')").run(`rank_player_${i}`, 'test-only').lastInsertRowid);
        const playId = randomUUID();
        const runId = randomUUID();
        const now = Date.now();
        store.sqlite.prepare('INSERT INTO plays (id,user_id,session_hash,request_id,game_id,version,game_name,board_id,started_at,last_heartbeat_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(playId, userId, 'test-only', randomUUID(), 'signal-tap', '1.2.0', '光點反應', 'classic', now, now);
        store.sqlite.prepare('INSERT INTO runs (id,play_id,request_id,started_at,score,finished_at) VALUES (?,?,?,?,?,?)').run(runId, playId, randomUUID(), now, 1000 + i, now);
        store.sqlite.prepare('INSERT INTO best_scores VALUES (?,?,?,?,?,?)').run(userId, 'signal-tap', 'classic', 1000 + i, now, runId);
      }
    })();
    const board = (await req('/api/v1/games/signal-tap/leaderboards/classic', undefined, alice)).json();
    assert.equal(board.entries.length, 100);
    assert.equal(board.me.rank, 106);
    assert.equal(board.me.score, 65);
    assert.ok(!board.entries.some((r: { username: string }) => r.username === 'alice'));
  });
});
