import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// The isolated updater deliberately has no runtime dependencies on the platform.
// @ts-expect-error The control plane is native JavaScript for its minimal Docker image.
import { UpdateEngine, settings } from '../updater/engine.mjs';
import { getConfig } from '../server/config.js';
import { createApplication } from '../server/app.js';
import { openStore, users } from '../server/db.js';
import { passwordHash } from '../server/auth.js';
import http from 'node:http';

const before = 'a'.repeat(40);
const next = 'b'.repeat(40);
test('OTA configuration rejects arbitrary remotes, shell input and weak tokens', () => {
  const env = {
    UPDATE_REPOSITORY: 'https://github.com/example/platform.git',
    DEPLOY_DIR: '/opt/playroom',
    UPDATER_TOKEN: 'x'.repeat(64),
  };
  assert.equal(settings(env).branch, 'main');
  for (const override of [
    { UPDATE_REPOSITORY: 'https://secret@github.com/example/platform.git' },
    { UPDATE_REPOSITORY: 'file:///etc' },
    { UPDATE_BRANCH: '--upload-pack=evil' },
    { UPDATE_BRANCH: '../main' },
    { DEPLOY_DIR: '/opt/a;evil' },
    { UPDATER_TOKEN: 'short' },
  ])
    assert.throws(() => settings({ ...env, ...override }));
});

for (const failure of ['none', 'build', 'backup', 'deploy', 'rollback'])
  test(`OTA lifecycle: ${failure}`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-ota-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const calls: string[][] = [];
    let deployed = false;
    let failed = false;
    const config = settings({
      UPDATE_REPOSITORY: 'https://github.com/example/platform.git',
      DEPLOY_DIR: '/opt/playroom',
      UPDATER_TOKEN: 'x'.repeat(64),
      UPDATE_STATE_DIR: root,
    });
    const run = async (binary: string, args: string[]) => {
      calls.push([binary, ...args]);
      if (binary === 'git') {
        if (args.includes('rev-parse')) return next;
        if (args.includes('show')) return '2026-10-04T00:00:00Z\nAdd a new feature';
        return '';
      }
      if (args[0] === 'inspect')
        return JSON.stringify([
          {
            Image: 'sha256:old',
            Config: { Labels: { 'org.opencontainers.image.revision': deployed ? next : before } },
            Mounts: [
              { Destination: '/data', Type: 'volume', Name: 'original' },
              { Destination: '/backups', Type: 'bind', Source: '/opt/playroom/backups' },
            ],
          },
        ]);
      if (args.includes('ps')) return 'c'.repeat(64);
      if (failure === 'build' && args[0] === 'build') throw new Error('compile failed');
      if (failure === 'backup' && args.includes('backup')) throw new Error('disk full');
      if (args.includes('up')) {
        const active = JSON.parse(await fs.readFile(path.join(root, 'active.json'), 'utf8'));
        deployed = active.services.app.image === `playroom-app:${next}`;
        if (['deploy', 'rollback'].includes(failure) && deployed && !failed) {
          failed = true;
          throw new Error('unhealthy');
        }
        if (failure === 'rollback' && !deployed) throw new Error('rollback unhealthy');
      }
      return '';
    };
    const engine = new UpdateEngine(config, run);
    await engine.init();
    await engine.check();
    await assert.rejects(engine.start('d'.repeat(40)), /重新檢查/);
    await engine.start(next);
    await assert.rejects(engine.start(next), /正在執行/);
    await engine.task;
    const status = await engine.status();
    const job = status.jobs[0];
    assert.equal(job.status, failure === 'none' ? 'completed' : 'failed');
    assert.equal(
      job.phase,
      {
        none: 'completed',
        build: 'failed',
        backup: 'rolled-back',
        deploy: 'rolled-back',
        rollback: 'recovery-failed',
      }[failure],
    );
    assert.equal(job.recovery, undefined, 'do not leak Docker mount configuration through API');
    if (failure === 'build')
      assert.ok(
        !calls.some((call) => call.includes('stop')),
        'build failure must not interrupt existing app',
      );
    if (failure === 'deploy' || failure === 'rollback') {
      assert.ok(calls.some((call) => call.includes('restore')));
      const restore = calls.find((call) => call.includes('restore'))!;
      assert.ok(restore.includes('none'), 'restore should have no network');
      assert.ok(!restore.includes('original:/data'), 'never erase or restore over original volume');
    }
    if (failure === 'rollback') await assert.rejects(engine.start(next), /人工回復/);
  });

