import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from './db.js';
import type { Config } from './config.js';
import { gameId } from '../shared/manifest.js';
import { AppError } from './errors.js';
import { publicLibrary } from './game-catalog.js';

export function registerGameCatalog(platform: FastifyInstance, store: Store, config: Config) {
  platform.get('/api/v1/games', async () => ({ games: publicLibrary(store, config) }));
  platform.get('/api/v1/games/:id', async (request) => {
    const { id } = z.object({ id: gameId }).parse(request.params);
    const game = publicLibrary(store, config).find((g) => g.id === id);
    if (!game) throw new AppError(404, '這款遊戲尚未上架或已下架');
    return { game };
  });


}
