import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './db.js';
import type { Config } from './config.js';
import type { OperationalAnalytics } from '../shared/analytics.js';
import { readBackupState } from './operational-state.js';
import { hasPermission } from '../shared/account.js';

async function directoryBytes(root: string): Promise<number | null> {
  try {
    if (!(await fs.lstat(root)).isDirectory()) return null;
    let bytes = 0;
    for (const item of await fs.readdir(root, { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue;
      const filename = path.join(root, item.name);
      if (item.isDirectory()) {
        const child = await directoryBytes(filename);
        if (child === null) return null;
        bytes += child;
      } else if (item.isFile()) {
        const stat = await fs.lstat(filename);
        if (stat.isFile()) bytes += stat.size;
      }
    }
    return bytes;
  } catch { return null; }
}

export function registerAnalytics(platform: FastifyInstance, store: Store, config: Config, requireAdmin: (request: FastifyRequest) => Promise<void>) {
  const sql = store.sqlite;
  // Only count attempts from the owner of a real run in the authenticated session.
  // This includes successful duplicate submissions and retries, rather than unique runs.
  platform.addHook('onResponse', async (request, reply) => {
    if (request.method !== 'POST' || request.routeOptions.url !== '/api/v1/runs/:runId/finish' || !request.userSession) return;
    try {
      const { runId } = request.params as { runId?: string };
      if (!runId) return;
      const session = request.userSession;
      const play = sql.prepare(`SELECT p.game_id FROM runs r JOIN plays p ON p.id=r.play_id
        JOIN sessions s ON s.token_hash=p.session_hash
        WHERE r.id=? AND p.user_id=? AND p.session_hash=? AND s.user_id=? AND s.expires_at>?`)
        .get(runId, session.userId, session.tokenHash, session.userId, Date.now()) as { game_id: string } | undefined;
      if (!play) return;
      const outcome = reply.statusCode >= 500 ? 'server_error' : reply.statusCode >= 400 ? 'rejected' : reply.statusCode >= 200 && reply.statusCode < 300 ? 'success' : null;
      if (!outcome) return;
      sql.prepare(`INSERT INTO score_submission_metrics(day,game_id,outcome,count) VALUES (?,?,?,1)
        ON CONFLICT(day,game_id,outcome) DO UPDATE SET count=count+1`)
        .run(new Date().toISOString().slice(0, 10), play.game_id, outcome);
    } catch (error) { platform.log.warn({ err: error }, 'Could not record score submission metric'); }
  });

  let storageCache: { expires: number; value: Promise<OperationalAnalytics['storage']> } | undefined;
  function storage() {
    if (storageCache && storageCache.expires > Date.now()) return storageCache.value;
    const value = (async () => {
      const [volume, dataBytes, gameBytes] = await Promise.all([
        fs.statfs(config.dataDir).catch(() => null), directoryBytes(config.dataDir), directoryBytes(path.join(config.dataDir, 'games')),
      ]);
      return { totalBytes: volume ? volume.blocks * volume.bsize : null,
        availableBytes: volume ? volume.bavail * volume.bsize : null, dataBytes, gameBytes, measuredAt: new Date().toISOString() };
    })();
    storageCache = { expires: Date.now() + 30000, value };
    return value;
  }
  platform.get('/api/v1/admin/analytics', { preHandler: requireAdmin }, async (request): Promise<OperationalAnalytics> => {
    const { days } = z.object({ days: z.enum(['7', '30']).default('7') }).strict().parse(request.query);
    const generatedAt = new Date();
    const end = generatedAt.getTime();
    const start = Date.UTC(generatedAt.getUTCFullYear(), generatedAt.getUTCMonth(), generatedAt.getUTCDate() - (Number(days) - 1));
    const active = `(p.started_at BETWEEN ? AND ? OR p.last_heartbeat_at BETWEEN ? AND ? OR EXISTS
      (SELECT 1 FROM runs r WHERE r.play_id=p.id AND r.finished_at BETWEEN ? AND ?))`;
    const activePlayers = (sql.prepare(`SELECT COUNT(DISTINCT p.user_id) AS n FROM plays p WHERE ${active}`).get(start, end, start, end, start, end) as { n: number }).n;
    const opens = (sql.prepare('SELECT COUNT(*) AS n FROM plays WHERE started_at BETWEEN ? AND ?').get(start, end) as { n: number }).n;
    const completedRuns = (sql.prepare('SELECT COUNT(*) AS n FROM runs WHERE finished_at BETWEEN ? AND ?').get(start, end) as { n: number }).n;
    const games = sql.prepare(`SELECT g.id AS gameId,g.published,
      COALESCE((SELECT json_extract(v.manifest,'$.name') FROM versions v WHERE v.game_id=g.id AND v.version=g.active_version),
        (SELECT p.game_name FROM plays p WHERE p.game_id=g.id ORDER BY p.started_at DESC,p.id LIMIT 1),g.id) AS name,
      (SELECT COUNT(*) FROM plays p WHERE p.game_id=g.id AND p.started_at BETWEEN ? AND ?) AS opens,
      (SELECT COUNT(*) FROM runs r JOIN plays p ON p.id=r.play_id WHERE p.game_id=g.id AND r.finished_at BETWEEN ? AND ?) AS completedRuns,
      (SELECT COUNT(DISTINCT p.user_id) FROM plays p WHERE p.game_id=g.id AND ${active}) AS activePlayers
      FROM games g WHERE EXISTS (SELECT 1 FROM plays p WHERE p.game_id=g.id AND ${active})
      ORDER BY opens DESC,completedRuns DESC,g.id LIMIT 10`)
      .all(start, end, start, end, start, end, start, end, start, end, start, end, start, end, start, end) as { gameId: string; name: string; published: number; opens: number; completedRuns: number; activePlayers: number }[];
    const firstDay = new Date(start).toISOString().slice(0, 10);
    const lastDay = generatedAt.toISOString().slice(0, 10);
    const rows = sql.prepare('SELECT day,outcome,SUM(count) AS count FROM score_submission_metrics WHERE day>=? AND day<=? GROUP BY day,outcome').all(firstDay, lastDay) as { day: string; outcome: string; count: number }[];
    const daily: OperationalAnalytics['submissions']['daily'] = [];
    for (let i = 0; i < Number(days); i++) {
      const day = new Date(start + i * 86400000).toISOString().slice(0, 10);
      const counts = rows.filter((r) => r.day === day);
      daily.push({ day, success: counts.find((r) => r.outcome === 'success')?.count ?? 0,
        rejected: counts.find((r) => r.outcome === 'rejected')?.count ?? 0, serverError: counts.find((r) => r.outcome === 'server_error')?.count ?? 0 });
    }
    const success = daily.reduce((n, d) => n + d.success, 0);
    const rejected = daily.reduce((n, d) => n + d.rejected, 0);
    const serverError = daily.reduce((n, d) => n + d.serverError, 0);
    const attempts = success + rejected + serverError;
    return { window: { days: Number(days) as 7 | 30, start: new Date(start).toISOString(), end: generatedAt.toISOString(), generatedAt: generatedAt.toISOString(), timezone: 'UTC' },
      totals: { activePlayers, opens, completedRuns }, games: games.map((g) => ({ ...g, published: !!g.published })),
      submissions: { success, rejected, serverError, attempts, failureRate: attempts ? (rejected + serverError) / attempts : null, daily },
      ...(request.userRole && hasPermission(request.userRole, 'platform.manage') ? { storage: await storage(), backup: readBackupState(sql) } : {}) };
  });
}