test('interrupted deployment restores backup after updater restart', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-ota-crash-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const recovery = {
    image: 'sha256:old',
    active: { services: { app: { image: 'old' } } },
    backupReady: true,
    backups: { Type: 'bind', Source: '/opt/playroom/backups' },
  };
  await fs.writeFile(
    path.join(root, 'status.json'),
    JSON.stringify({
      jobs: [
        {
          id: 'test',
          commit: next,
          status: 'running',
          phase: 'deploying',
          backup: 'ota-test',
          recovery,
        },
      ],
    }),
  );
  const calls: string[][] = [];
  const engine = new UpdateEngine(
    { stateDir: root, project: 'playroom', deployDir: '/opt/playroom' },
    async (_: string, args: string[]) => {
      calls.push(args);
      return '';
    },
  );
  await engine.init();
  assert.ok(calls.some((call) => call.includes('restore')));
  assert.equal(engine.state.jobs[0].status, 'failed');
  assert.equal(engine.state.jobs[0].phase, 'rolled-back');
  assert.equal(engine.state.jobs[0].recovery, undefined);
});

test('OTA APIs require admin and CSRF; proxy forwards no user-supplied URL', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-ota-api-'));
  const received: { path: string; token?: string; body: string }[] = [];
  const control = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    received.push({ path: request.url!, token: request.headers.authorization, body });
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify(
        request.url === '/update'
          ? { jobId: 'job' }
          : { enabled: true, current: before, latest: { commit: next } },
      ),
    );
  });
  await new Promise<void>((resolve) => control.listen(0, '127.0.0.1', resolve));
  const port = (control.address() as import('node:net').AddressInfo).port;
  const config = getConfig({
    dataDir: root,
    production: false,
    updaterUrl: `http://127.0.0.1:${port}`,
    updaterToken: 'server-only-secret',
  });
  const store = openStore(root);
  store.db
    .insert(users)
    .values({
      username: 'admin',
      role: 'admin',
      password: await passwordHash('administrator-password'),
    })
    .run();
  const app = await createApplication(config, store);
  t.after(async () => {
    await app.close();
    store.sqlite.close();
    await new Promise<void>((resolve) => control.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });
  const request = (url: string, body?: object, extra = {}) =>
    app.platform.inject({
      method: body ? 'POST' : 'GET',
      url,
      payload: body,
      headers: {
        host: new URL(config.platformOrigin).host,
        origin: config.platformOrigin,
        ...extra,
      },
    });
  assert.equal((await request('/api/v1/admin/updates')).statusCode, 401);
  const player = await request('/api/v1/register', {
    username: 'player',
    password: 'player-password',
  });
  const playerHeaders = {
    cookie: String(player.headers['set-cookie']).split(';')[0],
    'x-csrf-token': player.json().csrf,
  };
  for (const [url, body] of [
    ['/api/v1/admin/updates', undefined],
    ['/api/v1/admin/updates/check', {}],
    ['/api/v1/admin/updates', { commit: next }],
  ] as const)
    assert.equal((await request(url, body, playerHeaders)).statusCode, 403);
  const login = await request('/api/v1/login', {
    username: 'admin',
    password: 'administrator-password',
  });
  const headers = {
    cookie: String(login.headers['set-cookie']).split(';')[0],
    'x-csrf-token': login.json().csrf,
  };
  assert.equal(
    (await request('/api/v1/admin/updates/check', {}, { ...headers, 'x-csrf-token': 'wrong' }))
      .statusCode,
    403,
  );
  assert.equal(
    (await request('/api/v1/admin/updates', { commit: next, repository: 'evil' }, headers))
      .statusCode,
    400,
  );
  assert.equal(
    (await request('/api/v1/admin/updates', { commit: ';evil' }, headers)).statusCode,
    400,
  );
  assert.equal((await request('/api/v1/admin/updates', { commit: next }, headers)).statusCode, 202);
  assert.equal((await request('/api/v1/admin/updates/check', {}, headers)).statusCode, 200);
  assert.equal((await request('/api/v1/admin/updates', undefined, headers)).json().enabled, true);
  assert.deepEqual(
    received.map((r) => r.path),
    ['/update', '/check', '/status'],
  );
  assert.ok(received.every((r) => r.token === 'Bearer server-only-secret'));
});
