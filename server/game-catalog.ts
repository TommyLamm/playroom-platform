import { and, desc, eq } from 'drizzle-orm';
import { games, versions, type Store } from './db.js';
import type { Config } from './config.js';
import type { PublicGame } from '../shared/types.js';
import { manifestSchema, type GameManifest, type Leaderboard } from '../shared/manifest.js';
import { AppError } from './errors.js';

export function publicLibrary(store: Store, config: Config): PublicGame[] {
  return store.db
    .select({ game: games, version: versions })
    .from(games)
    .innerJoin(
      versions,
      and(eq(games.id, versions.gameId), eq(games.activeVersion, versions.version)),
    )
    .where(eq(games.published, true))
    .orderBy(desc(versions.publishedAt))
    .all()
    .map(({ game, version }) => ({
      ...version.manifest,
      coverUrl: `${config.gamesOrigin}/games/${game.id}/${version.version}/${version.manifest.cover}`,
      playUrl: `${config.gamesOrigin}/games/${game.id}/${version.version}/${version.manifest.entry}`,
      publishedAt: version.publishedAt!,
    }));
}

export function requirePublicGame(store: Store, id: string) {
  const game = store.db.select().from(games).where(and(eq(games.id, id), eq(games.published, true))).get();
  if (!game) throw new AppError(404, '這款遊戲尚未上架或已下架');
  return game;
}

export function readVersion(store: Store, id: string, version: string) {
  return store.db.select().from(versions).where(and(eq(versions.gameId, id), eq(versions.version, version))).get();
}

/** Includes historical published releases, and resolves the active release when omitted. */
export function publishedManifest(store: Store, id: string, version?: string): GameManifest {
  const row = store.sqlite.prepare(`SELECT v.manifest FROM versions v JOIN games g ON g.id=v.game_id
    WHERE v.game_id=? AND v.version=COALESCE(?,g.active_version) AND v.published_at IS NOT NULL`).get(id, version ?? null) as { manifest: string } | undefined;
  if (!row) throw new AppError(404, '找不到已發布的遊戲版本');
  return JSON.parse(row.manifest);
}

export function installedRelease(store: Store, repositoryId: number, releaseId: number) {
  const game = store.db.select().from(games).where(eq(games.repositoryId, repositoryId)).get();
  return game ? store.db.select().from(versions).where(and(eq(versions.gameId, game.id), eq(versions.releaseId, releaseId))).get() : undefined;
}

export function isListed(store: Store, id: string) {
  return !!store.db.select({ published: games.published }).from(games).where(eq(games.id, id)).get()?.published;
}

export function versionManifest(store: Store, id: string, version: string, published = false) {
  const row = readVersion(store, id, version);
  if (!row || (published && !row.publishedAt)) throw new AppError(404, '找不到已發布的遊戲版本');
  return manifestSchema.parse(row.manifest);
}

export function gameBoards(store: Store, id: string, published = true): Leaderboard[] {
  const rows = store.sqlite.prepare(`SELECT manifest FROM versions WHERE game_id=? ${published ? 'AND published_at IS NOT NULL' : ''} ORDER BY id DESC`).all(id) as { manifest: string }[];
  const found = new Map<string, Leaderboard>();
  for (const row of rows) {
    const board = manifestSchema.parse(JSON.parse(row.manifest)).leaderboard;
    if (board && !found.has(board.id)) found.set(board.id, board);
  }
  return [...found.values()];
}

/** Minimal metadata for audience events; drafts and hidden games are excluded. */
export function audienceGame(store: Store, id: string, version: string) {
  return store.sqlite.prepare(`SELECT json_extract(v.manifest,'$.name') AS name FROM games g
    JOIN versions v ON v.game_id=g.id WHERE g.id=? AND g.published=1 AND v.version=? AND v.published_at IS NOT NULL`)
    .get(id, version) as { name: string } | undefined;
}
