import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './db.js';
import { gameId } from '../shared/manifest.js';
import { publishBatchRequest, reviewRequest, publishRequest, unpublishRequest, previewRequest, type CommandResponses, type PublishResult } from '../shared/commands.js';
import { AppError } from './errors.js';
import type { Config } from './config.js';
import { createPreview } from './preview-service.js';
import { publishGame, reviewGame, unpublishGame } from './game-commands.js';

export function registerGameUpdates(app: FastifyInstance, store: Store, config: Config, requireGames: (request: FastifyRequest) => Promise<void>) {
  app.post('/api/v1/admin/games/:id/review', { preHandler: requireGames }, async (request): Promise<CommandResponses['review']> => {
    const { id } = z.object({ id: gameId }).parse(request.params);
    return reviewGame(store, request.userSession!.userId, id, reviewRequest.parse(request.body));
  });
  app.post('/api/v1/admin/publish-batches', { preHandler: requireGames }, async (request): Promise<CommandResponses['publishBatch']> => {
    const { items } = publishBatchRequest.parse(request.body);
    const results: PublishResult[] = items.map((item) => {
      try {
        return { gameId: item.gameId, version: item.version,
          status: publishGame(store, request.userSession!.userId, item, 'batch'), error: null, code: null };
      } catch (error) {
        if (!(error instanceof AppError)) app.log.error(error);
        return { gameId: item.gameId, version: item.version, status: 'failed',
          error: error instanceof AppError ? error.message : '發布失敗，請重試',
          code: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
          ...(error instanceof AppError && error.details ? { details: error.details } : {}) };
      }
    });
    return { results };
  });
  app.post(
    '/api/v1/admin/games/:id/publish',
    { preHandler: requireGames },
    async (request) => {
      const { id } = z.object({ id: gameId }).parse(request.params);
      const input = publishRequest.parse(request.body);
      const status = publishGame(store, request.userSession!.userId, { ...input, gameId: id }, 'single');
      return { ok: true, status } satisfies CommandResponses['publish'];
    },
  );
  app.post(
    '/api/v1/admin/games/:id/unpublish',
    { preHandler: requireGames },
    async (request) => {
      const { id } = z.object({ id: gameId }).parse(request.params);
      return unpublishGame(store, request.userSession!.userId, id, unpublishRequest.parse(request.body));
    },
  );
  app.post(
    '/api/v1/admin/games/:id/preview',
    { preHandler: requireGames },
    async (request) => {
      const { id } = z.object({ id: gameId }).parse(request.params);
      const { version } = previewRequest.parse(request.body);
      return createPreview(store, config, id, version);
    },
  );

}
