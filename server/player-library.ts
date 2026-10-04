import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { gameId } from '../shared/manifest.js';
import type { PlayerLibrary } from '../shared/player-library.js';
import type { Store } from './db.js';
import { AppError } from './errors.js';

export function registerPlayerLibrary(
  platform: FastifyInstance,
  store: Store,
  requireUser: (request: FastifyRequest) => Promise<void>,
) {
  const sql = store.sqlite;
  platform.get('/api/v1/me/library', { onRequest: requireUser }, async (request): Promise<PlayerLibrary> => {
    z.object({}).strict().parse(request.query);
    const userId = request.userSession!.userId;
    const recent = sql.prepare(`
      SELECT p.game_id, MAX(p.started_at) AS last_played_at
      FROM plays p JOIN games g ON g.id=p.game_id
      WHERE p.user_id=? AND g.published=1
      GROUP BY p.game_id ORDER BY last_played_at DESC,p.game_id LIMIT 12
    `).all(userId) as { game_id: string; last_played_at: number }[];
    const favorites = sql.prepare(`
      SELECT f.game_id,f.created_at FROM favorites f JOIN games g ON g.id=f.game_id
      WHERE f.user_id=? AND g.published=1 ORDER BY f.created_at DESC,f.game_id
    `).all(userId) as { game_id: string; created_at: number }[];
    return {
      recent: recent.map((row) => ({ gameId: row.game_id, lastPlayedAt: new Date(row.last_played_at).toISOString() })),
      favorites: favorites.map((row) => ({ gameId: row.game_id, createdAt: new Date(row.created_at).toISOString() })),
    };
  });
  platform.post('/api/v1/me/favorites/:gameId', {
    onRequest: requireUser,
    config: { rateLimit: {
      hook: 'preHandler', max: 60, timeWindow: '1 minute',
      keyGenerator: (request: FastifyRequest) => String(request.userSession!.userId),
    } },
  }, async (request) => {
    const { gameId: id } = z.object({ gameId }).parse(request.params);
    const { favorite } = z.object({ favorite: z.boolean() }).strict().parse(request.body);
    const userId = request.userSession!.userId;
    if (favorite) {
      if (!sql.prepare('SELECT id FROM games WHERE id=? AND published=1').get(id))
        throw new AppError(404, '這款遊戲尚未上架或已下架');
      sql.prepare('INSERT INTO favorites (user_id,game_id,created_at) VALUES (?,?,?) ON CONFLICT(user_id,game_id) DO NOTHING')
        .run(userId, id, Date.now());
    } else {
      sql.prepare('DELETE FROM favorites WHERE user_id=? AND game_id=?').run(userId, id);
    }
    return { favorite };
  });
}
