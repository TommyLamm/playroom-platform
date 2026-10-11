import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createOperationRegistry } from '../client/game-bridge/operations.js';
import { createFormalOperations } from '../client/game-bridge/formal.js';
import { createPreviewOperations } from '../client/game-bridge/preview.js';
import { isRequestMessage, type RequestMessage } from '../shared/protocol.js';
import { manifestSchema, cloudSaveCompatibility } from '../shared/manifest.js';
import { testManifest } from './helpers.js';

const run = promisify(execFile);
const request: RequestMessage = { protocol: 'playroom', version: 1, type: 'request', connection: '00000000-0000-4000-8000-000000000001', requestId: '00000000-0000-4000-8000-000000000002', method: 'saveProgress', payload: { data: { level: 2 }, revision: 0, formatVersion: 1 } };

test('bridge binds a requestId to canonical payload across success, failure and retry', async () => {
  const registry = createOperationRegistry(); let calls = 0;
  const operation = () => { calls++; return Promise.resolve({ saved: true }); };
  const result = await registry.run(request, operation);
  assert.deepEqual(await registry.run({ ...request, payload: { formatVersion: 1, revision: 0, data: { level: 2 } } }, operation), result);
  assert.equal(calls, 1);
  await assert.rejects(registry.run({ ...request, payload: { data: { level: 3 }, revision: 0, formatVersion: 1 } }, operation), (error: unknown) => (error as { machineCode: string }).machineCode === 'REQUEST_ID_REUSED');
  await assert.rejects(registry.run({ ...request, method: 'loadProgress' }, operation), /requestId/);
  const failed = { ...request, requestId: '00000000-0000-4000-8000-000000000003' };
  await assert.rejects(registry.run(failed, () => Promise.reject(new Error('network'))), /network/);
  await assert.rejects(registry.run({ ...failed, payload: {} }, operation), /requestId/);
  await registry.run(failed, operation); assert.equal(calls, 2);
});

test('request envelope and schema2 declarations preserve old schema and reject invalid contracts', () => {
  assert.equal(isRequestMessage(request), true);
  assert.equal(isRequestMessage({ ...request, unexpected: true }), false);
  assert.equal(isRequestMessage({ ...request, connection: 'invalid' }), false);
  assert.equal(cloudSaveCompatibility(testManifest, 1), 'unknown');
  const declared = manifestSchema.parse({ ...testManifest, schemaVersion: 2, cloudSave: { readableFormats: [1, 2], writeFormat: 2 } });
  assert.equal(cloudSaveCompatibility(declared, 2), 'compatible');
  assert.equal(cloudSaveCompatibility(declared, 3), 'incompatible');
  for (const cloudSave of [{ readableFormats: [1], writeFormat: 2 }, { readableFormats: [1, 1], writeFormat: 1 }, { readableFormats: [], writeFormat: 1 }]) assert.equal(manifestSchema.safeParse({ ...testManifest, schemaVersion: 2, cloudSave }).success, false);
  assert.equal(manifestSchema.safeParse({ ...testManifest, cloudSave: declared.cloudSave }).success, false);
});

test('formal and preview operations share payload validation while preview calls no API', async () => {
  const calls: { path: string; body?: unknown }[] = [];
  const formal = createFormalOperations({ game: { ...testManifest, version: testManifest.version } as never, active: () => true, ensurePlay: async () => 'play', save: async () => ({ saved: true }), progressSaved() {}, call: async <T>(path: string, body?: unknown) => { calls.push({ path, body }); return null as T; } });
  await formal({ ...request, method: 'loadProgress', payload: {} });
  assert.equal(calls[0].path, `/games/${testManifest.id}/save?version=${testManifest.version}`);
  const preview = createPreviewOperations(testManifest, () => {});
  await assert.rejects(formal({ ...request, payload: { revision: 0 } }), /formatVersion/);
  await assert.rejects(preview({ ...request, payload: { revision: 0 } }), /formatVersion/);
  assert.equal(await preview(request), null);
  assert.equal(calls.length, 1);
});

test('tool archive, standalone CLI and game packing are reproducible with no installed runtime', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-tools-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  await run(process.execPath, ['--import', 'tsx', 'scripts/build-game-tools.ts']);
  const archive = 'artifacts/playroom-game-tools-1.1.0.zip';
  const hash = () => fs.readFile(archive).then((data) => createHash('sha256').update(data).digest('hex'));
  const first = await hash();
  await run(process.execPath, ['--import', 'tsx', 'scripts/build-game-tools.ts']);
  assert.equal(await hash(), first);
  const lock = JSON.parse(await fs.readFile('templates/game-tools.lock.json', 'utf8'));
  assert.equal(lock.sha256, first);
  const root = 'artifacts/game-tools/1.1.0';
  for (const name of ['pack-game.mjs', 'validate-game.mjs']) await fs.copyFile(path.join(root, name), path.join(temp, name));
  await fs.cp('examples/starter', path.join(temp, 'game'), { recursive: true });
  await run(process.execPath, [path.join(temp, 'pack-game.mjs'), path.join(temp, 'game'), path.join(temp, 'one.zip')], { cwd: temp, env: { ...process.env, TZ: 'Asia/Hong_Kong' } });
  await fs.utimes(path.join(temp, 'game', 'index.html'), new Date(), new Date());
  await run(process.execPath, [path.join(temp, 'pack-game.mjs'), path.join(temp, 'game'), path.join(temp, 'two.zip')], { cwd: temp, env: { ...process.env, TZ: 'Pacific/Honolulu' } });
  assert.deepEqual(await fs.readFile(path.join(temp, 'one.zip')), await fs.readFile(path.join(temp, 'two.zip')));
  const result = await run(process.execPath, [path.join(temp, 'validate-game.mjs'), path.join(temp, 'one.zip')], { cwd: temp });
  assert.match(result.stdout, /tools 1.1.0/);
});
