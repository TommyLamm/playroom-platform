import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { githubSource } from '../server/github.js';

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
