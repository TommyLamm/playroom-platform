import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import mime from 'mime-types';
import {
  users,
  sessions,
  repositories,
  games,
  versions,
  previews,
  jobs,
  type Store,
} from './db.js';
import { hashToken, passwordHash, token, verifyPassword } from './auth.js';
import { githubSource, normalizeRepository, type GitHubSource } from './github.js';
import { adminLibrary, ImportQueue } from './library.js';
import { gameId, gameVersion, isSafePath } from '../shared/manifest.js';
import type { PublicGame } from '../shared/types.js';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { registrationSchema, type Session as PublicSession } from '../shared/account.js';
import { registerCareer } from './career.js';
import { registerPlayerLibrary } from './player-library.js';
import { registerAccountSettings } from './account-settings.js';
import { registerAnalytics } from './analytics.js';
import { registerVisitors } from './visitors.js';
import { registerSources } from './sources.js';
import { SourceChecks } from './source-checks.js';
import { publishReviewed, registerGameUpdates } from './game-updates.js';
import { hasPermission, type Permission, type UserRole } from '../shared/account.js';
import { registerAccountManagement } from './account-management.js';

type Session = typeof sessions.$inferSelect;
declare module 'fastify' {
  interface FastifyRequest {
    userSession?: Session;
    userRole?: UserRole;
  }
}

