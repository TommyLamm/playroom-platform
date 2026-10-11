import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import { updater } from './platform-update-service.js';

export function registerPlatformUpdates(platform: FastifyInstance, config: Config, requirePlatform: (request: FastifyRequest) => Promise<void>) {
  platform.get('/api/v1/admin/updates', { preHandler: requirePlatform }, () => updater(config, 'status'));
  platform.post('/api/v1/admin/updates/check', { preHandler: requirePlatform }, () =>
    updater(config, 'check', {}),
  );
  platform.post('/api/v1/admin/updates', { preHandler: requirePlatform }, async (request, reply) => {
    const input = z
      .object({ commit: z.string().regex(/^[a-f0-9]{40}$/) })
      .strict()
      .parse(request.body);
    return reply.code(202).send(await updater(config, 'update', input));
  });

}
