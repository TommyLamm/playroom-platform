import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { z } from 'zod';
import type { Store } from './db.js';
import { githubSource, type GitHubSource } from './github.js';
import { recoverInstallations } from './installation-service.js';
import { ImportQueue } from './import-queue.js';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { defaultErrorCode } from '../shared/errors.js';
import { createSessionAccess, registerAccountSession } from './account-session.js';
import { registerGameCatalog } from './game-catalog-routes.js';
import { registerGameAssets } from './game-assets.js';
import { registerPlatformUpdates } from './platform-updates.js';
import { registerCareer } from './career.js';
import { registerCloudSave } from './cloud-save.js';
import { registerPlayerLibrary } from './player-library.js';
import { registerAccountSettings } from './account-settings.js';
import { registerAnalytics } from './analytics.js';
import { registerVisitors } from './visitors.js';
import { registerSources } from './sources.js';
import { registerAdminDataRoutes } from './admin-data.js';
import { SourceChecks } from './source-checks.js';
import { registerGameUpdates } from './game-updates.js';
import { registerAccountManagement } from './account-management.js';

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
  await recoverInstallations(store, config);
  const queue = new ImportQueue(store, config, github);
  const checks = new SourceChecks(store, github);
  platform.addHook('onClose', async () => { await checks.close(); });
  const platformHost = new URL(config.platformOrigin).host;

  for (const server of [platform, assets]) {
    server.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: '輸入資料格式不正確', code: 'VALIDATION_ERROR' });
      if (error instanceof AppError)
        return reply.code(error.statusCode).send({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) });
      const status = (error as { statusCode?: number }).statusCode;
      if (status && status >= 400 && status < 500)
        return reply
          .code(status)
          .send({ error: status === 429 ? '操作太頻繁，請稍後再試' : '請求無法處理', code: defaultErrorCode(status) });
      server.log.error(error);
      return reply.code(500).send({ error: '伺服器暫時無法完成操作', code: 'INTERNAL_ERROR' });
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
      throw new AppError(403, '請求來源驗證失敗', 'ORIGIN_REJECTED');
  });

  const access = await createSessionAccess(config, store);
  const { requireUser, requirePermission, startSession } = access;
  const requireGames = requirePermission('games.manage');
  const requireAnalytics = requirePermission('analytics.read');
  registerCareer(platform, store, requireUser);
  registerCloudSave(platform, store, requireUser);
  registerPlayerLibrary(platform, store, requireUser);
  registerAnalytics(platform, store, config, requireAnalytics);
  registerVisitors(platform, store, config, requireAnalytics, requirePermission('visitors.read'));
  registerSources(platform, store, github, queue, requireGames, checks);
  registerAdminDataRoutes(platform, store, requireGames);
  registerGameUpdates(platform, store, config, requireGames);
  registerAccountManagement(platform, store, requirePermission('accounts.manage'));
  registerAccountSettings(platform, store, requireUser, startSession);
  platform.get('/api/v1/health', async () => {
    store.sqlite.prepare('SELECT 1').get();
    return { status: 'ok', commit: config.commit };
  });
  registerAccountSession(platform, store, access);
  registerPlatformUpdates(platform, config, requirePermission('platform.manage'));
  registerGameCatalog(platform, store, config);
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
        return reply.code(404).send({ error: '找不到頁面', code: 'NOT_FOUND' });
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  } else {
    platform.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: '找不到頁面', code: 'NOT_FOUND' }));
  }

  registerGameAssets(assets, config, store);
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
