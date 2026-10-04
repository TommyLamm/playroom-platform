import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { AppError } from './errors.js';
import type { Release } from '../shared/types.js';

export const repositoryName = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/)
  .refine((v) => !v.endsWith('/.') && !v.endsWith('/..'));
const assetSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  size: z.number().nonnegative(),
  browser_download_url: z.string().url(),
  digest: z.string().nullable().optional(),
});
const releaseSchema = z.object({
  id: z.number().int().positive(),
  tag_name: z.string(),
  name: z.string().nullable(),
  published_at: z.string().nullable(),
  prerelease: z.boolean(),
  draft: z.boolean(),
  assets: z.array(assetSchema),
});
export type ReleaseAsset = z.infer<typeof assetSchema>;
export type ResolvedRelease = { release: Release; asset: ReleaseAsset };
export interface GitHubSource {
  checkRepository(fullName: string): Promise<string>;
  releases(fullName: string): Promise<Release[]>;
  resolve(fullName: string, releaseId: number): Promise<ResolvedRelease>;
  download(
    asset: ReleaseAsset,
    destination: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<void>;
}

export function githubSource(githubToken: string, fetcher: typeof fetch = fetch): GitHubSource {
  async function api(endpoint: string) {
    let response: Response;
    try {
      response = await fetcher(`https://api.github.com${endpoint}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'MiniGamePlatform',
          ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
        },
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
    } catch {
      throw new AppError(502, '無法連線到 GitHub，請稍後重試');
    }
    if (response.status === 403 || response.status === 429)
      throw new AppError(502, 'GitHub API 額度不足或存取受限，請稍後重試或設定 GITHUB_TOKEN');
    if (response.status === 404)
      throw new AppError(404, '找不到公開的 GitHub repository 或 Release');
    if (!response.ok) throw new AppError(502, `GitHub 回應錯誤（${response.status}）`);
    return response.json();
  }
  function publicRelease(raw: z.infer<typeof releaseSchema>): Release {
    const asset = raw.assets.find((a) => a.name === 'game.zip');
    return {
      id: raw.id,
      tag: raw.tag_name,
      name: raw.name || raw.tag_name,
      publishedAt: raw.published_at,
      prerelease: raw.prerelease,
      asset: asset ? { id: asset.id, name: asset.name, size: asset.size } : null,
    };
  }
  return {
    async checkRepository(fullName) {
      repositoryName.parse(fullName);
      const repo = z
        .object({ full_name: repositoryName, private: z.boolean() })
        .parse(await api(`/repos/${fullName}`));
      if (repo.private) throw new AppError(400, '第一版僅支援公開的 GitHub repository');
      return repo.full_name.toLowerCase();
    },
    async releases(fullName) {
      const data = z
        .array(releaseSchema)
        .parse(await api(`/repos/${repositoryName.parse(fullName)}/releases?per_page=100`));
      return data.filter((r) => !r.draft).map(publicRelease);
    },
    async resolve(fullName, releaseId) {
      await this.checkRepository(fullName);
      const raw = releaseSchema.parse(
        await api(`/repos/${repositoryName.parse(fullName)}/releases/${releaseId}`),
      );
      const asset = raw.assets.find((a) => a.name === 'game.zip');
      if (raw.draft || !asset) throw new AppError(400, 'Release 必須已發布並附有 game.zip');
      const url = new URL(asset.browser_download_url);
      if (
        url.origin !== 'https://github.com' ||
        !url.pathname.toLowerCase().startsWith(`/${fullName.toLowerCase()}/releases/download/`)
      )
        throw new AppError(400, '不接受此遊戲包下載來源');
      return { release: publicRelease(raw), asset };
    },
    async download(asset, destination, maxBytes, signal) {
      if (asset.size > maxBytes) throw new AppError(400, '遊戲包超過 64 MB 上限');
      let url = new URL(asset.browser_download_url);
      let response: Response | undefined;
      for (let redirects = 0; redirects < 5; redirects++) {
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          url.port ||
          ![
            'github.com',
            'release-assets.githubusercontent.com',
            'objects.githubusercontent.com',
          ].includes(url.hostname)
        )
          throw new AppError(400, '下載被重新導向至不允許的來源');
        response = await fetcher(url, {
          redirect: 'manual',
          signal,
          headers: { 'User-Agent': 'MiniGamePlatform' },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const next = response.headers.get('location');
          await response.body?.cancel();
          if (!next) throw new AppError(502, 'GitHub 下載重新導向失敗');
          url = new URL(next, url);
          continue;
        }
        break;
      }
      if (!response?.ok || !response.body) throw new AppError(502, '無法下載 GitHub 遊戲包');
      if (Number(response.headers.get('content-length') || 0) > maxBytes) {
        await response.body.cancel();
        throw new AppError(400, '遊戲包超過下載大小限制');
      }
      let bytes = 0;
      await pipeline(
        Readable.fromWeb(response.body as never),
        new Transform({
          transform(chunk, _enc, callback) {
            bytes += chunk.length;
            callback(bytes > maxBytes ? new AppError(400, '遊戲包超過下載大小限制') : null, chunk);
          },
        }),
        fs.createWriteStream(destination, { flags: 'wx' }),
        { signal },
      );
      if (bytes !== asset.size) throw new AppError(400, '下載不完整，檔案大小與 GitHub 記錄不符');
    },
  };
}
