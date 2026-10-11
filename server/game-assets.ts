import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import mime from 'mime-types';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Store } from './db.js';
import { gameId, gameVersion, isSafePath } from '../shared/manifest.js';
import { AppError } from './errors.js';
import { requirePreview } from './preview-service.js';
import { isListed, readVersion } from './game-catalog.js';

export function registerGameAssets(assets: FastifyInstance, config: Config, store: Store) {
  const assetsHost = new URL(config.gamesOrigin).host;
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
      requirePreview(store, preview, id, version);
    } else {
      // Access to a published historical release remains valid while the game is listed.
      const stored = readVersion(store, id, version);
      if (!isListed(store, id) || !stored?.publishedAt) throw new AppError(404, '遊戲尚未發布或已下架');
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
    reply.code(404).send({ error: '找不到遊戲資源', code: 'NOT_FOUND' }),
  );

}
