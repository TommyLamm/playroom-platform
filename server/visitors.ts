import { isIP } from 'node:net';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import geoip from 'geoip-country';
import { z } from 'zod';
import type { Store } from './db.js';
import type { Config } from './config.js';
import { hashToken, token } from './auth.js';
import { AppError } from './errors.js';
import { gameId, gameVersion } from '../shared/manifest.js';
import type { VisitorAnalytics, VisitorRecords } from '../shared/visitors.js';

const retentionMs = 90 * 86400000;
const daysSchema = z.enum(['7', '30']).default('7');
const eventSchema = z.object({
  requestId: z.uuid(), kind: z.enum(['page_view', 'game_open']),
  // Queries and fragments can contain credentials; only keep known platform paths.
  path: z.string().max(200).regex(/^(?:\/|\/(?:login|register|settings\/account)|\/(?:games|play)\/[a-z0-9][a-z0-9-]*|\/players\/[A-Za-z0-9_.-]{3,32})$/),
  gameId: gameId.optional(), version: gameVersion.optional(),
  referrer: z.string().max(2048).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.kind === 'game_open' ? !value.gameId || !value.version || value.path !== `/play/${value.gameId}` : value.gameId !== undefined || value.version !== undefined)
    ctx.addIssue({ code: 'custom', message: 'Invalid game event' });
});

function windowFor(days: string) {
  const end = Date.now();
  const now = new Date(end);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (Number(days) - 1));
  return { start, end, window: { days: Number(days) as 7 | 30, start: new Date(start).toISOString(), end: now.toISOString(), timezone: 'UTC' as const } };
}

