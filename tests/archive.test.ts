import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractArchive } from '../server/archive.js';
import { makeZip, testManifest } from './helpers.js';

const limits = {
  maxZipBytes: 64 * 1024 * 1024,
  maxExpandedBytes: 256 * 1024 * 1024,
  maxFiles: 10000,
};
test('ZIP validation rejects damaged, unsafe, oversized and incomplete packages', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-archive-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const zip = await makeZip(path.join(root, 'good.zip'));
  assert.equal((await extractArchive(zip, path.join(root, 'good'), limits)).id, 'test-game');
  await t.test('compressed size limit', async () => {
    await assert.rejects(
      extractArchive(zip, path.join(root, 'size'), { ...limits, maxZipBytes: 1 }),
      /壓縮大小/,
    );
  });
  await t.test('expanded size limit', async () => {
    await assert.rejects(
      extractArchive(zip, path.join(root, 'expanded'), { ...limits, maxExpandedBytes: 100 }),
      /解壓大小/,
    );
  });
  await t.test('file count limit', async () => {
    await assert.rejects(
      extractArchive(zip, path.join(root, 'count'), { ...limits, maxFiles: 1 }),
      /數量/,
    );
  });
  await t.test('corrupt archive', async () => {
    const bad = path.join(root, 'bad.zip');
    await fs.writeFile(bad, 'not zip');
    await assert.rejects(extractArchive(bad, path.join(root, 'bad'), limits), /ZIP/);
  });
  await t.test('missing entry', async () => {
    const bad = await makeZip(path.join(root, 'missing.zip'), testManifest, [], ['index.html']);
    await assert.rejects(extractArchive(bad, path.join(root, 'missing'), limits), /index.html/);
  });
  await t.test('symlink', async () => {
    const bad = await makeZip(path.join(root, 'link.zip'), testManifest, [
      { name: 'link', contents: '/etc/passwd', mode: 0o120777 },
    ]);
    await assert.rejects(extractArchive(bad, path.join(root, 'link'), limits), /符號連結/);
  });
  await t.test('duplicate names', async () => {
    const bad = await makeZip(path.join(root, 'dupe.zip'), testManifest, [
      { name: 'INDEX.html', contents: 'evil' },
    ]);
    await assert.rejects(extractArchive(bad, path.join(root, 'dupe'), limits), /重複/);
  });
  await t.test('parent traversal', async () => {
    const bad = await makeZip(path.join(root, 'traverse.zip'), testManifest, [
      { name: 'xx/escape.txt', contents: 'escape' },
    ]);
    const data = await fs.readFile(bad);
    const needle = Buffer.from('xx/escape.txt');
    let offset = data.indexOf(needle);
    while (offset !== -1) {
      data.write('../escape.txt', offset);
      offset = data.indexOf(needle, offset + needle.length);
    }
    await fs.writeFile(bad, data);
    await assert.rejects(extractArchive(bad, path.join(root, 'traverse'), limits));
    await assert.rejects(fs.stat(path.join(root, 'escape.txt')));
  });
});
