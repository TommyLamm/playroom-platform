import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import type { GameManifest } from '../shared/manifest.js';
import type { GitHubSource } from '../server/github.js';
import type { Release } from '../shared/types.js';

export const testManifest: GameManifest = {
  schemaVersion: 1,
  id: 'test-game',
  name: '測試遊戲',
  version: '1.0.0',
  description: 'A small test game',
  author: 'Test team',
  entry: 'index.html',
  cover: 'cover.png',
  tags: ['反應'],
  instructions: 'Tap the light.',
  devices: ['desktop', 'mobile'],
};
export async function makeZip(
  filename: string,
  manifest = testManifest,
  extras: { name: string; contents: string; mode?: number }[] = [],
  omit: string[] = [],
) {
  const zip = new yazl.ZipFile();
  const sample = path.resolve('examples/starter');
  const files: [string, Buffer][] = [
    ['game.json', Buffer.from(JSON.stringify(manifest))],
    ...(await Promise.all(
      ['index.html', 'style.css', 'game.js', 'playroom-sdk.js', 'config.json', 'cover.png'].map(
        async (name) => [name, await fs.readFile(path.join(sample, name))] as [string, Buffer],
      ),
    )),
  ];
  for (const [name, data] of files) if (!omit.includes(name)) zip.addBuffer(data, name);
  for (const entry of extras)
    zip.addBuffer(Buffer.from(entry.contents), entry.name, { mode: entry.mode });
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(filename));
  return filename;
}

export async function fakeGitHub(root: string, id = 'test-game'): Promise<GitHubSource> {
  const first = await makeZip(path.join(root, 'v1.zip'), { ...testManifest, id, name: '測試光點' });
  const second = await makeZip(path.join(root, 'v2.zip'), {
    ...testManifest,
    id,
    name: '測試光點',
    version: '2.0.0',
  });
  const files = new Map([
    [101, first],
    [102, second],
  ]);
  const releases: Release[] = [];
  for (const [releaseId, file] of files)
    releases.push({
      id: releaseId,
      tag: releaseId === 101 ? 'v1.0.0' : 'v2.0.0',
      name: releaseId === 101 ? 'Version 1' : 'Version 2',
      publishedAt: new Date().toISOString(),
      prerelease: false,
      asset: { id: releaseId + 1000, name: 'game.zip', size: (await fs.stat(file)).size },
    });
  return {
    async owner(login) { return { login: login.toLowerCase(), kind: 'User' }; },
    async discover(login, _kind, _page) {
      return { repositories: [{ fullName: `${login}/game`, description: 'Test game', archived: false, fork: false }], hasMore: false };
    },
    async checkRepository(name) {
      return name.toLowerCase();
    },
    async releases() {
      return releases;
    },
    async resolve(_fullName, releaseId) {
      const release = releases.find((r) => r.id === releaseId);
      if (!release) throw new Error('Missing fixture release');
      return {
        release,
        asset: {
          ...release.asset!,
          browser_download_url: `https://github.com/example/game/releases/download/${release.tag}/game.zip`,
        },
      };
    },
    async download(asset, destination, _limit, signal) {
      signal.throwIfAborted();
      await fs.copyFile(files.get(asset.id - 1000)!, destination);
    },
  };
}
