import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer as createSocketServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { createServer, type ProxyOptions } from 'vite';
import { createApplication } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { openStore } from '../server/db.js';
import viteConfig from '../vite.config.js';

// Native HTTP preserves an explicit Host; Node fetch rewrites it from the URL.
function fetchViaProxy(url: string, options: { method?: string; headers?: Record<string, string>; body?: string }) {
  return new Promise<{ status: number; json: () => Record<string, unknown>; cookie?: string }>((resolve, reject) => {
    const request = httpRequest(url, { method: options.method, headers: options.headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode!, json: () => JSON.parse(body), cookie: response.headers['set-cookie']?.[0] }));
    });
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('Proxy request timed out')));
    request.end(options.body);
  });
}

test('Vite forwards the platform Host and Origin; wrong hosts and write origins remain blocked', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-dev-proxy-'));
  const config = getConfig({ dataDir: root, platformOrigin: 'http://localhost:5173', production: false, clientDir: path.join(root, 'no-client') });
  const store = openStore(root);
  const app = await createApplication(config, store);
  t.after(async () => { await app.close(); store.sqlite.close(); await fs.rm(root, { recursive: true, force: true }); });
  const target = await app.platform.listen({ port: 0, host: '127.0.0.1' });
  // Vite treats port 0 as its default port; allocate a separate test port.
  const socket = createSocketServer();
  await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const reserved = socket.address();
  assert.ok(reserved && typeof reserved === 'object');
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  const proxy = viteConfig.server!.proxy!['/api'] as ProxyOptions;
  const vite = await createServer({
    ...viteConfig, configFile: false, clearScreen: false, logLevel: 'silent',
    server: { ...viteConfig.server, host: '127.0.0.1', port: reserved.port, proxy: { '/api': { ...proxy, target } } },
  });
  t.after(() => vite.close());
  await vite.listen();
  const address = vite.httpServer!.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/v1`;
  const headers = { host: 'localhost:5173', origin: config.platformOrigin };
  assert.equal((await fetchViaProxy(`${url}/games`, { headers })).status, 200);
  assert.equal((await fetchViaProxy(`${url}/games`, { headers: { host: '127.0.0.1:5173' } })).status, 421);
  assert.equal((await fetchViaProxy(`${url}/register`, { method: 'POST', headers: { ...headers, origin: config.gamesOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'proxy_player', password: 'proxy-player-password' }) })).status, 403);
  const registration = await fetchViaProxy(`${url}/register`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'proxy_player', password: 'proxy-player-password' }) });
  assert.equal(registration.status, 201);
  assert.equal((await registration.json()).role, 'player');
  const cookie = registration.cookie!.split(';')[0];
  const session = await fetchViaProxy(`${url}/session`, { headers: { ...headers, cookie } });
  assert.equal((await session.json()).username, 'proxy_player');
});
