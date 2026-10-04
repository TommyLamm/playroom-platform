import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { eq } from 'drizzle-orm';
import { getConfig } from '../server/config.js';
import { openStore, users, previews } from '../server/db.js';
import { passwordHash } from '../server/auth.js';
import { createApplication } from '../server/app.js';
import { fakeGitHub } from './helpers.js';
import { backup, restore } from '../server/maintenance.js';

test('platform lifecycle: authentication, import, preview, publish, update, rollback, restore', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-platform-'));
  const config = getConfig({
    dataDir: path.join(root, 'data'),
    clientDir: path.join(root, 'no-client'),
    production: false,
  });
  const store = openStore(config.dataDir);
  store.db
    .insert(users)
    .values({
      id: 1,
      username: 'admin',
      role: 'admin',
      password: await passwordHash('integration-password'),
    })
    .run();
  const github = await fakeGitHub(root);
  const app = await createApplication(config, store, { github });
  t.after(async () => {
    await app.close();
    store.sqlite.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const publicHeaders = { host: new URL(config.platformOrigin).host };
  const assetHeaders = { host: new URL(config.gamesOrigin).host };
  const request = (url: string, body?: unknown, headers = publicHeaders) =>
    app.platform.inject({
      method: body === undefined ? 'GET' : 'POST',
      url,
      headers,
      payload: body as object,
    });
  assert.equal((await request('/api/v1/admin/overview')).statusCode, 401);
  assert.equal(
    (await request('/api/v1/login', { username: 'admin', password: 'integration-password' }))
      .statusCode,
    403,
  );
  const login = await request(
    '/api/v1/login',
    { username: 'admin', password: 'integration-password' },
    { ...publicHeaders, origin: config.platformOrigin },
  );
  assert.equal(login.statusCode, 200);
  const headers = {
    ...publicHeaders,
    origin: config.platformOrigin,
    cookie: String(login.headers['set-cookie']).split(';')[0],
    'x-csrf-token': login.json().csrf,
  };
  assert.ok(String(login.headers['set-cookie']).includes('HttpOnly'));
  assert.ok(!String(login.headers['set-cookie']).includes('Domain='));
  assert.equal(
    (
      await request(
        '/api/v1/admin/repositories',
        { fullName: 'example/game' },
        { ...headers, 'x-csrf-token': 'wrong' },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        '/api/v1/admin/repositories',
        { fullName: 'example/game' },
        { ...headers, origin: config.gamesOrigin },
      )
    ).statusCode,
    403,
  );
  const repositoryId = (
    await request('/api/v1/admin/repositories', { fullName: 'example/game' }, headers)
  ).json().repository.id;
  async function importRelease(releaseId: number) {
    const response = await request('/api/v1/admin/imports', { repositoryId, releaseId }, headers);
    assert.equal(response.statusCode, 202);
    await app.queue.idle();
    const overview = (await request('/api/v1/admin/overview', undefined, headers)).json();
    return overview.jobs.find((j: { id: string }) => j.id === response.json().jobId);
  }
  assert.equal((await importRelease(101)).status, 'completed');
  assert.equal((await request('/api/v1/games')).json().games.length, 0);
  const assetUrl = '/games/test-game/1.0.0/index.html';
  assert.equal((await app.assets.inject({ url: assetUrl, headers: assetHeaders })).statusCode, 404);
  assert.equal(
    (await app.assets.inject({ url: '/api/v1/admin/overview', headers: assetHeaders })).statusCode,
    404,
  );
  assert.equal(
    (
      await app.platform.inject({
        url: '/api/v1/admin/overview',
        headers: { ...headers, host: new URL(config.gamesOrigin).host },
      })
    ).statusCode,
    421,
  );
  const preview = (
    await request('/api/v1/admin/games/test-game/preview', { version: '1.0.0' }, headers)
  ).json();
  const previewUrl = new URL(preview.url).pathname;
  assert.equal(
    (await app.assets.inject({ url: previewUrl, headers: assetHeaders })).statusCode,
    200,
  );
  assert.equal(
    (
      await app.assets.inject({
        url: previewUrl.replace('index.html', 'game.js'),
        headers: assetHeaders,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.assets.inject({
        url: previewUrl.replace('/test-game/', '/another-game/'),
        headers: assetHeaders,
      })
    ).statusCode,
    403,
  );
  store.db.update(previews).set({ expiresAt: 0 }).run();
  assert.equal(
    (await app.assets.inject({ url: previewUrl, headers: assetHeaders })).statusCode,
    403,
  );
  assert.equal(
    (await request('/api/v1/admin/games/test-game/publish', { version: '1.0.0' }, headers))
      .statusCode,
    200,
  );
  assert.equal((await app.assets.inject({ url: assetUrl, headers: assetHeaders })).statusCode, 200);
  assert.equal((await request('/api/v1/games')).json().games[0].version, '1.0.0');
  const duplicate = await importRelease(101);
  assert.equal(duplicate.status, 'failed');
  assert.match(duplicate.error, /已匯入/);
  const originalDownload = github.download;
  github.download = async () => {
    throw new Error('network interrupted');
  };
  assert.equal((await importRelease(102)).status, 'failed');
  assert.equal((await request('/api/v1/games')).json().games[0].version, '1.0.0');
  github.download = originalDownload;
  const originalResolve = github.resolve;
  github.resolve = async (...args) => {
    const resolved = await originalResolve(...args);
    return { ...resolved, release: { ...resolved.release, tag: 'v9.9.9' } };
  };
  const mismatchedTag = await importRelease(102);
  assert.equal(mismatchedTag.status, 'failed');
  assert.match(mismatchedTag.error, /Release tag/);
  assert.equal((await request('/api/v1/games')).json().games[0].version, '1.0.0');
  github.resolve = originalResolve;
  assert.equal((await importRelease(102)).status, 'completed');
  await request('/api/v1/admin/games/test-game/publish', { version: '2.0.0' }, headers);
  assert.equal((await request('/api/v1/games')).json().games[0].version, '2.0.0');
  await request('/api/v1/admin/games/test-game/publish', { version: '1.0.0' }, headers);
  assert.equal((await request('/api/v1/games')).json().games[0].version, '1.0.0');
  await request('/api/v1/admin/games/test-game/unpublish', {}, headers);
  assert.equal((await app.assets.inject({ url: assetUrl, headers: assetHeaders })).statusCode, 404);
  assert.equal((await request('/api/v1/games')).json().games.length, 0);
  await request('/api/v1/admin/games/test-game/publish', { version: '2.0.0' }, headers);
  const backupPath = path.join(root, 'backup');
  await backup(config.dataDir, backupPath);
  const restoredDir = path.join(root, 'restored');
  await restore(backupPath, restoredDir);
  await assert.rejects(restore(backupPath, restoredDir), /empty/);
  const restored = openStore(restoredDir);
  const restoredApp = await createApplication({ ...config, dataDir: restoredDir }, restored, {
    github,
  });
  try {
    assert.equal(
      (await restoredApp.platform.inject({ url: '/api/v1/games', headers: publicHeaders })).json()
        .games[0].version,
      '2.0.0',
    );
    assert.equal(
      (await restoredApp.platform.inject({ url: '/api/v1/admin/overview', headers })).statusCode,
      401,
    );
    assert.equal(
      (
        await restoredApp.assets.inject({
          url: '/games/test-game/2.0.0/index.html',
          headers: assetHeaders,
        })
      ).statusCode,
      200,
    );
  } finally {
    await restoredApp.close();
    restored.sqlite.close();
  }
  await fs.appendFile(
    path.join(backupPath, 'games', 'test-game', '1.0.0', 'style.css'),
    'tampered',
  );
  await assert.rejects(restore(backupPath, path.join(root, 'corrupt-restore')), /checksum/);
  await request('/api/v1/logout', {}, headers);
  assert.equal((await request('/api/v1/admin/overview', undefined, headers)).statusCode, 401);
});

test('configuration rejects cookie-sharing hostnames and production HTTP', () => {
  assert.throws(
    () =>
      getConfig({ platformOrigin: 'http://localhost:3000', gamesOrigin: 'http://localhost:3001' }),
    /hostnames/,
  );
  assert.throws(() => getConfig({ production: true }), /HTTPS/);
});
