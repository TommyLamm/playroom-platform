import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { AppError } from './errors.js';
import type { Release } from '../shared/types.js';
import type { GitHubOwner, DiscoveredRepository } from '../shared/sources.js';

export const repositoryName = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/)
  .refine((v) => !v.endsWith('/.') && !v.endsWith('/..'));
export const ownerName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/);
export function normalizeRepository(value: string) {
  let name = value.trim();
  if (/^https:\/\//i.test(name)) {
    let url: URL;
    try { url = new URL(name); } catch { throw new AppError(400, '請輸入有效的 GitHub repository URL'); }
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash)
      throw new AppError(400, '請輸入 GitHub repository URL 或 owner/repo');
    name = url.pathname.slice(1);
  }
  return repositoryName.parse(name.replace(/\/$/, '').replace(/\.git$/i, '')).toLowerCase();
}
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
export class GitHubRateLimitError extends AppError {
  constructor(public retryAt: number) {
    super(502, 'GitHub API 額度不足，已暫停檢查，稍後自動重試');
  }
}
export interface GitHubSource {
  owner(login: string): Promise<Pick<GitHubOwner, 'login' | 'kind'>>;
  discover(login: string, kind: GitHubOwner['kind'], page: number): Promise<{ repositories: Omit<DiscoveredRepository, 'added'>[]; hasMore: boolean }>;
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
  let retryAt = 0;
  const releaseCache = new Map<string, { etag: string; value: unknown }>();
  async function api(endpoint: string, conditional = false) {
    if (retryAt > Date.now()) throw new GitHubRateLimitError(retryAt);
    const cached = conditional ? releaseCache.get(endpoint) : undefined;
    let response: Response;
    try {
      response = await fetcher(`https://api.github.com${endpoint}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'MiniGamePlatform',
          ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
          ...(cached ? { 'If-None-Match': cached.etag } : {}),
        },
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
    } catch {
      throw new AppError(502, '無法連線到 GitHub，請稍後重試');
    }
    if (response.status === 429 || (response.status === 403 &&
        (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) {
      const retry = response.headers.get('retry-after');
      const retryAfter = retry ? (/^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry)) : 0;
      const reset = response.headers.get('x-ratelimit-remaining') === '0' ? Number(response.headers.get('x-ratelimit-reset')) * 1000 : 0;
      const waits = [retryAfter, reset].filter((time) => Number.isFinite(time) && time > Date.now());
      retryAt = Math.max(Date.now() + 1000, ...(waits.length ? waits : [Date.now() + 60000]));
      throw new GitHubRateLimitError(retryAt);
    }
    if (response.status === 304 && cached) return cached.value;
    if (response.status === 403)
      throw new AppError(502, 'GitHub API 存取受限，請檢查 GITHUB_TOKEN 權限');
    if (response.status === 404)
      throw new AppError(404, '找不到公開的 GitHub repository 或 Release');
    if (!response.ok) throw new AppError(502, `GitHub 回應錯誤（${response.status}）`);
    const value: unknown = await response.json();
    if (conditional) {
      const etag = response.headers.get('etag');
      if (etag) {
        // Bound memory for platforms managing many repositories.
        if (releaseCache.size >= 1000) releaseCache.delete(releaseCache.keys().next().value!);
        releaseCache.set(endpoint, { etag, value });
      } else releaseCache.delete(endpoint);
    }
    return value;
  }
  function publicRelease(raw: z.infer<typeof releaseSchema>): Release {
    const matches = raw.assets.filter((a) => a.name === 'game.zip');
    const asset = matches.length === 1 ? matches[0] : undefined;
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
    async owner(login) {
      const raw = z.object({ login: ownerName, type: z.enum(['User', 'Organization']) })
        .parse(await api(`/users/${ownerName.parse(login)}`));
      return { login: raw.login.toLowerCase(), kind: raw.type };
    },
    async discover(login, kind, page) {
      ownerName.parse(login);
      z.number().int().min(1).max(10000).parse(page);
      const endpoint = kind === 'Organization' ? `/orgs/${login}/repos?type=public` : `/users/${login}/repos?type=owner`;
      const raw = z.array(z.object({ full_name: repositoryName, description: z.string().nullable(),
        private: z.boolean(), archived: z.boolean(), fork: z.boolean() }))
        .parse(await api(`${endpoint}&sort=full_name&direction=asc&per_page=100&page=${page}`));
      return { repositories: raw.filter((r) => !r.private).map((r) => ({
        fullName: r.full_name.toLowerCase(), description: r.description, archived: r.archived, fork: r.fork,
      })), hasMore: raw.length === 100 };
    },
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
        .parse(await api(`/repos/${repositoryName.parse(fullName)}/releases?per_page=100`, true));
      return data.filter((r) => !r.draft).map(publicRelease);
    },
    async resolve(fullName, releaseId) {
      await this.checkRepository(fullName);
      const raw = releaseSchema.parse(
        await api(`/repos/${repositoryName.parse(fullName)}/releases/${releaseId}`),
      );
      const matches = raw.assets.filter((a) => a.name === 'game.zip');
      const asset = matches.length === 1 ? matches[0] : undefined;
      if (raw.draft || !asset) throw new AppError(400, 'Release 必須已發布並附有唯一的 game.zip');
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
