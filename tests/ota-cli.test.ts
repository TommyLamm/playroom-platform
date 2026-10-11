import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// @ts-expect-error The deployment CLI uses native JavaScript inside the updater container.
import { requestUpdater } from '../scripts/ota-cli.mjs';

test('OTA CLI sends authenticated check/status requests and an explicit commit to the updater', async (t) => {
  const requests: Array<{ method: string | undefined; url: string | undefined; auth: string | undefined; body: string }> = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
    res.writeHead(req.url === '/update' ? 202 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/update' ? { jobId: 'job-1' } : { current: 'old' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as { port: number };
  const config = { baseUrl: `http://127.0.0.1:${address.port}`, token: 'test-token' };
  assert.deepEqual(await requestUpdater('check', '', config), { current: 'old' });
  assert.deepEqual(await requestUpdater('status', '', config), { current: 'old' });
  assert.deepEqual(await requestUpdater('update', 'a'.repeat(40), config), { jobId: 'job-1' });
  assert.deepEqual(requests, [
    { method: 'POST', url: '/check', auth: 'Bearer test-token', body: '{}' },
    { method: 'GET', url: '/status', auth: 'Bearer test-token', body: '' },
    { method: 'POST', url: '/update', auth: 'Bearer test-token', body: JSON.stringify({ commit: 'a'.repeat(40) }) },
  ]);
});

test('OTA CLI rejects missing tokens, unsupported actions and invalid commits before connecting', async () => {
  const config = { baseUrl: 'http://127.0.0.1:1', token: 'test-token' };
  await assert.rejects(requestUpdater('status', '', { ...config, token: '' }), /UPDATER_TOKEN/);
  await assert.rejects(requestUpdater('delete', '', config), /action/);
  for (const commit of ['', 'latest', 'a'.repeat(39), 'a'.repeat(41)])
    await assert.rejects(requestUpdater('update', commit, config), /40.*SHA/);
});

test('OTA CLI reports updater rejection instead of claiming the update was accepted', async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Version changed; check again' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as { port: number };
  await assert.rejects(requestUpdater('update', 'b'.repeat(40), {
    baseUrl: `http://127.0.0.1:${address.port}`, token: 'test-token',
  }), /409.*Version changed/);
});

test('OTA CLI streamed through stdin exits unsuccessfully on invalid input without exposing the token', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-', 'update', 'latest'], {
    input: readFileSync(new URL('../scripts/ota-cli.mjs', import.meta.url)),
    encoding: 'utf8',
    env: { ...process.env, UPDATER_TOKEN: 'private-test-token' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /40-character/);
  assert.doesNotMatch(result.stdout + result.stderr, /private-test-token|Update queued/);
});
