import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './db.js';
import { gameId } from '../shared/manifest.js';
import { saveProgressRequest, loadProgressQuery, restoreProgressRequest } from '../shared/cloud-save.js';
import { createCloudSaveService } from './cloud-save-service.js';

export function registerCloudSave(platform: FastifyInstance, store: Store, requireUser: (request: FastifyRequest) => Promise<void>) {
  const service = createCloudSaveService(store);
  const params = z.object({ id: gameId });
  const emptyQuery = z.object({}).strict();
  const options = (max: number) => ({ onRequest: requireUser, config: { rateLimit: {
    hook: 'preHandler' as const, max, timeWindow: '1 minute',
    keyGenerator: (request: FastifyRequest) => String(request.userSession!.userId),
  } } });

  platform.get('/api/v1/games/:id/save', options(120), async (request) => {
    const query = loadProgressQuery.parse(request.query);
    const { id } = params.parse(request.params);
    return service.load(request.userSession!.userId, id, query.version);
  });
  platform.post('/api/v1/games/:id/save', { ...options(60), bodyLimit: 96 * 1024 }, async (request) => {
    emptyQuery.parse(request.query);
    const { id } = params.parse(request.params);
    service.requireAvailable(id);
    return service.save(request.userSession!.userId, id, saveProgressRequest.parse(request.body));
  });
  // Owner-only recovery surface; deliberately unavailable through the game SDK.
  platform.get('/api/v1/games/:id/save/snapshots', options(120), async (request) => {
    emptyQuery.parse(request.query);
    const { id } = params.parse(request.params);
    return service.snapshots(request.userSession!.userId, id);
  });
  platform.post('/api/v1/games/:id/save/restore', options(60), async (request) => {
    emptyQuery.parse(request.query);
    const { id } = params.parse(request.params);
    service.requireAvailable(id);
    return service.restore(request.userSession!.userId, id, restoreProgressRequest.parse(request.body));
  });
}
