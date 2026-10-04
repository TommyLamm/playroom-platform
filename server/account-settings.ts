import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { users, type Store } from './db.js';
import { passwordHash, verifyPassword } from './auth.js';
import { AppError } from './errors.js';
import type { Session } from '../shared/account.js';
import { careerVisibilitySchema, type AccountSettings } from '../shared/settings.js';

export function registerAccountSettings(
  platform: FastifyInstance,
  store: Store,
  requireUser: (request: FastifyRequest) => Promise<void>,
  startSession: (request: FastifyRequest, reply: FastifyReply, user: typeof users.$inferSelect) => Session,
) {
  const sql = store.sqlite;
  const emptyQuery = z.object({}).strict();
  const sensitive = {
    onRequest: requireUser,
    preHandler: platform.rateLimit({ max: 5, timeWindow: '15 minutes',
      keyGenerator: (request: FastifyRequest) => String(request.userSession!.userId) }),
  };
  function settings(request: FastifyRequest): AccountSettings {
    const session = request.userSession!;
    const row = sql.prepare('SELECT career_visibility FROM account_settings WHERE user_id=?').get(session.userId) as { career_visibility: AccountSettings['careerVisibility'] } | undefined;
    const { count } = sql.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id=? AND token_hash<>? AND expires_at>?').get(session.userId, session.tokenHash, Date.now()) as { count: number };
    return { careerVisibility: row?.career_visibility ?? 'public', otherSessions: count };
  }
  function currentUser(request: FastifyRequest) {
    const row = sql.prepare('SELECT id,username,password,role,created_at AS createdAt FROM users WHERE id=?').get(request.userSession!.userId) as typeof users.$inferSelect | undefined;
    if (!row) throw new AppError(401, '登入已失效，請重新登入');
    return row;
  }
  // Password verification uses asynchronous scrypt. Recheck both credentials and the session
  // within the mutation transaction so logout or concurrent password changes win the race.
  function recheck(request: FastifyRequest, password: string) {
    const session = request.userSession!;
    const found = sql.prepare('SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>? AND u.password=?').get(session.tokenHash, session.userId, Date.now(), password);
    if (!found) throw new AppError(401, '登入已失效，請重新登入');
  }
  platform.get('/api/v1/me/settings', { onRequest: requireUser }, async (request) => {
    emptyQuery.parse(request.query);
    return settings(request);
  });
  platform.post('/api/v1/me/settings', {
    onRequest: requireUser,
    config: { rateLimit: { hook: 'preHandler', max: 30, timeWindow: '1 minute',
      keyGenerator: (request: FastifyRequest) => String(request.userSession!.userId) } },
  }, async (request) => {
    emptyQuery.parse(request.query);
    const { careerVisibility } = z.object({ careerVisibility: careerVisibilitySchema }).strict().parse(request.body);
    sql.prepare('INSERT INTO account_settings (user_id,career_visibility) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET career_visibility=excluded.career_visibility').run(request.userSession!.userId, careerVisibility);
    return settings(request);
  });
  platform.post('/api/v1/me/password', sensitive, async (request, reply) => {
    emptyQuery.parse(request.query);
    const { currentPassword, newPassword } = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(12).max(256) }).strict().parse(request.body);
    const user = currentUser(request);
    if (!await verifyPassword(currentPassword, user.password)) throw new AppError(400, '目前密碼不正確');
    const hashed = await passwordHash(newPassword);
    const session = sql.transaction(() => {
      recheck(request, user.password);
      sql.prepare('UPDATE users SET password=? WHERE id=?').run(hashed, user.id);
      sql.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      return startSession(request, reply, { ...user, password: hashed });
    })();
    return { ok: true, session };
  });
  platform.post('/api/v1/me/sessions/revoke', sensitive, async (request) => {
    emptyQuery.parse(request.query);
    const { currentPassword } = z.object({ currentPassword: z.string().min(1).max(256) }).strict().parse(request.body);
    const user = currentUser(request);
    if (!await verifyPassword(currentPassword, user.password)) throw new AppError(400, '目前密碼不正確');
    const revoked = sql.transaction(() => {
      recheck(request, user.password);
      return sql.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(user.id, request.userSession!.tokenHash).changes;
    })();
    return { revoked };
  });
}
