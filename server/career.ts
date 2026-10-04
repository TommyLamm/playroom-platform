import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './db.js';
import { AppError } from './errors.js';
import { gameId, gameVersion, manifestSchema, type Leaderboard } from '../shared/manifest.js';
import { usernameSchema } from '../shared/account.js';
import type { Career, CareerGame, LeaderboardView, PersonalProgress, RankedScore, ResultsPage, RunResult } from '../shared/career.js';

type Play = {
  id: string; user_id: number; session_hash: string; game_id: string; version: string;
  board_id: string | null; last_heartbeat_at: number; heartbeat_active: number;
};
type Run = { id: string; play_id: string; score: number | null; finished_at: number | null };
const iso = (time: number) => new Date(time).toISOString();
const identifier = z.string().uuid();
const boardIdentifier = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);

export function registerCareer(platform: FastifyInstance, store: Store, requireUser: (request: FastifyRequest) => Promise<void>) {
  const sql = store.sqlite;
  const writeOptions = (max: number) => ({
    onRequest: requireUser,
    config: { rateLimit: {
      hook: 'preHandler' as const, max, timeWindow: '1 minute',
      keyGenerator: (request: FastifyRequest) => String(request.userSession!.userId),
    } },
  });
  function publicGame(id: string) {
    const game = sql.prepare('SELECT active_version FROM games WHERE id=? AND published=1').get(id) as { active_version: string } | undefined;
    if (!game) throw new AppError(404, '這款遊戲尚未上架或已下架');
    return game;
  }
  function manifest(id: string, version: string, published = false) {
    const row = sql.prepare('SELECT manifest, published_at FROM versions WHERE game_id=? AND version=?').get(id, version) as { manifest: string; published_at: string | null } | undefined;
    if (!row || (published && !row.published_at)) throw new AppError(404, '找不到已發布的遊戲版本');
    return manifestSchema.parse(JSON.parse(row.manifest));
  }
  function boards(id: string, published = true): Leaderboard[] {
    const rows = sql.prepare(`SELECT manifest FROM versions WHERE game_id=? ${published ? 'AND published_at IS NOT NULL' : ''} ORDER BY id DESC`).all(id) as { manifest: string }[];
    const found = new Map<string, Leaderboard>();
    for (const row of rows) {
      const board = manifestSchema.parse(JSON.parse(row.manifest)).leaderboard;
      if (board && !found.has(board.id)) found.set(board.id, board);
    }
    return [...found.values()];
  }
  function boardFor(id: string, boardId: string): Leaderboard {
    const board = boards(id).find((b) => b.id === boardId);
    if (!board) throw new AppError(404, '找不到此排行榜');
    return board;
  }
  function rank(id: string, board: Leaderboard, score: number): number {
    const row = sql.prepare(`SELECT COUNT(*) AS count FROM best_scores WHERE game_id=? AND board_id=? AND score ${board.order === 'asc' ? '<' : '>'} ?`).get(id, board.id, score) as { count: number };
    return row.count + 1;
  }
  function ownedPlay(request: FastifyRequest, id: string): Play {
    const play = sql.prepare('SELECT * FROM plays WHERE id=? AND user_id=? AND session_hash=?').get(id, request.userSession!.userId, request.userSession!.tokenHash) as Play | undefined;
    if (!play) throw new AppError(404, '找不到此遊玩記錄');
    publicGame(play.game_id);
    return play;
  }
  async function viewer(request: FastifyRequest): Promise<number | null> {
    try { await requireUser(request); return request.userSession!.userId; }
    catch (error) { if (error instanceof AppError && error.statusCode === 401) return null; throw error; }
  }
  platform.post('/api/v1/games/:id/plays', writeOptions(30), async (request, reply) => {
    const { id } = z.object({ id: gameId }).parse(request.params);
    const { version, requestId } = z.object({ version: gameVersion, requestId: identifier }).strict().parse(request.body);
    publicGame(id);
    const game = manifest(id, version, true);
    const session = request.userSession!;
    const previous = sql.prepare('SELECT id, game_id, version FROM plays WHERE session_hash=? AND request_id=?').get(session.tokenHash, requestId) as { id: string; game_id: string; version: string } | undefined;
    if (previous) {
      if (previous.game_id !== id || previous.version !== version) throw new AppError(409, '請求識別已被使用');
      return { playId: previous.id };
    }
    const playId = randomUUID();
    const now = Date.now();
    sql.prepare('INSERT INTO plays (id,user_id,session_hash,request_id,game_id,version,game_name,board_id,started_at,last_heartbeat_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(playId, session.userId, session.tokenHash, requestId, id, version, game.name, game.leaderboard?.id ?? null, now, now);
    return reply.code(201).send({ playId });
  });
  platform.post('/api/v1/plays/:playId/heartbeat', writeOptions(20), async (request) => {
    const { playId } = z.object({ playId: identifier }).parse(request.params);
    const { active } = z.object({ active: z.boolean().default(true) }).strict().parse(request.body);
    const play = ownedPlay(request, playId);
    const now = Date.now();
    const delta = now - play.last_heartbeat_at;
    sql.prepare('UPDATE plays SET last_heartbeat_at=?, heartbeat_active=?, active_ms=active_ms+? WHERE id=?').run(now, active ? 1 : 0, play.heartbeat_active && delta >= 0 && delta <= 30000 ? delta : 0, playId);
    return { ok: true };
  });
  platform.post('/api/v1/plays/:playId/runs', writeOptions(60), async (request, reply) => {
    const { playId } = z.object({ playId: identifier }).parse(request.params);
    const { requestId } = z.object({ requestId: identifier }).strict().parse(request.body);
    const play = ownedPlay(request, playId);
    if (!play.board_id) throw new AppError(400, '此遊戲尚未接入成績排行榜');
    const previous = sql.prepare('SELECT id FROM runs WHERE play_id=? AND request_id=?').get(playId, requestId) as { id: string } | undefined;
    if (previous) return { runId: previous.id };
    const runId = randomUUID();
    sql.prepare('INSERT INTO runs (id,play_id,request_id,started_at) VALUES (?,?,?,?)').run(runId, playId, requestId, Date.now());
    return reply.code(201).send({ runId });
  });
  platform.post('/api/v1/runs/:runId/finish', writeOptions(60), async (request) => {
    const { runId } = z.object({ runId: identifier }).parse(request.params);
    const { score } = z.object({ score: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict().parse(request.body);
    const run = sql.prepare('SELECT * FROM runs WHERE id=?').get(runId) as Run | undefined;
    if (!run) throw new AppError(404, '找不到此局次');
    const play = ownedPlay(request, run.play_id);
    const board = manifest(play.game_id, play.version, true).leaderboard!;
    if (score < board.minScore || score > board.maxScore) throw new AppError(400, '分數超出此遊戲的有效範圍');
    if (run.finished_at !== null) {
      if (run.score !== score) throw new AppError(409, '此局成績已保存，不能覆寫');
      return { saved: true, runId, score, finishedAt: iso(run.finished_at) };
    }
    const now = Date.now();
    sql.transaction(() => {
      sql.prepare('UPDATE runs SET score=?,finished_at=? WHERE id=?').run(score, now, runId);
      sql.prepare(`INSERT INTO best_scores (user_id,game_id,board_id,score,achieved_at,run_id) VALUES (?,?,?,?,?,?)
        ON CONFLICT(user_id,game_id,board_id) DO UPDATE SET score=excluded.score,achieved_at=excluded.achieved_at,run_id=excluded.run_id
        WHERE excluded.score ${board.order === 'asc' ? '<' : '>'} best_scores.score`).run(play.user_id, play.game_id, board.id, score, now, runId);
    })();
    return { saved: true, runId, score, finishedAt: iso(now) };
  });
  platform.get('/api/v1/games/:id/leaderboards', async (request) => {
    const { id } = z.object({ id: gameId }).parse(request.params);
    const game = publicGame(id);
    return { boards: boards(id), activeBoardId: manifest(id, game.active_version).leaderboard?.id ?? null };
  });
  platform.get('/api/v1/games/:id/leaderboards/:boardId', async (request): Promise<LeaderboardView> => {
    const { id, boardId } = z.object({ id: gameId, boardId: boardIdentifier }).parse(request.params);
    publicGame(id);
    const board = boardFor(id, boardId);
    const rows = sql.prepare(`SELECT u.username,b.score,b.achieved_at FROM best_scores b JOIN users u ON u.id=b.user_id WHERE b.game_id=? AND b.board_id=? ORDER BY b.score ${board.order === 'asc' ? 'ASC' : 'DESC'},b.achieved_at,b.user_id LIMIT 100`).all(id, boardId) as { username: string; score: number; achieved_at: number }[];
    const ranked = (row: typeof rows[number]): RankedScore => ({ username: row.username, score: row.score, achievedAt: iso(row.achieved_at), rank: rank(id, board, row.score) });
    const userId = await viewer(request);
    const me = userId === null ? undefined : sql.prepare('SELECT u.username,b.score,b.achieved_at FROM best_scores b JOIN users u ON u.id=b.user_id WHERE b.user_id=? AND b.game_id=? AND b.board_id=?').get(userId, id, boardId) as typeof rows[number] | undefined;
    // The next distinct score is the nearest target, even when it is outside the public top 100.
    const next = !me ? undefined : sql.prepare(`SELECT score FROM best_scores WHERE game_id=? AND board_id=? AND score ${board.order === 'asc' ? '<' : '>'} ? ORDER BY score ${board.order === 'asc' ? 'DESC' : 'ASC'} LIMIT 1`).get(id, boardId, me.score) as { score: number } | undefined;
    return { board, entries: rows.map(ranked), me: me ? ranked(me) : null,
      nextTarget: next && me ? { rank: rank(id, board, next.score), score: next.score, gap: Math.abs(next.score - me.score) } : null };
  });
  platform.get('/api/v1/players/:username/career', async (request): Promise<Career> => {
    const { username } = z.object({ username: usernameSchema }).parse(request.params);
    const user = sql.prepare('SELECT id,username FROM users WHERE username=? COLLATE NOCASE').get(username) as { id: number; username: string } | undefined;
    if (!user) throw new AppError(404, '找不到此玩家');
    const owner = await viewer(request) === user.id;
    const setting = sql.prepare('SELECT career_visibility FROM account_settings WHERE user_id=?').get(user.id) as { career_visibility: string } | undefined;
    const visibility = setting?.career_visibility ?? 'public';
    if (!owner && visibility === 'private') throw new AppError(404, '找不到此玩家');
    const activityVisible = owner || visibility === 'public';
    const rows = sql.prepare(`SELECT p.game_id,
      (SELECT q.game_name FROM plays q WHERE q.user_id=p.user_id AND q.game_id=p.game_id ORDER BY q.started_at DESC,q.id LIMIT 1) AS name,
      g.published,COUNT(*) AS opens,SUM(p.active_ms) AS active_ms,
      MAX(p.last_heartbeat_at) AS last_played_at,
      (SELECT COUNT(*) FROM runs r JOIN plays q ON q.id=r.play_id WHERE q.user_id=p.user_id AND q.game_id=p.game_id AND r.finished_at IS NOT NULL) AS completed_runs
      FROM plays p JOIN games g ON g.id=p.game_id WHERE p.user_id=? GROUP BY p.game_id ORDER BY last_played_at DESC,p.game_id`).all(user.id) as { game_id: string; name: string; published: number; opens: number; active_ms: number; last_played_at: number; completed_runs: number }[];
    const games: CareerGame[] = rows.map((row) => {
      const bests = sql.prepare('SELECT board_id,score FROM best_scores WHERE user_id=? AND game_id=? ORDER BY board_id').all(user.id, row.game_id) as { board_id: string; score: number }[];
      return { gameId: row.game_id, name: row.name, published: !!row.published, opens: activityVisible ? row.opens : null, completedRuns: activityVisible ? row.completed_runs : null, activeMs: activityVisible ? row.active_ms : null, lastPlayedAt: activityVisible ? iso(row.last_played_at) : null, bests: bests.map((best) => {
        const board = boardFor(row.game_id, best.board_id);
        return { board, score: best.score, rank: row.published ? rank(row.game_id, board, best.score) : null };
      }) };
    });
    if (!activityVisible) games.sort((a, b) => a.gameId.localeCompare(b.gameId));
    return { username: user.username, games, activityVisible, totals: {
      games: games.length, opens: activityVisible ? rows.reduce((n, g) => n + g.opens, 0) : null,
      completedRuns: activityVisible ? rows.reduce((n, g) => n + g.completed_runs, 0) : null, activeMs: activityVisible ? rows.reduce((n, g) => n + g.active_ms, 0) : null,
    } };
  });
  platform.get('/api/v1/me/results', { onRequest: requireUser }, async (request): Promise<ResultsPage> => {
    const { gameId: id, page, pageSize } = z.object({ gameId: gameId.optional(), page: z.coerce.number().int().min(1).max(1000000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).strict().parse(request.query);
    const where = `p.user_id=? AND r.finished_at IS NOT NULL ${id ? 'AND p.game_id=?' : ''}`;
    const args = id ? [request.userSession!.userId, id] : [request.userSession!.userId];
    const { total } = sql.prepare(`SELECT COUNT(*) AS total FROM runs r JOIN plays p ON p.id=r.play_id WHERE ${where}`).get(...args) as { total: number };
    const rows = sql.prepare(`SELECT r.id,p.game_id,p.game_name,p.version,p.board_id,r.score,r.finished_at FROM runs r JOIN plays p ON p.id=r.play_id WHERE ${where} ORDER BY r.finished_at DESC,r.id LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize) as { id: string; game_id: string; game_name: string; version: string; board_id: string; score: number; finished_at: number }[];
    const results: RunResult[] = rows.map((row) => ({ id: row.id, gameId: row.game_id, name: row.game_name, version: row.version, boardId: row.board_id, score: row.score, unit: boardFor(row.game_id, row.board_id).unit, finishedAt: iso(row.finished_at) }));
    return { results, total, page, pageSize };
  });
  platform.get('/api/v1/me/progress', { onRequest: requireUser }, async (request): Promise<PersonalProgress> => {
    const { gameId: id, boardId } = z.object({ gameId, boardId: boardIdentifier }).strict().parse(request.query);
    const board = boardFor(id, boardId);
    const bestAggregate = board.order === 'asc' ? 'MIN' : 'MAX';
    const comparison = board.order === 'asc' ? '<' : '>';
    // Include the whole history before limiting the chart: older results still establish the previous best.
    // Equal completion times are ordered by run ID, matching the existing results API's deterministic order.
    const rows = sql.prepare(`WITH history AS (
      SELECT r.id,r.score,r.finished_at,
        ${bestAggregate}(r.score) OVER (ORDER BY r.finished_at,r.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_best
      FROM runs r JOIN plays p ON p.id=r.play_id
      WHERE p.user_id=? AND p.game_id=? AND p.board_id=? AND r.finished_at IS NOT NULL
    ), progress AS (
      SELECT *,CASE WHEN previous_best IS NOT NULL AND score ${comparison} previous_best THEN 1 ELSE 0 END AS breakthrough FROM history
    ) SELECT *,COUNT(*) OVER () AS total_runs,${bestAggregate}(score) OVER () AS best_score,
      SUM(breakthrough) OVER () AS breakthroughs FROM progress ORDER BY finished_at DESC,id DESC LIMIT 30`)
      .all(request.userSession!.userId, id, boardId) as {
        id: string; score: number; finished_at: number; previous_best: number | null;
        breakthrough: number; total_runs: number; best_score: number; breakthroughs: number;
      }[];
    return { gameId: id, board, totalRuns: rows[0]?.total_runs ?? 0, bestScore: rows[0]?.best_score ?? null,
      breakthroughs: rows[0]?.breakthroughs ?? 0,
      points: rows.reverse().map((row) => ({ runId: row.id, score: row.score, finishedAt: iso(row.finished_at),
        personalBest: !!row.breakthrough, previousBest: row.previous_best })) };
  });
}
