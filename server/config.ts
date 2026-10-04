import path from 'node:path';
import { z } from 'zod';

function origin(value: string) {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== value ||
    url.username ||
    url.password
  )
    throw new Error('Origins must be http(s)://host[:port] without a trailing slash');
  return url;
}

export function getConfig(overrides: Partial<Config> = {}): Config {
  const production = process.env.NODE_ENV === 'production';
  const config = {
    dataDir: path.resolve(process.env.DATA_DIR || 'data'),
    platformOrigin:
      process.env.PLATFORM_ORIGIN ||
      (process.env.NODE_ENV === 'development' ? 'http://localhost:5173' : 'http://localhost:3000'),
    gamesOrigin: process.env.GAMES_ORIGIN || 'http://127.0.0.1:3001',
    platformPort: Number(process.env.PORT || 3000),
    gamesPort: Number(process.env.GAMES_PORT || 3001),
    host: process.env.BIND_HOST || '127.0.0.1',
    githubToken: process.env.GITHUB_TOKEN || '',
    updaterUrl: process.env.UPDATER_URL || '',
    updaterToken: process.env.UPDATER_TOKEN || '',
    commit: process.env.APP_COMMIT || 'development',
    maxZipBytes: 64 * 1024 * 1024,
    maxExpandedBytes: 256 * 1024 * 1024,
    maxFiles: 10000,
    production,
    clientDir: path.resolve('dist/client'),
    ...overrides,
  };
  const platform = origin(config.platformOrigin);
  const games = origin(config.gamesOrigin);
  if (platform.hostname === games.hostname)
    throw new Error('Platform and game hostnames must differ: cookies are not isolated by port');
  if (config.production && (platform.protocol !== 'https:' || games.protocol !== 'https:'))
    throw new Error('Production requires HTTPS for both origins');
  z.number().int().min(1).max(65535).parse(config.platformPort);
  z.number().int().min(1).max(65535).parse(config.gamesPort);
  return config;
}

export type Config = {
  dataDir: string;
  platformOrigin: string;
  gamesOrigin: string;
  platformPort: number;
  gamesPort: number;
  host: string;
  githubToken: string;
  updaterUrl: string;
  updaterToken: string;
  commit: string;
  maxZipBytes: number;
  maxExpandedBytes: number;
  maxFiles: number;
  production: boolean;
  clientDir: string;
};
