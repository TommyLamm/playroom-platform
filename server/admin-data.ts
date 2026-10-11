import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './db.js';
import { gameId, gameVersion } from '../shared/manifest.js';
import { saveCompatibility } from './save-compatibility.js';
import { readGamePage, readGame, readVersionPage, readVersion, readSourcePage, readSource,
  readSelection, readUpdatePage, readAdminSummary, readAdminTasks, readSourceSelection, readSourceOwners } from './admin-data-service.js';
export * from './admin-data-service.js';

export function registerAdminDataRoutes(app: FastifyInstance, store: Store, requireGames: (request: FastifyRequest) => Promise<void>) {
  const guard = { preHandler: requireGames };
  app.get('/api/v1/admin/overview', guard, async () => ({ ...readAdminSummary(store), jobs: readAdminTasks(store).jobs }));
  app.get('/api/v1/admin/games', guard, async (request) => readGamePage(store, request.query));
  app.get('/api/v1/admin/games/:id', guard, async (request) => ({ game: readGame(store, z.object({ id: gameId }).parse(request.params).id) }));
  app.get('/api/v1/admin/games/:id/versions', guard, async (request) => readVersionPage(store, z.object({ id: gameId }).parse(request.params).id, request.query));
  app.get('/api/v1/admin/games/:id/versions/:version', guard, async (request) => {
    const { id, version } = z.object({ id: gameId, version: gameVersion }).parse(request.params);
    const stored = readVersion(store, id, version);
    return { game: readGame(store, id), version: stored, saveCompatibility: saveCompatibility(store, stored.manifest) };
  });
  app.get('/api/v1/admin/source-list', guard, async (request) => readSourcePage(store, request.query));
  app.post('/api/v1/admin/source-selection', guard, async (request) => {
    const { ids } = z.object({ ids: z.array(z.number().int().positive()).max(100) }).strict().parse(request.body);
    return { items: readSourceSelection(store, ids) };
  });
  app.get('/api/v1/admin/source-list/:id', guard, async (request) => ({ source: readSource(store, z.object({ id: z.coerce.number().int().positive() }).parse(request.params).id) }));
  app.get('/api/v1/admin/source-owners', guard, async () => ({ owners: readSourceOwners(store) }));
  app.get('/api/v1/admin/update-candidates', guard, async (request) => readUpdatePage(store, request.query));
  app.post('/api/v1/admin/update-candidates/selection', guard, async (request) => {
    const { keys, choices } = z.object({ keys: z.array(z.string().max(120)).max(100), choices: z.record(z.string(), z.string()).default({}) }).strict().parse(request.body);
    return { items: keys.length ? readSelection(store, [...new Set(keys)], choices) : [] };
  });
  app.get('/api/v1/admin/summary', guard, async () => readAdminSummary(store));
  app.get('/api/v1/admin/tasks', guard, async () => readAdminTasks(store));
}
