import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openStore, users, repositories, jobs } from '../server/db.js';
import { getConfig } from '../server/config.js';
import { createApplication } from '../server/app.js';
import { passwordHash } from '../server/auth.js';
import { backup, restore } from '../server/maintenance.js';
import { makeZip, testManifest } from './helpers.js';
import { AppError } from '../server/errors.js';
import {
  defaultRelease,
  eligibleRelease,
  type Source,
  type ImportBatch,
} from '../shared/sources.js';
import type { GitHubSource } from '../server/github.js';
import type { Release } from '../shared/types.js';

const release = (id = 101, extra: Partial<Release> = {}): Release => ({
  id,
  tag: 'v1.0.0',
  name: 'Version 1',
  publishedAt: '2026-10-01T12:00:00Z',
  prerelease: false,
  asset: { id: id + 1000, name: 'game.zip', size: 100 },
  ...extra,
});
test('default version picks latest valid stable release and never suggests older releases after latest is imported', () => {
  const list = [
    release(1),
    release(2, { publishedAt: '2026-10-02T12:00:00Z' }),
    release(3, { prerelease: true, publishedAt: '2026-10-03T12:00:00Z' }),
    release(4, { tag: 'bad' }),
    release(5, { asset: null }),
  ];
  assert.equal(defaultRelease(list)?.id, 2);
  assert.equal(defaultRelease(list, [2]), undefined);
  assert.equal(eligibleRelease(list[3]), false);
  assert.equal(eligibleRelease(list[4]), false);
  assert.equal(defaultRelease([release(3, { prerelease: true })]), undefined);
});