export function registerVisitors(platform: FastifyInstance, store: Store, config: Config, requireAdmin: (request: FastifyRequest) => Promise<void>) {
  const sql = store.sqlite;
  const cookieName = config.production ? '__Host-playroom-visitor' : 'playroom-visitor';
  const sessionCookie = config.production ? '__Host-playroom' : 'playroom-session';
  let lastCleanup = 0;
  function cleanup() {
    const now = Date.now();
    if (now - lastCleanup < 3600000) return;
    sql.prepare('DELETE FROM visitor_events WHERE occurred_at < ?').run(now - retentionMs);
    lastCleanup = now;
  }
  // Cleanup runs on startup and hourly even if nobody visits the site.
  cleanup();
  const cleanupTimer = setInterval(() => {
    try { cleanup(); } catch (error) { platform.log.warn({ err: error }, 'Could not expire visitor records'); }
  }, 3600000);
  cleanupTimer.unref();
  platform.addHook('onClose', async () => { clearInterval(cleanupTimer); });

  platform.post('/api/v1/visits', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = eventSchema.parse(request.body);
    const now = Date.now();
    let game: { name: string } | undefined;
    if (input.kind === 'game_open') {
      game = sql.prepare(`SELECT json_extract(v.manifest,'$.name') AS name FROM games g
        JOIN versions v ON v.game_id=g.id WHERE g.id=? AND g.published=1 AND v.version=? AND v.published_at IS NOT NULL`)
        .get(input.gameId!, input.version!) as typeof game;
      if (!game) throw new AppError(404, '遊戲尚未發布或已下架');
    }
    const rawSession = request.cookies[sessionCookie];
    const user = rawSession ? sql.prepare(`SELECT u.id,u.role FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>?`).get(hashToken(rawSession), now) as { id: number; role: string } | undefined : undefined;
    // Administrative activity (including previews) is excluded from audience data.
    if (user?.role === 'admin') return reply.code(204).send();
    const ip = request.ip.replace(/^::ffff:/i, '');
    if (!isIP(ip)) throw new AppError(400, '無法辨識訪客地址');
    let country: string | null = null;
    try {
      const code = geoip.lookup(ip)?.country;
      if (code && /^[A-Z]{2}$/.test(code)) country = code;
    } catch { /* GeoIP failures must not prevent recording a visit. */ }
    let referrerHost: string | null = null;
    if (input.referrer) {
      try {
        const url = new URL(input.referrer);
        if (['https:', 'http:'].includes(url.protocol) && url.origin !== config.platformOrigin) referrerHost = url.hostname.slice(0, 253);
      } catch { /* Missing or invalid referrers are normal. */ }
    }
    let raw = request.cookies[cookieName];
    if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw) || !sql.prepare('SELECT 1 FROM visitor_events WHERE visitor_id=? LIMIT 1').get(hashToken(raw))) raw = token();
    const visitor = hashToken(raw);
    sql.prepare(`INSERT INTO visitor_events(visitor_id,request_id,occurred_at,kind,path,ip,country,user_id,game_id,game_name,game_version,referrer_host,user_agent)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(visitor_id,request_id) DO NOTHING`)
      .run(visitor, input.requestId, now, input.kind, input.path, ip, country, user?.id ?? null,
        input.gameId ?? null, game?.name ?? null, input.version ?? null, referrerHost, (request.headers['user-agent'] ?? '').slice(0, 512));
    reply.setCookie(cookieName, raw, { httpOnly: true, secure: config.production, sameSite: 'strict', path: '/', maxAge: 30 * 86400 });
    return reply.code(204).send();
  });

  platform.get('/api/v1/admin/visitors', { preHandler: requireAdmin }, async (request): Promise<VisitorAnalytics> => {
    const { days } = z.object({ days: daysSchema }).strict().parse(request.query);
    const { start, end, window } = windowFor(days);
    const totals = sql.prepare(`SELECT COUNT(DISTINCT visitor_id) AS visitors,
      COALESCE(SUM(kind='page_view'),0) AS pageViews,COALESCE(SUM(kind='game_open'),0) AS gameOpens
      FROM visitor_events WHERE occurred_at BETWEEN ? AND ?`).get(start, end) as VisitorAnalytics['totals'];
    const rows = sql.prepare(`SELECT strftime('%Y-%m-%d',occurred_at/1000,'unixepoch') AS day,
      COUNT(DISTINCT visitor_id) AS visitors,SUM(kind='page_view') AS pageViews,SUM(kind='game_open') AS gameOpens
      FROM visitor_events WHERE occurred_at BETWEEN ? AND ? GROUP BY day`).all(start, end) as VisitorAnalytics['daily'];
    const daily = Array.from({ length: Number(days) }, (_, i) => {
      const day = new Date(start + i * 86400000).toISOString().slice(0, 10);
      return rows.find((row) => row.day === day) ?? { day, visitors: 0, pageViews: 0, gameOpens: 0 };
    });
    const countries = sql.prepare(`SELECT country,COUNT(DISTINCT visitor_id) AS visitors,COUNT(*) AS events
      FROM visitor_events WHERE occurred_at BETWEEN ? AND ? GROUP BY country ORDER BY visitors DESC,country`).all(start, end) as VisitorAnalytics['countries'];
    const games = sql.prepare(`SELECT game_id AS gameId,
      (SELECT e.game_name FROM visitor_events e WHERE e.game_id=visitor_events.game_id ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1) AS name,
      COUNT(*) AS opens,COUNT(DISTINCT visitor_id) AS visitors FROM visitor_events
      WHERE kind='game_open' AND occurred_at BETWEEN ? AND ? GROUP BY game_id ORDER BY opens DESC,game_id LIMIT 10`).all(start, end) as VisitorAnalytics['games'];
    return { window, totals, daily, countries, games };
  });

  platform.get('/api/v1/admin/visitors/records', { preHandler: requireAdmin }, async (request): Promise<VisitorRecords> => {
    const query = z.object({ days: daysSchema, page: z.coerce.number().int().min(1).max(100000).default(1),
      country: z.string().regex(/^(?:[A-Z]{2}|unknown)$/).optional(), ip: z.string().max(45).refine((ip) => !!isIP(ip)).optional(),
      gameId: gameId.optional(), kind: z.enum(['page_view', 'game_open']).optional(),
      visitor: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    }).strict().parse(request.query);
    const { start, end } = windowFor(query.days);
    const clauses = ['e.occurred_at BETWEEN ? AND ?'];
    const values: (number | string)[] = [start, end];
    if (query.country === 'unknown') clauses.push('e.country IS NULL');
    else if (query.country) { clauses.push('e.country=?'); values.push(query.country); }
    for (const [column, value] of [['ip', query.ip], ['game_id', query.gameId], ['kind', query.kind], ['visitor_id', query.visitor]] as const) {
      if (value) { clauses.push(`e.${column}=?`); values.push(value); }
    }
    const where = clauses.join(' AND ');
    const pageSize = 25;
    const total = (sql.prepare(`SELECT COUNT(*) AS n FROM visitor_events e WHERE ${where}`).get(...values) as { n: number }).n;
    const records = sql.prepare(`SELECT e.id,e.visitor_id AS visitor,e.occurred_at AS occurredAt,e.kind,e.path,e.ip,e.country,u.username,
      e.game_id AS gameId,e.game_name AS gameName,e.game_version AS gameVersion,e.referrer_host AS referrerHost,e.user_agent AS userAgent
      FROM visitor_events e LEFT JOIN users u ON u.id=e.user_id WHERE ${where}
      ORDER BY e.occurred_at DESC,e.id DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (query.page - 1) * pageSize) as (Omit<VisitorRecords['records'][number], 'occurredAt'> & { occurredAt: number })[];
    return { page: query.page, pageSize, total, records: records.map((row) => ({ ...row, occurredAt: new Date(row.occurredAt).toISOString() })) };
  });
}
