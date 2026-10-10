import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './db.js';
import { AppError } from './errors.js';
import { gameId } from '../shared/manifest.js';
import { saveProgressRequest, type ProgressSave } from '../shared/cloud-save.js';

type Row = { data: string; revision: number; format_version: number; game_version: string; updated_at: string; request_id: string };
export function registerCloudSave(platform: FastifyInstance, store: Store, requireUser: (request: FastifyRequest) => Promise<void>) {
  const sql = store.sqlite;
  const options = (max: number) => ({ onRequest: requireUser, config: { rateLimit: {
    hook: 'preHandler' as const, max, timeWindow: '1 minute',
    keyGenerator: (request: FastifyRequest) => String(request.userSession!.userId),
  } } });
  function available(request: FastifyRequest) {
    const { id } = z.object({ id: gameId }).parse(request.params);
    if (!sql.prepare('SELECT 1 FROM games WHERE id=? AND published=1').get(id)) throw new AppError(404, '這款遊戲尚未上架或已下架');
    return id;
  }
  const read = (user: number, id: string) => sql.prepare('SELECT * FROM cloud_saves WHERE user_id=? AND game_id=?').get(user, id) as Row | undefined;
  const view = (row: Row): ProgressSave => ({ data: JSON.parse(row.data), revision: row.revision, formatVersion: row.format_version, gameVersion: row.game_version, updatedAt: row.updated_at });
  platform.get('/api/v1/games/:id/save', options(120), async (request) => {
    z.object({}).strict().parse(request.query);
    const row = read(request.userSession!.userId, available(request));
    return row ? view(row) : null;
  });
  platform.post('/api/v1/games/:id/save', { ...options(60), bodyLimit: 96 * 1024 }, async (request) => {
    z.object({}).strict().parse(request.query);
    const id = available(request);
    const input = saveProgressRequest.parse(request.body);
    if (!sql.prepare('SELECT 1 FROM versions WHERE game_id=? AND version=? AND published_at IS NOT NULL').get(id, input.version)) throw new AppError(404, '找不到已發布的遊戲版本');
    const user = request.userSession!.userId;
    const data = JSON.stringify(input.data);
    return sql.transaction(() => {
      const previous = read(user, id);
      if (previous?.request_id === input.requestId) {
        if (previous.data !== data || previous.format_version !== input.formatVersion || previous.game_version !== input.version || previous.revision !== input.revision + 1) throw new AppError(409, '存檔請求識別已被使用');
        return { saved: true, ...view(previous) };
      }
      if ((previous?.revision ?? 0) !== input.revision) throw new AppError(409, '另一台設備已更新進度，請重新讀取存檔後再保存');
      const updatedAt = new Date().toISOString();
      sql.prepare(`INSERT INTO cloud_saves (user_id,game_id,data,revision,format_version,game_version,updated_at,request_id)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,game_id) DO UPDATE SET
        data=excluded.data,revision=excluded.revision,format_version=excluded.format_version,
        game_version=excluded.game_version,updated_at=excluded.updated_at,request_id=excluded.request_id`)
        .run(user, id, data, input.revision + 1, input.formatVersion, input.version, updatedAt, input.requestId);
      return { saved: true, ...view(read(user, id)!) };
    })();
  });
}