test('sources lifecycle: multiple owners, release checks, archive, 60 imports, retries and persistent batches', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-sources-'));
  const config = getConfig({
    dataDir: path.join(root, 'data'),
    clientDir: path.join(root, 'none'),
    production: false,
  });
  const store = openStore(config.dataDir);
  const password = await passwordHash('source-test-password');
  store.db
    .insert(users)
    .values([
      { username: 'admin', role: 'admin', password },
      { username: 'player', role: 'player', password },
    ])
    .run();
  let checkFails = false;
  let badGame = true;
  const files = new Map<number, string>();
  let assetId = 2000;
  const github: GitHubSource = {
    async owner(login) {
      return { login: login.toLowerCase(), kind: login === 'team' ? 'Organization' : 'User' };
    },
    async discover(login, _kind, page) {
      return {
        repositories: Array.from({ length: page === 1 ? 100 : 2 }, (_, i) => ({
          fullName: `${login}/game-${(page - 1) * 100 + i}`,
          description: 'small game',
          archived: false,
          fork: false,
        })),
        hasMore: page === 1,
      };
    },
    async checkRepository(name) {
      if (name.includes('missing')) throw new AppError(404, '找不到公開來源');
      return name.toLowerCase();
    },
    async releases() {
      if (checkFails) throw new AppError(502, 'GitHub API 額度不足');
      return [release(), release(102, { prerelease: true, tag: 'v2.0.0-beta' })];
    },
    async resolve(fullName, releaseId) {
      if (releaseId !== 101 && releaseId !== 102) throw new AppError(404, '找不到 Release');
      const id = ++assetId;
      const file = await makeZip(path.join(root, `${id}.zip`), {
        ...testManifest,
        id: fullName.replace('/', '-'),
        version: releaseId === 102 ? '2.0.0-beta' : '1.0.0',
      });
      files.set(id, file);
      return {
        release: release(releaseId, {
          tag:
            fullName === 'alice/game-47' && badGame
              ? 'v9.0.0'
              : releaseId === 102
                ? 'v2.0.0-beta'
                : 'v1.0.0',
          prerelease: releaseId === 102,
        }),
        asset: {
          id,
          name: 'game.zip',
          size: (await fs.stat(file)).size,
          browser_download_url: `https://github.com/${fullName}/releases/download/v1.0.0/game.zip`,
        },
      };
    },
    async download(asset, destination) {
      await fs.copyFile(files.get(asset.id)!, destination);
    },
  };
  let app = await createApplication(config, store, { github });
  t.after(async () => {
    await app.close();
    store.sqlite.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const publicHeaders = {
    host: new URL(config.platformOrigin).host,
    origin: config.platformOrigin,
  };
  const req = (url: string, body?: unknown, headers: Record<string, string> = publicHeaders) =>
    app.platform.inject({
      method: body === undefined ? 'GET' : 'POST',
      url: `/api/v1${url}`,
      headers,
      payload: body as object,
    });
  const login = async (username: string) => {
    const result = await req('/login', { username, password: 'source-test-password' });
    return {
      ...publicHeaders,
      cookie: String(result.headers['set-cookie']).split(';')[0],
      'x-csrf-token': result.json().csrf,
    };
  };
  let headers = await login('admin');
  const player = await login('player');
  const routes: [string, unknown?][] = [
    ['/admin/github-owners'],
    ['/admin/github-owners', { login: 'alice' }],
    ['/admin/github-owners/alice/remove', {}],
    ['/admin/github-owners/alice/repositories'],
    ['/admin/sources'],
    ['/admin/repositories/1/state', { archived: true }],
    ['/admin/repositories/1/check', {}],
    ['/admin/import-batches'],
    [
      '/admin/import-batches',
      { requestId: randomUUID(), items: [{ repositoryId: 1, releaseId: 101 }] },
    ],
    [`/admin/import-batches/${randomUUID()}`],
  ];
  await t.test('every new endpoint checks role and mutation CSRF', async () => {
    for (const [url, body] of routes) {
      assert.equal((await req(url, body)).statusCode, 401, url);
      assert.equal((await req(url, body, player)).statusCode, 403, url);
      if (body)
        assert.equal(
          (await req(url, body, { ...headers, 'x-csrf-token': 'bad' })).statusCode,
          403,
          url,
        );
    }
  });
  await t.test(
    'saved users and organizations are canonical, discovery paginates and marks known sources',
    async () => {
      for (const login of ['Alice', 'bob', 'team', 'alice'])
        assert.equal((await req('/admin/github-owners', { login }, headers)).statusCode, 200);
      assert.equal((await req('/admin/github-owners', undefined, headers)).json().owners.length, 3);
      assert.equal(
        (await req('/admin/github-owners/team/repositories', undefined, headers)).json()
          .repositories.length,
        100,
      );
      assert.equal(
        (await req('/admin/github-owners/alice/repositories?page=2', undefined, headers)).json()
          .repositories.length,
        2,
      );
      assert.equal(
        (await req('/admin/github-owners/alice/repositories?page=0', undefined, headers))
          .statusCode,
        400,
      );
      assert.equal(
        (await req('/admin/github-owners/missing/repositories', undefined, headers)).statusCode,
        404,
      );
      const added = (
        await req(
          '/admin/repositories',
          { fullName: 'https://github.com/Alice/game-0.git/' },
          headers,
        )
      ).json().repository;
      assert.equal(added.fullName, 'alice/game-0');
      assert.equal(
        (await req('/admin/repositories', { fullName: 'ALICE/game-0' }, headers)).json().repository
          .id,
        added.id,
      );
      assert.equal(
        (await req('/admin/github-owners/alice/repositories', undefined, headers)).json()
          .repositories[0].added,
        true,
      );
      for (const fullName of [
        'not-a-repo',
        'https://example.com/alice/game',
        'https://github.com/alice/game?x=1',
        'alice/..',
        'alice/missing',
      ])
        assert.ok((await req('/admin/repositories', { fullName }, headers)).statusCode >= 400);
      await req('/admin/github-owners/bob/remove', {}, headers);
      assert.equal((await req('/admin/github-owners', undefined, headers)).json().owners.length, 2);
    },
  );
  const sourceList = async () =>
    (await req('/admin/sources', undefined, headers)).json().sources as Source[];
  await t.test(
    'checks are persisted, errors retain good results, archive never removes game data',
    async () => {
      const id = (await sourceList())[0].id;
      assert.equal((await sourceList())[0].status, 'unchecked');
      const checked = (await req(`/admin/repositories/${id}/check`, {}, headers)).json()
        .source as Source;
      assert.equal(checked.status, 'available');
      assert.ok(checked.checkedAt);
      assert.equal(checked.releases.length, 2);
      checkFails = true;
      const failed = (await req(`/admin/repositories/${id}/check`, {}, headers)).json()
        .source as Source;
      assert.equal(failed.status, 'error');
      assert.match(failed.checkError!, /額度/);
      assert.deepEqual(failed.releases, checked.releases);
      checkFails = false;
      await req(`/admin/repositories/${id}/state`, { archived: true }, headers);
      assert.equal((await req(`/admin/repositories/${id}/check`, {}, headers)).statusCode, 409);
      assert.equal(
        (await req('/admin/imports', { repositoryId: id, releaseId: 101 }, headers)).statusCode,
        409,
      );
      await req(`/admin/repositories/${id}/state`, { archived: false }, headers);
      await req(`/admin/repositories/${id}/check`, {}, headers);
    },
  );
  let firstBatch: ImportBatch;
  await t.test(
    'failed batch association transaction rolls back tasks without starting orphan imports',
    async () => {
      const id = (await sourceList())[0].id;
      const beforeAsset = assetId;
      store.sqlite.exec(
        "CREATE TEMP TRIGGER fail_batch_item BEFORE INSERT ON import_batch_items BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;",
      );
      try {
        const result = await req(
          '/admin/import-batches',
          { requestId: randomUUID(), items: [{ repositoryId: id, releaseId: 101 }] },
          headers,
        );
        assert.equal(result.statusCode, 500);
        await app.queue.idle();
        assert.equal(assetId, beforeAsset);
        assert.equal(store.db.select().from(jobs).all().length, 0);
        assert.equal(
          (await req('/admin/import-batches', undefined, headers)).json().batches.length,
          0,
        );
      } finally {
        store.sqlite.exec('DROP TRIGGER fail_batch_item;');
      }
    },
  );
  await t.test(
    '50 games run serially with isolated failure, stable idempotency and no publication',
    async () => {
      for (let i = 1; i < 60; i++)
        await req('/admin/repositories', { fullName: `alice/game-${i}` }, headers);
      const items = (await sourceList())
        .slice(0, 50)
        .map((r) => ({ repositoryId: r.id, releaseId: 101 }));
      const requestId = randomUUID();
      const input = { requestId, items: [...items, items[0]] };
      firstBatch = (await req('/admin/import-batches', input, headers)).json().batch;
      assert.equal(firstBatch.items.length, 50);
      assert.equal(
        (await req('/admin/import-batches', input, headers)).json().batch.id,
        firstBatch.id,
      );
      assert.equal(
        (await req('/admin/import-batches', { requestId, items: [items[0]] }, headers)).statusCode,
        409,
      );
      await app.queue.idle();
      firstBatch = (await req(`/admin/import-batches/${firstBatch.id}`, undefined, headers)).json()
        .batch;
      assert.equal(firstBatch.items.filter((i) => i.status === 'completed').length, 49);
      assert.equal(firstBatch.items.filter((i) => i.status === 'failed').length, 1);
      assert.match(firstBatch.items.find((i) => i.status === 'failed')!.error!, /tag/);
      assert.equal((await req('/games')).json().games.length, 0);
      const summary = (await req('/admin/import-batches', undefined, headers)).json().batches[0];
      assert.equal(summary.total, 50);
      assert.equal(summary.completed, 49);
      assert.equal(summary.failed, 1);
      assert.equal(
        (
          await req(
            '/admin/import-batches',
            { requestId: randomUUID(), items: Array.from({ length: 101 }, () => items[0]) },
            headers,
          )
        ).statusCode,
        400,
      );
    },
  );
  await t.test(
    'retry skips installed releases, batch progress contains more than overview 50 records',
    async () => {
      badGame = false;
      const items = (await sourceList()).map((r) => ({ repositoryId: r.id, releaseId: 101 }));
      const response = await req(
        '/admin/import-batches',
        { requestId: randomUUID(), items },
        headers,
      );
      const id = response.json().batch.id;
      await app.queue.idle();
      const batch = (await req(`/admin/import-batches/${id}`, undefined, headers)).json()
        .batch as ImportBatch;
      assert.equal(batch.items.length, 60);
      assert.equal(batch.items.filter((i) => i.status === 'skipped').length, 49);
      assert.equal(batch.items.filter((i) => i.status === 'completed').length, 11);
      assert.equal((await req('/admin/overview', undefined, headers)).json().jobs.length, 50);
      const repo = (await sourceList())[0];
      await req(`/admin/repositories/${repo.id}/check`, {}, headers);
      assert.equal((await sourceList()).find((r) => r.id === repo.id)!.status, 'current');
      await req(`/admin/repositories/${repo.id}/state`, { archived: true }, headers);
      assert.equal((await req('/admin/overview', undefined, headers)).json().games.length, 60);
      await req(`/admin/repositories/${repo.id}/state`, { archived: false }, headers);
    },
  );
  await t.test('pending jobs are reused and capacity errors are per item', async () => {
    const repos = await sourceList();
    const now = new Date().toISOString();
    const sharedJob = randomUUID();
    store.db
      .insert(jobs)
      .values({
        id: sharedJob,
        repositoryId: repos[0].id,
        releaseId: 900,
        status: 'queued',
        phase: 'queued',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    for (let i = 0; i < 99; i++)
      store.db
        .insert(jobs)
        .values({
          id: randomUUID(),
          repositoryId: repos[1].id,
          releaseId: 1000 + i,
          status: 'queued',
          phase: 'queued',
          createdAt: now,
          updatedAt: now,
        })
        .run();
    const result = await req(
      '/admin/import-batches',
      {
        requestId: randomUUID(),
        items: [
          { repositoryId: repos[0].id, releaseId: 900 },
          { repositoryId: repos[2].id, releaseId: 102 },
        ],
      },
      headers,
    );
    const batch = result.json().batch as ImportBatch;
    assert.equal(batch.items[0].jobId, sharedJob);
    assert.equal(batch.items[1].status, 'failed');
    assert.match(batch.items[1].error!, /100/);
    assert.equal(
      (await req(`/admin/repositories/${repos[0].id}/state`, { archived: true }, headers))
        .statusCode,
      409,
    );
    await app.close();
    app = await createApplication(config, store, { github });
    headers = await login('admin');
    const interrupted = (await req(`/admin/import-batches/${batch.id}`, undefined, headers)).json()
      .batch as ImportBatch;
    assert.equal(interrupted.items[0].status, 'failed');
    assert.equal(interrupted.items[0].phase, 'interrupted');
    const retried = await req(
      '/admin/import-batches',
      { requestId: randomUUID(), items: [{ repositoryId: repos[2].id, releaseId: 102 }] },
      headers,
    );
    await app.queue.idle();
    assert.equal(
      (await req(`/admin/import-batches/${retried.json().batch.id}`, undefined, headers)).json()
        .batch.items[0].status,
      'completed',
    );
  });
  await t.test(
    'backup restores owners, checked sources, batches and all task associations',
    async () => {
      await backup(config.dataDir, path.join(root, 'backup'));
      await restore(path.join(root, 'backup'), path.join(root, 'restored'));
      const restored = openStore(path.join(root, 'restored'));
      try {
        assert.equal(restored.sqlite.pragma('user_version', { simple: true }), 7);
        for (const table of [
          'github_owners',
          'repositories',
          'import_batches',
          'import_batch_items',
          'import_jobs',
        ])
          assert.deepEqual(
            restored.sqlite.prepare(`SELECT * FROM ${table}`).all(),
            store.sqlite.prepare(`SELECT * FROM ${table}`).all(),
          );
        assert.deepEqual(restored.sqlite.pragma('foreign_key_check'), []);
      } finally {
        restored.sqlite.close();
      }
    },
  );
});

test('schema6 migration preserves repositories and visitors and can reopen schema7', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-source-migration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const old = openStore(root);
  old.db.insert(repositories).values({ fullName: 'alice/game', createdAt: '2026-10-01' }).run();
  old.sqlite.exec(
    "INSERT INTO visitor_events(visitor_id,request_id,occurred_at,kind,path,ip,user_agent) VALUES ('visitor','request',1,'page_view','/','127.0.0.1',''); DROP TABLE import_batch_items; DROP TABLE import_batches; DROP TABLE github_owners; ALTER TABLE repositories DROP COLUMN archived; ALTER TABLE repositories DROP COLUMN checked_at; ALTER TABLE repositories DROP COLUMN check_error; ALTER TABLE repositories DROP COLUMN cached_releases; PRAGMA user_version=6;",
  );
  old.sqlite.close();
  const migrated = openStore(root);
  assert.equal(migrated.sqlite.pragma('user_version', { simple: true }), 7);
  const repo = migrated.db.select().from(repositories).get()!;
  assert.equal(repo.fullName, 'alice/game');
  assert.equal(repo.archived, false);
  assert.deepEqual(repo.cachedReleases, []);
  assert.equal(
    (migrated.sqlite.prepare('SELECT count(*) AS n FROM visitor_events').get() as { n: number }).n,
    1,
  );
  migrated.sqlite.close();
  const reopened = openStore(root);
  assert.equal(reopened.db.select().from(repositories).get()!.id, repo.id);
  reopened.sqlite.close();
});
