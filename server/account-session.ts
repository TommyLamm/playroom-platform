import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Store } from './db.js';
import { passwordHash, token } from './auth.js';
import { AppError } from './errors.js';
import { AccountSessions, readAccount, type StoredAccount, type StoredSession } from './account-session-service.js';
import { hasPermission, registrationSchema, type Permission, type Session, type UserRole } from '../shared/account.js';

declare module 'fastify' {
  interface FastifyRequest {
    userSession?: StoredSession;
    userRole?: UserRole;
  }
}

export async function createSessionAccess(config: Config, store: Store) {
  const service = new AccountSessions(store, await passwordHash(token()));
  const cookieName = config.production ? '__Host-playroom' : 'playroom-session';
  const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'strict' as const, path: '/' };
  async function requireUser(request: FastifyRequest) {
    const session = service.requireSession(request.cookies[cookieName]);
    if (!['GET', 'HEAD'].includes(request.method) && request.headers['x-csrf-token'] !== session.csrf)
      throw new AppError(403, '工作階段驗證失敗，請重新整理頁面', 'CSRF_INVALID');
    request.userSession = session;
  }
  function requirePermission(permission: Permission) {
    return async (request: FastifyRequest) => {
      await requireUser(request);
      const user = readAccount(store, request.userSession!.userId);
      if (!user) throw new AppError(401, '登入已失效，請重新登入');
      request.userRole = user.role;
      if (!hasPermission(user.role, permission)) throw new AppError(403, '你的帳號沒有使用此功能的權限');
    };
  }
  function startSession(request: FastifyRequest, reply: FastifyReply, user: StoredAccount): Session {
    const { raw, csrf } = service.start(user, request.cookies[cookieName]);
    reply.setCookie(cookieName, raw, { ...cookieOptions, maxAge: 8 * 60 * 60 });
    return { authenticated: true, username: user.username, role: user.role, csrf };
  }
  return { service, cookieName, cookieOptions, requireUser, requirePermission, startSession };
}

export function registerAccountSession(platform: FastifyInstance, store: Store, access: Awaited<ReturnType<typeof createSessionAccess>>) {
  const { service, requireUser, startSession, cookieName, cookieOptions } = access;
  platform.get('/api/v1/session', async (request) => {
    try {
      await requireUser(request);
      const user = readAccount(store, request.userSession!.userId);
      if (!user) return { authenticated: false };
      return { authenticated: true, username: user.username, role: user.role, csrf: request.userSession!.csrf };
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 401) return { authenticated: false };
      throw error;
    }
  });
  platform.post('/api/v1/register', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const input = registrationSchema.safeParse(request.body);
    if (!input.success) throw new AppError(400,
      '帳號須為 3–32 個英文字母、數字或 _ . -，密碼須為 12–256 字元；註冊只接受帳號與密碼');
    const user = await service.register(input.data.username, input.data.password);
    return reply.code(201).send(startSession(request, reply, user));
  });
  platform.post('/api/v1/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const { username, password } = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(256) }).parse(request.body);
    return startSession(request, reply, await service.login(username, password));
  });
  platform.post('/api/v1/logout', { preHandler: requireUser }, async (request, reply) => {
    service.logout(request.userSession!);
    reply.clearCookie(cookieName, cookieOptions);
    return { ok: true };
  });
}
