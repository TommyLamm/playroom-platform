import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { githubSource, normalizeRepository, GitHubRateLimitError } from '../server/github.js';

test('GitHub discovery uses public user/org pagination, canonical owners and unique release assets', async () => {
  const requests: string[] = [];
  const adapter = githubSource('server-only', (async (input, init) => {
    const url = String(input); requests.push(url);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer server-only');
    if (url.includes('/users/Alice') && !url.includes('/repos')) return Response.json({ login: 'Alice', type: 'User' });
    if (url.includes('/users/alice/repos') || url.includes('/orgs/team/repos')) return Response.json([{ full_name: 'alice/game', private: false, archived: false, fork: false, description: null }, { full_name: 'alice/private', private: true, archived: false, fork: false, description: null }]);
    return Response.json([{ id: 1, tag_name: 'v1.0.0', name: null, published_at: '2026-10-01', prerelease: false, draft: false, assets: [1, 2].map((id) => ({ id, name: 'game.zip', size: 1, browser_download_url: 'https://github.com/alice/game/releases/download/v1.0.0/game.zip' })) }]);
  }) as typeof fetch);
  assert.deepEqual(await adapter.owner('Alice'), { login: 'alice', kind: 'User' });
  assert.equal((await adapter.discover('alice', 'User', 2)).repositories.length, 1);
  assert.match(requests.at(-1)!, /page=2/); assert.match(requests.at(-1)!, /per_page=100/);
  await adapter.discover('team', 'Organization', 1); assert.match(requests.at(-1)!, /orgs\/team\/repos\?type=public/);
  assert.equal((await adapter.releases('alice/game'))[0].asset, null);
  assert.equal(normalizeRepository(' HTTPS://github.com/Alice/game.git/ '), 'alice/game');
});

test('GitHub adapter rejects rate limits and private sources', async () => {
  const limited = githubSource(
    '',
    (async () => new Response('{}', { status: 429 })) as typeof fetch,
  );
  await assert.rejects(limited.releases('example/game'), /額度/);
  const privateSource = githubSource('', (async () =>
    Response.json({ full_name: 'example/game', private: true })) as typeof fetch);
  await assert.rejects(privateSource.checkRepository('example/game'), /公開/);
});

test('GitHub rate limit errors carry retry-after/reset times and do not confuse ordinary forbidden responses', async () => {
  const before = Date.now();
  const retry = githubSource('', (async () => new Response('{}', { status: 429, headers: { 'retry-after': '10' } })) as typeof fetch);
  await assert.rejects(retry.releases('example/game'), (error: unknown) => error instanceof GitHubRateLimitError && error.retryAt >= before + 10000);
  const resetAt = Math.ceil(Date.now() / 1000) + 120;
  const reset = githubSource('', (async () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) } })) as typeof fetch);
  await assert.rejects(reset.releases('example/game'), (error: unknown) => error instanceof GitHubRateLimitError && error.retryAt === resetAt * 1000);
  const forbidden = githubSource('', (async () => new Response('{}', { status: 403 })) as typeof fetch);
  await assert.rejects(forbidden.releases('example/game'), (error: unknown) => error instanceof Error && !(error instanceof GitHubRateLimitError));
});

test('GitHub download checks redirects, limits, truncation and abort', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-download-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const asset = {
    id: 1,
    name: 'game.zip',
    size: 3,
    browser_download_url: 'https://github.com/example/game/releases/download/v1/game.zip',
  };
  const download = (
    source: ReturnType<typeof githubSource>,
    name: string,
    limit = 100,
    signal = new AbortController().signal,
  ) => source.download(asset, path.join(root, name), limit, signal);
  await t.test('never forwards authorization to asset hosts', async () => {
    let calls = 0;
    const source = githubSource('secret', (async (_url, options) => {
      assert.equal(new Headers(options?.headers).get('authorization'), null);
      return ++calls === 1
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://release-assets.githubusercontent.com/game.zip' },
          })
        : new Response('abc');
    }) as typeof fetch);
    await download(source, 'good');
    assert.equal(await fs.readFile(path.join(root, 'good'), 'utf8'), 'abc');
  });
  await t.test('blocks non-GitHub redirect', async () => {
    const source = githubSource(
      '',
      (async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/secrets' },
        })) as typeof fetch,
    );
    await assert.rejects(download(source, 'redirect'), /不允許/);
  });
  await t.test('checks actual bytes', async () => {
    const source = githubSource('', (async () => new Response('abcdef')) as typeof fetch);
    await assert.rejects(download(source, 'too-big', 4), /大小/);
  });
  await t.test('rejects truncated body', async () => {
    const source = githubSource('', (async () => new Response('ab')) as typeof fetch);
    await assert.rejects(download(source, 'short'), /不完整/);
  });
  await t.test('aborts interrupted download', async () => {
    const source = githubSource('', (async () => new Response('abc')) as typeof fetch);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(download(source, 'aborted', 100, controller.signal));
  });
});
