import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Store } from './db.js';
import { ownerName, type GitHubSource } from './github.js';
import type { ImportQueue } from './import-queue.js';
import type { SourceChecks } from './source-checks.js';
import { readSourcePage } from './admin-data-service.js';
import { createSourceService } from './source-service.js';
import { createImportBatchService } from './import-batch-service.js';

const idParams = z.object({ id: z.coerce.number().int().positive() });
const selectionSchema = z.object({ repositoryId: z.number().int().positive(), releaseId: z.number().int().positive() }).strict();

export function registerSources(app: FastifyInstance, store: Store, github: GitHubSource, queue: ImportQueue,
  requireAdmin: (request: FastifyRequest) => Promise<void>, checks: SourceChecks) {
  const service = createSourceService(store, github, checks);
  const batches = createImportBatchService(store, queue);
  const options = { preHandler: requireAdmin };
  app.get('/api/v1/admin/github-owners', options, async () => ({ owners: service.owners() }));
  app.post('/api/v1/admin/github-owners', options, async (request) => {
    const { login } = z.object({ login: ownerName }).strict().parse(request.body);
    return { owner: await service.addOwner(login) };
  });
  app.post('/api/v1/admin/github-owners/:login/remove', options, async (request) => {
    const { login } = z.object({ login: ownerName }).parse(request.params);
    return service.removeOwner(login);
  });
  app.get('/api/v1/admin/github-owners/:login/repositories', options, async (request) => {
    const { login } = z.object({ login: ownerName }).parse(request.params);
    const { page } = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).parse(request.query);
    return service.discover(login, page);
  });
  app.get('/api/v1/admin/sources', options, async (request) => {
    const result = readSourcePage(store, request.query);
    return { sources: result.items, total: result.total, page: result.page, size: result.size };
  });
  app.post('/api/v1/admin/repositories', options, async (request, reply) => {
    const input = z.object({ fullName: z.string().max(240) }).parse(request.body);
    const result = await service.addRepository(input.fullName);
    if (result.created) return reply.code(201).send({ repository: result.repository });
    return { repository: result.repository };
  });
  app.get('/api/v1/admin/repositories/:id/releases', options, async (request) => {
    const { id } = idParams.parse(request.params);
    return { releases: await service.releases(id) };
  });
  app.post('/api/v1/admin/repositories/:id/state', options, async (request) => {
    const { id } = idParams.parse(request.params);
    const { archived } = z.object({ archived: z.boolean() }).strict().parse(request.body);
    return service.archive(id, archived);
  });
  app.post('/api/v1/admin/repositories/:id/check', options, async (request) => {
    const { id } = idParams.parse(request.params);
    return { source: await service.check(id) };
  });
  app.post('/api/v1/admin/source-checks', options, async (request, reply) => {
    const { force } = z.object({ force: z.boolean().default(true) }).strict().parse(request.body);
    return reply.code(202).send({ check: checks.checkAll(force) });
  });
  app.get('/api/v1/admin/source-checks/current', options, async () => ({ check: checks.current() }));
  app.post('/api/v1/admin/imports', options, async (request, reply) => {
    // Preserve the legacy single-import input (extra fields were accepted).
    const input = z.object({ repositoryId: z.number().int().positive(), releaseId: z.number().int().positive() }).parse(request.body);
    return reply.code(202).send({ jobId: queue.enqueue(input.repositoryId, input.releaseId) });
  });
  app.post('/api/v1/admin/import-batches', options, async (request, reply) => {
    const input = z.object({ requestId: z.string().uuid(), items: z.array(selectionSchema).min(1).max(100) }).strict().parse(request.body);
    return reply.code(202).send({ batch: batches.create(input) });
  });
  app.get('/api/v1/admin/import-batches', options, async () => batches.list());
  app.get('/api/v1/admin/import-batches/:id', options, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { batch: batches.read(id) };
  });
}