export async function createApplication(
  config: Config,
  store: Store,
  options: { github?: GitHubSource; logger?: boolean } = {},
) {
  const platform = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 32 * 1024,
    trustProxy: ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
  });
  const assets = Fastify({ logger: false });
  const github = options.github || githubSource(config.githubToken);
  const queue = new ImportQueue(store, config, github);
  const checks = new SourceChecks(store, github);
  platform.addHook('onClose', async () => { await checks.close(); });
  const cookieName = config.production ? '__Host-playroom' : 'playroom-session';
  const dummyPassword = await passwordHash(token());
  const platformHost = new URL(config.platformOrigin).host;
  const assetsHost = new URL(config.gamesOrigin).host;

  for (const server of [platform, assets]) {
    server.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: '輸入資料格式不正確' });
      if (error instanceof AppError)
        return reply.code(error.statusCode).send({ error: error.message });
      const status = (error as { statusCode?: number }).statusCode;
      if (status && status >= 400 && status < 500)
        return reply
          .code(status)
          .send({ error: status === 429 ? '操作太頻繁，請稍後再試' : '請求無法處理' });
      server.log.error(error);
      return reply.code(500).send({ error: '伺服器暫時無法完成操作' });
    });
    server.addHook('onSend', async (_request, reply, payload) => {
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Referrer-Policy', 'no-referrer');
      return payload;
    });
  }
  await platform.register(cookie);
  await platform.register(rateLimit, { global: false });
  platform.addHook('onRequest', async (request, reply) => {
    if (request.headers.host !== platformHost && request.url !== '/api/v1/health')
      throw new AppError(421, '不接受此主機名稱');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    reply.header(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' ${config.gamesOrigin} data:; connect-src 'self' ${config.gamesOrigin}; frame-src ${config.gamesOrigin}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
    );
    reply.header('X-Frame-Options', 'DENY');
    if (config.production) reply.header('Strict-Transport-Security', 'max-age=31536000');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers.origin !== config.platformOrigin
    )
      throw new AppError(403, '請求來源驗證失敗');
  });

  async function requireUser(request: FastifyRequest) {
    const raw = request.cookies[cookieName];
    if (!raw) throw new AppError(401, '請先登入');
    const session = store.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, hashToken(raw)))
      .get();
    if (!session || session.expiresAt <= Date.now())
      throw new AppError(401, '登入已過期，請重新登入');
    if (
      !['GET', 'HEAD'].includes(request.method) &&
      request.headers['x-csrf-token'] !== session.csrf
    )
      throw new AppError(403, '工作階段驗證失敗，請重新整理頁面');
    request.userSession = session;
  }
  function requirePermission(permission: Permission) {
    return async (request: FastifyRequest) => {
      await requireUser(request);
      const user = store.db
        .select()
        .from(users)
        .where(eq(users.id, request.userSession!.userId))
        .get();
      if (!user) throw new AppError(401, '登入已失效，請重新登入');
      request.userRole = user.role;
      if (!hasPermission(user.role, permission)) throw new AppError(403, '你的帳號沒有使用此功能的權限');
    };
  }
  const requireGames = requirePermission('games.manage');
  const requireAnalytics = requirePermission('analytics.read');
  const requirePlatform = requirePermission('platform.manage');
  registerCareer(platform, store, requireUser);
  registerPlayerLibrary(platform, store, requireUser);
  registerAnalytics(platform, store, config, requireAnalytics);
  registerVisitors(platform, store, config, requireAnalytics, requirePermission('visitors.read'));
  registerSources(platform, store, github, queue, requireGames, checks);
  registerGameUpdates(platform, store, requireGames);
  registerAccountManagement(platform, store, requirePermission('accounts.manage'));
  function startSession(
    request: FastifyRequest,
    reply: import('fastify').FastifyReply,
    user: typeof users.$inferSelect,
  ): PublicSession {
    const raw = token();
    const csrf = token();
    store.db.transaction((tx) => {
      tx.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
      const old = request.cookies[cookieName];
      if (old)
        tx.delete(sessions)
          .where(eq(sessions.tokenHash, hashToken(old)))
          .run();
      tx.insert(sessions)
        .values({
          tokenHash: hashToken(raw),
          userId: user.id,
          csrf,
          expiresAt: Date.now() + 8 * 60 * 60 * 1000,
        })
        .run();
    });
    reply.setCookie(cookieName, raw, {
      httpOnly: true,
      secure: config.production,
      sameSite: 'strict',
      path: '/',
      maxAge: 8 * 60 * 60,
    });
    return { authenticated: true, username: user.username, role: user.role, csrf };
  }
  registerAccountSettings(platform, store, requireUser, startSession);
  const gameParams = z.object({ id: gameId });
  const repoParams = z.object({ id: z.coerce.number().int().positive() });

  platform.get('/api/v1/health', async () => {
    store.sqlite.prepare('SELECT 1').get();
    return { status: 'ok', commit: config.commit };
  });
  async function updater(action: string, body?: unknown) {
    if (!config.updaterUrl || !config.updaterToken) {
      if (action === 'status') return { enabled: false, current: config.commit };
      throw new AppError(503, '尚未設定平台更新服務');
    }
    try {
      const response = await fetch(`${config.updaterUrl}/${action}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${config.updaterToken}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      const value = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new AppError(response.status, value.error || '平台更新服務無法完成操作');
      return value;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(503, '更新服務暫時無法連線，請稍後重試');
    }
  }
  platform.get('/api/v1/admin/updates', { preHandler: requirePlatform }, () => updater('status'));
  platform.post('/api/v1/admin/updates/check', { preHandler: requirePlatform }, () =>
    updater('check', {}),
  );
  platform.post('/api/v1/admin/updates', { preHandler: requirePlatform }, async (request, reply) => {
    const input = z
      .object({ commit: z.string().regex(/^[a-f0-9]{40}$/) })
      .strict()
      .parse(request.body);
    return reply.code(202).send(await updater('update', input));
  });
  platform.get('/api/v1/session', async (request) => {
    try {
      await requireUser(request);
      const user = store.db
        .select({ username: users.username, role: users.role })
        .from(users)
        .where(eq(users.id, request.userSession!.userId))
        .get();
      if (!user) return { authenticated: false };
      return {
        authenticated: true,
        username: user.username,
        role: user.role,
        csrf: request.userSession!.csrf,
      };
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 401) return { authenticated: false };
      throw error;
    }
  });
  platform.post(
    '/api/v1/register',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const input = registrationSchema.safeParse(request.body);
      if (!input.success)
        throw new AppError(
          400,
          '帳號須為 3–32 個英文字母、數字或 _ . -，密碼須為 12–256 字元；註冊只接受帳號與密碼',
        );
      const { username, password } = input.data;
      if (store.db.select({ id: users.id }).from(users).where(eq(users.username, username)).get())
        throw new AppError(409, '這個帳號已被使用');
      const hashed = await passwordHash(password);
      // ON CONFLICT also handles simultaneous registration of the same username.
      const user = store.db
        .insert(users)
        .values({ username, password: hashed, role: 'player', createdAt: new Date().toISOString() })
        .onConflictDoNothing()
        .returning()
        .get();
      if (!user) throw new AppError(409, '這個帳號已被使用');
      return reply.code(201).send(startSession(request, reply, user));
    },
  );
  platform.post(
    '/api/v1/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const { username, password } = z
        .object({ username: z.string().min(1).max(100), password: z.string().min(1).max(256) })
        .parse(request.body);
      const user = store.db.select().from(users).where(eq(users.username, username.trim())).get();
      const valid = await verifyPassword(password, user?.password || dummyPassword);
      if (!user || !valid) throw new AppError(401, '帳號或密碼不正確');
      const current = store.db.select().from(users).where(eq(users.id, user.id)).get();
      if (!current || current.password !== user.password) throw new AppError(401, '帳號或密碼不正確');
      return startSession(request, reply, current);
    },
  );
  platform.post('/api/v1/logout', { preHandler: requireUser }, async (request, reply) => {
    store.db.delete(sessions).where(eq(sessions.tokenHash, request.userSession!.tokenHash)).run();
    reply.clearCookie(cookieName, {
      path: '/',
      secure: config.production,
      sameSite: 'strict',
      httpOnly: true,
    });
    return { ok: true };
  });

  function publicLibrary(): PublicGame[] {
    return store.db
      .select({ game: games, version: versions })
      .from(games)
      .innerJoin(
        versions,
        and(eq(games.id, versions.gameId), eq(games.activeVersion, versions.version)),
      )
      .where(eq(games.published, true))
      .orderBy(desc(versions.publishedAt))
      .all()
      .map(({ game, version }) => ({
        ...version.manifest,
        coverUrl: `${config.gamesOrigin}/games/${game.id}/${version.version}/${version.manifest.cover}`,
        playUrl: `${config.gamesOrigin}/games/${game.id}/${version.version}/${version.manifest.entry}`,
        publishedAt: version.publishedAt!,
      }));
  }
  platform.get('/api/v1/games', async () => ({ games: publicLibrary() }));
  platform.get('/api/v1/games/:id', async (request) => {
    const { id } = gameParams.parse(request.params);
    const game = publicLibrary().find((g) => g.id === id);
    if (!game) throw new AppError(404, '這款遊戲尚未上架或已下架');
    return { game };
  });

  platform.get('/api/v1/admin/overview', { preHandler: requireGames }, async () => ({
    games: adminLibrary(store),
    repositories: store.db.select().from(repositories).all(),
    jobs: store.db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(50).all(),
  }));
  platform.post(
    '/api/v1/admin/repositories',
    { preHandler: requireGames },
    async (request, reply) => {
      const input = z.object({ fullName: z.string().max(240) }).parse(request.body);
      const fullName = await github.checkRepository(normalizeRepository(input.fullName));
      const found = store.db
        .select()
        .from(repositories)
        .where(eq(repositories.fullName, fullName))
        .get();
      if (found) return { repository: found };
      const repository = store.db
        .insert(repositories)
        .values({ fullName, createdAt: new Date().toISOString() })
        .returning()
        .get();
      return reply.code(201).send({ repository });
    },
  );
  platform.get(
    '/api/v1/admin/repositories/:id/releases',
    { preHandler: requireGames },
    async (request) => {
      const { id } = repoParams.parse(request.params);
      const repo = store.db.select().from(repositories).where(eq(repositories.id, id)).get();
      if (!repo) throw new AppError(404, '找不到 repository');
      await checks.check(id);
      const checked = store.db.select().from(repositories).where(eq(repositories.id, id)).get()!;
      if (checked.checkError) throw new AppError(502, checked.checkError);
      return { releases: checked.cachedReleases };
    },
  );
  platform.post('/api/v1/admin/imports', { preHandler: requireGames }, async (request, reply) => {
    const input = z
      .object({ repositoryId: z.number().int().positive(), releaseId: z.number().int().positive() })
      .parse(request.body);
    return reply.code(202).send({ jobId: queue.enqueue(input.repositoryId, input.releaseId) });
  });
  platform.post(
    '/api/v1/admin/games/:id/publish',
    { preHandler: requireGames },
    async (request) => {
      const { id } = gameParams.parse(request.params);
      const { version } = z.object({ version: gameVersion }).parse(request.body);
      publishReviewed(store, id, version);
      return { ok: true };
    },
  );
  platform.post(
    '/api/v1/admin/games/:id/unpublish',
    { preHandler: requireGames },
    async (request) => {
      const { id } = gameParams.parse(request.params);
      const game = store.db.select().from(games).where(eq(games.id, id)).get();
      if (!game) throw new AppError(404, '找不到遊戲');
      store.db.update(games).set({ published: false }).where(eq(games.id, id)).run();
      return { ok: true };
    },
  );
  platform.post(
    '/api/v1/admin/games/:id/preview',
    { preHandler: requireGames },
    async (request) => {
      const { id } = gameParams.parse(request.params);
      const { version } = z.object({ version: gameVersion }).parse(request.body);
      const record = store.db
        .select()
        .from(versions)
        .where(and(eq(versions.gameId, id), eq(versions.version, version)))
        .get();
      if (!record) throw new AppError(404, '找不到遊戲版本');
      store.db.delete(previews).where(lt(previews.expiresAt, Date.now())).run();
      const raw = token();
      const expiresAt = Date.now() + 15 * 60 * 1000;
      store.db
        .insert(previews)
        .values({ tokenHash: hashToken(raw), gameId: id, version, expiresAt })
        .run();
      return {
        url: `${config.gamesOrigin}/preview/${raw}/${id}/${version}/${record.manifest.entry}`,
        expiresAt,
      };
    },
  );

  if (fs.existsSync(config.clientDir)) {
    await platform.register(staticFiles, {
      root: config.clientDir,
      prefix: '/',
      index: false,
      cacheControl: false,
    });
    platform.get('/', async (_request, reply) =>
      reply.header('Cache-Control', 'no-cache').sendFile('index.html'),
    );
    platform.setNotFoundHandler(async (request, reply) => {
      if (
        request.url.startsWith('/api/') ||
        !['GET', 'HEAD'].includes(request.method) ||
        path.extname(request.url.split('?')[0])
      )
        return reply.code(404).send({ error: '找不到頁面' });
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  }

  assets.addHook('onRequest', async (request, reply) => {
    if (request.headers.host !== assetsHost) throw new AppError(421, '不接受此主機名稱');
    reply.header(
      'Content-Security-Policy',
      `frame-ancestors ${config.platformOrigin}; object-src 'none'; base-uri 'self'; form-action 'none'`,
    );
    reply.header('Cache-Control', 'no-store');
    reply.header('Access-Control-Allow-Origin', config.platformOrigin);
  });
  const assetParams = z.object({
    id: gameId,
    version: gameVersion,
    '*': z.string(),
    token: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .optional(),
  });
  async function serveAsset(request: FastifyRequest, reply: import('fastify').FastifyReply) {
    const { id, version, '*': filename, token: preview } = assetParams.parse(request.params);
    if (!isSafePath(filename)) throw new AppError(404, '找不到檔案');
    if (preview) {
      const grant = store.db
        .select()
        .from(previews)
        .where(eq(previews.tokenHash, hashToken(preview)))
        .get();
      if (
        !grant ||
        grant.gameId !== id ||
        grant.version !== version ||
        grant.expiresAt <= Date.now()
      )
        throw new AppError(403, '預覽連結已失效，請回到後台重新預覽');
    } else {
      const game = store.db.select().from(games).where(eq(games.id, id)).get();
      const stored = store.db
        .select()
        .from(versions)
        .where(and(eq(versions.gameId, id), eq(versions.version, version)))
        .get();
      if (!game?.published || !stored?.publishedAt) throw new AppError(404, '遊戲尚未發布或已下架');
    }
    const target = path.join(config.dataDir, 'games', id, version, ...filename.split('/'));
    const stat = await fsp.stat(target).catch(() => null);
    if (!stat?.isFile()) throw new AppError(404, '找不到檔案');
    reply.type(mime.lookup(filename) || 'application/octet-stream');
    reply.header('Content-Length', stat.size);
    return reply.send(fs.createReadStream(target));
  }
  assets.get('/games/:id/:version/*', serveAsset);
  assets.get('/preview/:token/:id/:version/*', serveAsset);
  assets.setNotFoundHandler(async (_req, reply) =>
    reply.code(404).send({ error: '找不到遊戲資源' }),
  );
  checks.start(config.releaseCheckIntervalSeconds);
  return {
    platform,
    assets,
    queue,
    checks,
    async close() {
      // Release checks can be paused on quota while an HTTP handler awaits them.
      // Resolve queued checks before Fastify waits for those handlers to finish.
      await checks.close();
      await platform.close();
      await assets.close();
      await queue.close();
    },
  };
}
