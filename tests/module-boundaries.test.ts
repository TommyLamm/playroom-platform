import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('boundary check rejects cross-module writes and HTTP dependencies, while allowing owned writes and report reads', async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-boundaries-'));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  await fs.mkdir(path.join(fixture, 'server', 'database'), { recursive: true });
  await fs.writeFile(path.join(fixture, 'server', 'database', 'schema.ts'),
    "export const games = sqliteTable('games', {});\nexport const cloudSaves = sqliteTable('cloud_saves', {});\n");
  await fs.writeFile(path.join(fixture, 'server', 'db.ts'), "export * from './database/schema.js';\n");
  const check = () => spawnSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('scripts/check-module-boundaries.ts')], { cwd: fixture, encoding: 'utf8' });
  const write = (name: string, source: string) => fs.writeFile(path.join(fixture, 'server', name + '.ts'), source);

  await write('analytics', "sql.prepare('SELECT count(*) FROM cloud_saves JOIN games ON games.id=game_id').get();");
  await write('cloud-save-service', "import { cloudSaves as saves } from './db.js';\nstore.db.insert(saves).values({});\nsql.prepare('UPDATE cloud_saves SET revision=1').run();");
  let result = check();
  assert.equal(result.status, 0, result.stderr);

  await write('analytics', "import { cloudSaves as saves } from './db.js';\nstore.db.update(saves).set({});\nsql.prepare('DELETE FROM games').run();");
  result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /analytics.ts writes cloud_saves outside/);
  assert.match(result.stderr, /analytics.ts writes games outside/);

  await write('analytics', '');
  await write('source-service', "import type { FastifyRequest } from 'fastify';\nimport { route } from './sources.js';");
  await write('sources', 'const row = store.sqlite.prepare("SELECT 1").get();');
  result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /imports HTTP types\/runtime into a service/);
  assert.match(result.stderr, /imports an HTTP route module/);
  assert.match(result.stderr, /accesses persistence in an HTTP route/);
});
