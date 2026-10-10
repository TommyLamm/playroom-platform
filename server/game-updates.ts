import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { games, users, versions, type Store } from './db.js';
import { gameId, gameVersion } from '../shared/manifest.js';
import { AppError } from './errors.js';
import { publish } from './library.js';
import type { PublishSelection, PublishResult } from '../shared/game-updates.js';
import { compareVersions } from '../shared/game-updates.js';

export function publishReviewed(store: Store, id: string, version: string, expected?: PublishSelection): 'published' | 'skipped' {
  return store.db.transaction(() => {
    const game = store.db.select().from(games).where(eq(games.id, id)).get();
    const stored = store.db.select().from(versions).where(and(eq(versions.gameId, id), eq(versions.version, version))).get();
    if (!game || !stored) throw new AppError(404, '找不到此遊戲版本');
    if (game.published && game.activeVersion === version) return 'skipped';
    if (expected && (game.activeVersion !== expected.expectedActiveVersion || game.published !== expected.expectedPublished))
      throw new AppError(409, '上架狀態已由其他管理者修改，請刷新並重新確認');
    if (game.activeVersion && compareVersions(version, game.activeVersion) <= 0 &&
        (!stored.publishedAt || expected && version !== game.activeVersion))
      throw new AppError(409, '更新版本必須高於目前版本；歷史版本回退請使用「遊戲與版本」');
    if (!stored.publishedAt && !stored.reviewedAt) throw new AppError(409, '請先預覽並確認此版本通過驗收');
    publish(store, id, version);
    return 'published';
  });
}

export function registerGameUpdates(app: FastifyInstance, store: Store, requireGames: (request: FastifyRequest) => Promise<void>) {
  app.post('/api/v1/admin/games/:id/review', { preHandler: requireGames }, async (request) => {
    const { id } = z.object({ id: gameId }).parse(request.params);
    const { version, approved } = z.object({ version: gameVersion, approved: z.boolean() }).strict().parse(request.body);
    const stored = store.db.select().from(versions).where(and(eq(versions.gameId, id), eq(versions.version, version))).get();
    if (!stored) throw new AppError(404, '找不到此遊戲版本');
    const user = store.db.select().from(users).where(eq(users.id, request.userSession!.userId)).get()!;
    const record = store.db.update(versions).set({ reviewedBy: approved ? user.username : null,
      reviewedAt: approved ? new Date().toISOString() : null }).where(eq(versions.id, stored.id)).returning().get();
    return { version: record };
  });
  app.post('/api/v1/admin/publish-batches', { preHandler: requireGames }, async (request) => {
    const { items } = z.object({ items: z.array(z.object({ gameId, version: gameVersion,
      expectedActiveVersion: gameVersion.nullable(), expectedPublished: z.boolean() }).strict()).min(1).max(100)
      .refine((values) => new Set(values.map((v) => v.gameId)).size === values.length) }).strict().parse(request.body);
    const results: PublishResult[] = items.map((item) => {
      try {
        return { gameId: item.gameId, version: item.version, status: publishReviewed(store, item.gameId, item.version, item), error: null };
      } catch (error) {
        if (!(error instanceof AppError)) app.log.error(error);
        return { gameId: item.gameId, version: item.version, status: 'failed',
          error: error instanceof AppError ? error.message : '發布失敗，請重試' };
      }
    });
    return { results };
  });
}
