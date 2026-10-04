import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../server/db.js';
import { createApplication } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { seedDemos } from '../server/maintenance.js';
import { installVersion, publish } from '../server/library.js';
import { manifestSchema } from '../shared/manifest.js';
import type { PersonalProgress, LeaderboardView } from '../shared/career.js';

test('private career progress and the next leaderboard target', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-progress-'));
  const config = getConfig({ dataDir: path.join(root, 'data'), clientDir: path.join(root, 'none'), production: false });
  const store = openStore(config.dataDir);
  const starterVersion = manifestSchema.parse(JSON.parse(await fs.readFile('examples/starter/game.json', 'utf8'))).version;
  await seedDemos(store, config);
  const app = await createApplication(config, store);
  t.after(async () => { await app.close(); store.sqlite.close(); await fs.rm(root, { recursive: true, force: true }); });
  type Headers = Record<string, string>;
  let remote = 1;
  const req = (url: string, headers: Headers = {}, body?: object) => app.platform.inject({
    method: body ? 'POST' : 'GET', url, payload: body,
    headers: { host: new URL(config.platformOrigin).host, origin: config.platformOrigin, ...headers },
    remoteAddress: `192.0.2.${remote++}`,
  });
  async function register(username: string) {
    const response = await req('/api/v1/register', {}, { username, password: 'progress-player-password' });
    assert.equal(response.statusCode, 201, response.body);
    const userId = (store.sqlite.prepare('SELECT id FROM users WHERE username=?').get(username) as { id: number }).id;
    return { userId, headers: { cookie: String(response.headers['set-cookie']).split(';')[0], 'x-csrf-token': response.json().csrf } };
  }
  const alice = await register('progress_alice');
  const bob = await register('progress_bob');
  const empty = await register('progress_empty');
  const progressUrl = (boardId = 'classic') => `/api/v1/me/progress?gameId=signal-tap&boardId=${boardId}`;
  async function progress(headers = alice.headers, boardId = 'classic'): Promise<PersonalProgress> {
    const response = await req(progressUrl(boardId), headers);
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  }
  async function leaderboard(headers: Headers = {}, boardId = 'classic'): Promise<LeaderboardView> {
    const response = await req(`/api/v1/games/signal-tap/leaderboards/${boardId}`, headers);
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  }
  let completion = Date.now() - 100000;
  // Fixtures avoid write rate limits while exercising complete histories through the real read API.
  function result(userId: number, score: number, version = starterVersion, boardId = 'classic', order: 'asc' | 'desc' = 'desc', finishedAt = ++completion, runId = randomUUID()) {
    const playId = randomUUID();
    store.sqlite.prepare('INSERT INTO plays (id,user_id,session_hash,request_id,game_id,version,game_name,board_id,started_at,last_heartbeat_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(playId, userId, 'fixture', randomUUID(), 'signal-tap', version, '光點反應', boardId, finishedAt, finishedAt);
    store.sqlite.prepare('INSERT INTO runs (id,play_id,request_id,started_at,score,finished_at) VALUES (?,?,?,?,?,?)')
      .run(runId, playId, randomUUID(), finishedAt, score, finishedAt);
    store.sqlite.prepare(`INSERT INTO best_scores (user_id,game_id,board_id,score,achieved_at,run_id) VALUES (?,?,?,?,?,?)
      ON CONFLICT(user_id,game_id,board_id) DO UPDATE SET score=excluded.score,achieved_at=excluded.achieved_at,run_id=excluded.run_id
      WHERE excluded.score ${order === 'asc' ? '<' : '>'} best_scores.score`).run(userId, 'signal-tap', boardId, score, finishedAt, runId);
    return runId;
  }
  async function install(version: string, boardId: string, order: 'asc' | 'desc') {
    const base = JSON.parse(await fs.readFile('examples/starter/game.json', 'utf8'));
    const game = manifestSchema.parse({ ...base, version, leaderboard: { id: boardId, order, unit: '分', minScore: 0, maxScore: 10000 } });
    const stage = path.join(root, `stage-${version}`);
    await fs.cp('examples/starter', stage, { recursive: true });
    await fs.writeFile(path.join(stage, 'game.json'), JSON.stringify(game));
    await installVersion(store, config, stage, game, { repositoryId: null, releaseId: null, assetId: null, releaseTag: null, sha256: 'a'.repeat(64) });
    publish(store, 'signal-tap', version);
  }

  await t.test('authentication, strict input and empty history', async () => {
    assert.equal((await req(progressUrl())).statusCode, 401);
    for (const url of ['/api/v1/me/progress', '/api/v1/me/progress?gameId=signal-tap',
      `${progressUrl()}&username=progress_bob`, `${progressUrl()}&userId=2`,
      '/api/v1/me/progress?gameId=../bad&boardId=classic', '/api/v1/me/progress?gameId=signal-tap&boardId=BAD']) {
      assert.equal((await req(url, alice.headers)).statusCode, 400, url);
    }
    assert.equal((await req(progressUrl('missing'), alice.headers)).statusCode, 404);
    assert.equal((await req('/api/v1/me/progress?gameId=missing&boardId=classic', alice.headers)).statusCode, 404);
    const history = await progress();
    assert.equal(history.totalRuns, 0);
    assert.equal(history.bestScore, null);
    assert.equal(history.breakthroughs, 0);
    assert.deepEqual(history.points, []);
    assert.equal((await leaderboard()).nextTarget, null);
    assert.equal((await leaderboard(alice.headers)).nextTarget, null);
  });
  await t.test('zero, first score, strict breakthroughs and account privacy', async () => {
    const zero = result(alice.userId, 0);
    const best = result(alice.userId, 20);
    const tie = result(alice.userId, 20);
    result(alice.userId, 10);
    result(bob.userId, 999);
    const history = await progress();
    assert.equal(history.totalRuns, 4);
    assert.equal(history.bestScore, 20);
    assert.equal(history.breakthroughs, 1);
    assert.deepEqual(history.points.map((p) => [p.score, p.personalBest, p.previousBest]),
      [[0, false, null], [20, true, 0], [20, false, 20], [10, false, 20]]);
    assert.deepEqual(history.points.slice(0, 3).map((p) => p.runId), [zero, best, tie]);
    assert.ok(history.points.every((p) => !Number.isNaN(Date.parse(p.finishedAt))));
    assert.equal((await progress(bob.headers)).totalRuns, 1);
    assert.equal((await progress(empty.headers)).totalRuns, 0);
    const publicCareer = (await req('/api/v1/players/progress_alice/career')).json();
    assert.ok(!JSON.stringify(publicCareer).includes('previousBest'));
    assert.ok(!JSON.stringify(publicCareer).includes('finishedAt'));
  });
  await t.test('compatible versions combine and new boards isolate ascending progress', async () => {
    await install('1.3.0', 'classic', 'desc');
    result(alice.userId, 30, '1.3.0');
    assert.equal((await progress()).totalRuns, 5);
    assert.equal((await progress()).breakthroughs, 2);
    await install('2.0.0', 'speed', 'asc');
    for (const score of [100, 80, 80, 90, 0]) result(alice.userId, score, '2.0.0', 'speed', 'asc');
    const history = await progress(alice.headers, 'speed');
    assert.equal(history.totalRuns, 5);
    assert.equal(history.bestScore, 0);
    assert.equal(history.breakthroughs, 2);
    assert.deepEqual(history.points.map((p) => [p.personalBest, p.previousBest]),
      [[false, null], [true, 100], [false, 80], [false, 80], [true, 80]]);
    assert.equal((await progress()).totalRuns, 5);
  });
  await t.test('latest 30 points retain the previous best and lifetime breakthroughs', async () => {
    result(empty.userId, 9999);
    for (let i = 0; i < 31; i++) result(empty.userId, i);
    const history = await progress(empty.headers);
    assert.equal(history.totalRuns, 32);
    assert.equal(history.bestScore, 9999);
    assert.equal(history.breakthroughs, 0);
    assert.equal(history.points.length, 30);
    assert.equal(history.points[0].score, 1);
    assert.ok(history.points.every((p) => p.previousBest === 9999 && !p.personalBest));
    assert.equal(history.points.at(-1)?.score, 30);
    assert.ok(history.points.every((point, i) => i === 0 || point.finishedAt >= history.points[i - 1].finishedAt));
  });
  await t.test('equal completion times use deterministic run ID order', async () => {
    const finishedAt = ++completion;
    result(bob.userId, 150, '2.0.0', 'speed', 'asc', finishedAt, '00000000-0000-4000-8000-000000000002');
    result(bob.userId, 200, '2.0.0', 'speed', 'asc', finishedAt, '00000000-0000-4000-8000-000000000001');
    const history = await progress(bob.headers, 'speed');
    assert.deepEqual(history.points.map((p) => [p.score, p.personalBest, p.previousBest]), [[200, false, null], [150, true, 200]]);
  });
  await t.test('nearest distinct target skips tied players and shows competition rank', async () => {
    result(empty.userId, 30, '2.0.0', 'speed', 'asc');
    const tieUser = Number(store.sqlite.prepare("INSERT INTO users (username,password,role) VALUES (?,?,'player')").run('target_tie', 'fixture').lastInsertRowid);
    result(tieUser, 30, '2.0.0', 'speed', 'asc');
    const targetUser = Number(store.sqlite.prepare("INSERT INTO users (username,password,role) VALUES (?,?,'player')").run('target_near', 'fixture').lastInsertRowid);
    result(targetUser, 100, '2.0.0', 'speed', 'asc');
    assert.deepEqual((await leaderboard(bob.headers, 'speed')).nextTarget, { score: 100, rank: 4, gap: 50 });
    assert.deepEqual((await leaderboard(empty.headers, 'speed')).nextTarget, { score: 0, rank: 1, gap: 30 });
    assert.equal((await leaderboard(alice.headers, 'speed')).nextTarget, null);
    assert.equal((await leaderboard({}, 'speed')).nextTarget, null);
    assert.deepEqual((await leaderboard(alice.headers)).nextTarget, { score: 999, rank: 2, gap: 969 });
  });
  await t.test('targets outside the top 100 and joint first place', async () => {
    for (let i = 0; i < 105; i++) {
      const id = Number(store.sqlite.prepare("INSERT INTO users (username,password,role) VALUES (?,?,'player')").run(`progress_rank_${i}`, 'fixture').lastInsertRowid);
      result(id, 1000 + i);
    }
    const board = await leaderboard(alice.headers);
    assert.equal(board.entries.length, 100);
    assert.equal(board.me?.rank, 108);
    assert.deepEqual(board.nextTarget, { score: 999, rank: 107, gap: 969 });
    result(alice.userId, 9999);
    assert.equal((await leaderboard(alice.headers)).me?.rank, 1);
    assert.equal((await leaderboard(alice.headers)).nextTarget, null);
  });
  await t.test('private progress remains available after unlisting; expired login denied', async () => {
    store.sqlite.prepare('UPDATE games SET published=0 WHERE id=?').run('signal-tap');
    assert.ok((await progress()).totalRuns > 0);
    assert.equal((await req('/api/v1/games/signal-tap/leaderboards/classic', alice.headers)).statusCode, 404);
    assert.ok(!JSON.stringify((await req('/api/v1/players/progress_alice/career')).json()).includes('points'));
    assert.equal((await req('/api/v1/logout', alice.headers, {})).statusCode, 200);
    assert.equal((await req(progressUrl(), alice.headers)).statusCode, 401);
  });
});
