import { z } from 'zod';
import type { Store } from './db.js';
import { AppError } from './errors.js';
import { compareVersions, updateRelease } from '../shared/game-updates.js';
import { defaultRelease, type Source } from '../shared/sources.js';
import type { Page, VersionSummary, AdminGameSummary, UpdateSummary, AdminTasks, AdminSummary } from '../shared/admin-data.js';
import type { StoredVersion, Release } from '../shared/types.js';
import { gameId, gameVersion } from '../shared/manifest.js';
import { saveCompatibility } from './save-compatibility.js';

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  size: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().max(240).default(''),
  status: z.string().max(30).default('all'),
  sort: z.enum(['name', 'recent', 'version']).default('name'),
  scope: z.enum(['active', 'archived', 'all']).default('active'),
  owner: z.string().max(100).default(''),
});
type Query = z.infer<typeof pageSchema>;
type SqlValue = string | number | null;
const configured = new WeakSet<object>();
function functions(store: Store) {
  if (configured.has(store.sqlite)) return;
  store.sqlite.function('playroom_compare_versions', { deterministic: true }, (a: string, b: string) => compareVersions(a, b));
  store.sqlite.function('playroom_release', { deterministic: true }, (releases: string, imported: string, active: string | null) => {
    const latest = defaultRelease(JSON.parse(releases) as Release[], JSON.parse(imported) as number[]);
    return latest && (!active || compareVersions(latest.tag.slice(1), active) > 0) ? JSON.stringify(latest) : null;
  });
  store.sqlite.function('playroom_source_status', { deterministic: true }, (releases: string, imported: string, checked: string | null, error: string | null, pending: number) => {
    if (pending) return 'importing';
    if (error) return 'error';
    if (!checked) return 'unchecked';
    const list = JSON.parse(releases) as Release[], ids = JSON.parse(imported) as number[];
    return defaultRelease(list, ids) ? 'available' : list.some((r) => ids.includes(r.id)) ? 'current' : 'unavailable';
  });
  configured.add(store.sqlite);
}
const gameCTE = `WITH game_rows AS (
  SELECT g.id, g.repository_id AS repositoryId, r.full_name AS repositoryName,
    g.active_version AS activeVersion, g.published,
    COALESCE(json_extract(v.manifest, '$.name'), g.id) AS name,
    v.version AS latestVersion, v.imported_at AS latestImportedAt,
    (SELECT count(*) FROM versions x WHERE x.game_id = g.id) AS versionCount,
    (SELECT count(*) FROM versions x WHERE x.game_id = g.id AND x.published_at IS NULL) AS pendingCount,
    (SELECT id FROM versions x WHERE x.game_id = g.id AND x.published_at IS NULL
      AND (g.active_version IS NULL OR playroom_compare_versions(x.version, g.active_version) > 0)
      AND instr(x.version, '-') = 0 ORDER BY id DESC LIMIT 1) AS draftId,
    (SELECT count(*) FROM versions x WHERE x.game_id = g.id AND x.published_at IS NULL
      AND (g.active_version IS NULL OR playroom_compare_versions(x.version, g.active_version) > 0)) AS updateCount
  FROM games g LEFT JOIN repositories r ON r.id = g.repository_id
  LEFT JOIN versions v ON v.id = (SELECT max(id) FROM versions x WHERE x.game_id = g.id)
)`;
const sourceCTE = `${gameCTE}, source_rows AS (
  SELECT r.id, r.full_name AS fullName, r.created_at AS createdAt, r.archived, r.checked_at AS checkedAt,
    r.check_error AS checkError, r.cached_releases AS releases,
    COALESCE((SELECT json_group_array(release_id) FROM versions WHERE game_id = g.id AND release_id IS NOT NULL), '[]') AS importedReleaseIds,
    g.id AS gameId, g.name AS gameName, g.latestVersion AS importedVersion,
    playroom_source_status(r.cached_releases,
      COALESCE((SELECT json_group_array(release_id) FROM versions WHERE game_id = g.id AND release_id IS NOT NULL), '[]'),
      r.checked_at, r.check_error, EXISTS(SELECT 1 FROM import_jobs j WHERE j.repository_id = r.id AND j.status IN ('queued','running'))) AS status
  FROM repositories r LEFT JOIN game_rows g ON g.repositoryId = r.id
)`;
const updatesCTE = `${sourceCTE}, update_rows AS (
  SELECT 'repo:' || s.id AS key, COALESCE(g.name, s.fullName) AS name, s.id AS sourceId, g.id AS gameId,
    s.fullName, s.archived, g.latestImportedAt,
    CASE WHEN s.archived THEN 'archived' WHEN s.status = 'importing' THEN 'importing'
      WHEN COALESCE(s.checkError,'') <> '' THEN 'error'
      WHEN g.draftId IS NOT NULL THEN CASE WHEN (SELECT reviewed_at FROM versions WHERE id = g.draftId) IS NOT NULL THEN 'ready' ELSE 'preview' END
      WHEN playroom_release(s.releases, s.importedReleaseIds, g.activeVersion) IS NOT NULL THEN 'available'
      WHEN g.updateCount > 0 THEN 'manual' WHEN s.checkedAt IS NULL THEN 'unchecked'
      WHEN playroom_release(s.releases, '[]', NULL) IS NULL THEN 'unavailable' ELSE 'current' END AS state
  FROM source_rows s LEFT JOIN game_rows g ON g.id = s.gameId
  UNION ALL
  SELECT 'game:' || g.id, g.name, NULL, g.id, NULL, 0, g.latestImportedAt,
    CASE WHEN g.draftId IS NOT NULL THEN CASE WHEN (SELECT reviewed_at FROM versions WHERE id = g.draftId) IS NOT NULL THEN 'ready' ELSE 'preview' END
      WHEN g.updateCount > 0 THEN 'manual' ELSE 'current' END FROM game_rows g WHERE g.repositoryId IS NULL
)`;
const versionColumns = `id, game_id AS gameId, version, sha256, release_id AS releaseId, asset_id AS assetId,
  release_tag AS releaseTag, imported_at AS importedAt, published_at AS publishedAt, reviewed_by AS reviewedBy, reviewed_at AS reviewedAt`;
function summaryVersion(store: Store, id: number | null): VersionSummary | null {
  return id ? store.sqlite.prepare(`SELECT ${versionColumns} FROM versions WHERE id = ?`).get(id) as VersionSummary || null : null;
}
function gameSummary(store: Store, row: Record<string, unknown>, defaults?: Map<number, VersionSummary>): AdminGameSummary {
  const { draftId, updateCount: _updateCount, ...record } = row;
  return { ...record, published: !!record.published, defaultDraft: defaults ? defaults.get(draftId as number) || null : summaryVersion(store, draftId as number | null) } as AdminGameSummary;
}
function gameSummaries(store: Store, rows: Record<string, unknown>[]) {
  const ids = rows.flatMap((r) => r.draftId ? [r.draftId as number] : []);
  const versions = ids.length ? store.sqlite.prepare(`SELECT ${versionColumns} FROM versions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as VersionSummary[] : [];
  const defaults = new Map(versions.map((v) => [v.id, v]));
  return rows.map((row) => gameSummary(store, row, defaults));
}
function sourceSummary(row: Record<string, unknown>): Source {
  return { ...row, archived: !!row.archived, releases: JSON.parse(row.releases as string), importedReleaseIds: JSON.parse(row.importedReleaseIds as string) } as Source;
}
function page<T>(store: Store, cte: string, table: string, query: Query, where: string, values: SqlValue[], order: string, map: (row: Record<string, unknown>) => T): Page<T> {
  const total = (store.sqlite.prepare(`${cte} SELECT count(*) AS total FROM ${table} WHERE ${where}`).get(...values) as { total: number }).total;
  const current = Math.min(query.page, Math.max(1, Math.ceil(total / query.size)));
  const rows = store.sqlite.prepare(`${cte} SELECT * FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...values, query.size, (current - 1) * query.size) as Record<string, unknown>[];
  return { items: rows.map(map), total, page: current, size: query.size };
}
function search(query: Query, fields: string[]) {
  const term = `%${query.q.trim().replace(/[\\%_]/g, '\\$&')}%`;
  return { sql: `(${fields.map((f) => `COALESCE(${f}, '') LIKE ? ESCAPE '\\'`).join(' OR ')})`, values: fields.map(() => term) as SqlValue[] };
}
export function readGamePage(store: Store, input: unknown): Page<AdminGameSummary> {
  functions(store);
  const query = pageSchema.parse(input), match = search(query, ['name', 'id', 'repositoryName']);
  if (!['all', 'published', 'unpublished', 'pending'].includes(query.status)) throw new AppError(400, '遊戲篩選條件不正確');
  const filter = query.status === 'published' ? 'published = 1' : query.status === 'unpublished' ? 'published = 0' : query.status === 'pending' ? 'pendingCount > 0' : '1';
  const result = page(store, gameCTE, 'game_rows', query, `${match.sql} AND ${filter}`, match.values,
    query.sort === 'recent' ? 'latestImportedAt DESC, id ASC' : 'name COLLATE NOCASE ASC, id ASC', (row) => row);
  return { ...result, items: gameSummaries(store, result.items) };
}
export function readGame(store: Store, id: string): AdminGameSummary {
  functions(store);
  const row = store.sqlite.prepare(`${gameCTE} SELECT * FROM game_rows WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) throw new AppError(404, '找不到遊戲');
  return gameSummary(store, row);
}
export function readVersionPage(store: Store, id: string, input: unknown): Page<VersionSummary> {
  const game = readGame(store, id), query = pageSchema.parse(input), match = search(query, ['version']);
  if (!['all', 'pending', 'published'].includes(query.status)) throw new AppError(400, '版本篩選條件不正確');
  const filter = query.status === 'pending' ? `published_at IS NULL AND (? IS NULL OR playroom_compare_versions(version, ?) > 0)` : query.status === 'published' ? 'published_at IS NOT NULL' : '1';
  const values = [id, ...match.values, ...(query.status === 'pending' ? [game.activeVersion, game.activeVersion] : [])];
  const total = (store.sqlite.prepare(`SELECT count(*) AS total FROM versions WHERE game_id = ? AND ${match.sql} AND ${filter}`).get(...values) as { total: number }).total;
  const current = Math.min(query.page, Math.max(1, Math.ceil(total / query.size)));
  const items = store.sqlite.prepare(`SELECT ${versionColumns} FROM versions WHERE game_id = ? AND ${match.sql} AND ${filter} ORDER BY ${query.sort === 'version' ? 'version DESC, id DESC' : 'id DESC'} LIMIT ? OFFSET ?`).all(...values, query.size, (current - 1) * query.size) as VersionSummary[];
  return { items, total, page: current, size: query.size };
}
export function readVersion(store: Store, id: string, version: string): StoredVersion {
  const row = store.sqlite.prepare(`SELECT ${versionColumns}, manifest FROM versions WHERE game_id = ? AND version = ?`).get(id, version) as (VersionSummary & { manifest: string }) | undefined;
  if (!row) throw new AppError(404, '找不到此遊戲版本');
  return { ...row, manifest: JSON.parse(row.manifest) };
}
export function readSource(store: Store, id: number): Source {
  functions(store);
  const row = store.sqlite.prepare(`${sourceCTE} SELECT * FROM source_rows WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) throw new AppError(404, '找不到來源');
  return sourceSummary(row);
}
export function readSourcePage(store: Store, input: unknown): Page<Source> {
  functions(store);
  const query = pageSchema.parse(input), match = search(query, ['fullName', 'gameName']);
  if (!['all', 'unchecked', 'available', 'current', 'unavailable', 'error', 'importing'].includes(query.status)) throw new AppError(400, '來源篩選條件不正確');
  const filter = query.scope === 'all' ? '1' : query.scope === 'archived' ? 'archived = 1' : 'archived = 0';
  return page(store, sourceCTE, 'source_rows', query, `${match.sql} AND ${filter} AND (? = '' OR substr(fullName,1,instr(fullName,'/')-1) = ?) AND (? = 'all' OR status = ?)`, [...match.values, query.owner, query.owner, query.status, query.status],
    query.sort === 'recent' ? 'createdAt DESC, id ASC' : 'fullName COLLATE NOCASE ASC, id ASC', sourceSummary);
}
function updateSummaries(store: Store, rows: Record<string, unknown>[], choices: Record<string, string> = {}): UpdateSummary[] {
  const sourceIds = rows.flatMap((row) => row.sourceId ? [row.sourceId as number] : []);
  const gameIds = rows.flatMap((row) => row.gameId ? [row.gameId as string] : []);
  const sourceRows = sourceIds.length ? store.sqlite.prepare(`${sourceCTE} SELECT * FROM source_rows WHERE id IN (${sourceIds.map(() => '?').join(',')})`).all(...sourceIds) as Record<string, unknown>[] : [];
  const gameRows = gameIds.length ? store.sqlite.prepare(`${gameCTE} SELECT * FROM game_rows WHERE id IN (${gameIds.map(() => '?').join(',')})`).all(...gameIds) as Record<string, unknown>[] : [];
  const sources = new Map(sourceRows.map((row) => { const value = sourceSummary(row); return [value.id, value]; }));
  const games = new Map(gameSummaries(store, gameRows).map((game) => [game.id, game]));
  const draftRows = gameIds.length ? store.sqlite.prepare(`SELECT * FROM (
    SELECT ${versionColumns.split(',').map((column) => column.trim()).map((column) => 'v.' + column).join(',')},
      row_number() OVER (PARTITION BY v.game_id ORDER BY v.id DESC) AS position
    FROM versions v JOIN games g ON g.id = v.game_id WHERE v.game_id IN (${gameIds.map(() => '?').join(',')}) AND v.published_at IS NULL
    AND (g.active_version IS NULL OR playroom_compare_versions(v.version,g.active_version) > 0)) WHERE position <= 100`).all(...gameIds) as (VersionSummary & { position: number })[] : [];
  const draftsByGame = new Map<string, VersionSummary[]>();
  for (const { position: _position, ...draft } of draftRows) draftsByGame.set(draft.gameId, [...(draftsByGame.get(draft.gameId) || []), draft]);
  return rows.map((row) => {
  const source = sources.get(row.sourceId as number);
  const game = games.get(row.gameId as string);
  const drafts = game ? draftsByGame.get(game.id) || [] : [];
  const draft = game && game.id in choices ? drafts.find((v) => v.version === choices[game.id]) : game?.defaultDraft || undefined;
  const release = source && updateRelease(source, game);
  const state = source?.archived ? 'archived' : source?.status === 'importing' ? 'importing' : source?.checkError ? 'error' : draft ? draft.reviewedAt ? 'ready' : 'preview' : release ? 'available' : drafts.length ? 'manual' : row.state;
  return { key: row.key as string, name: row.name as string, source, game, draft, drafts, release, state } as UpdateSummary;
  });
}
export function readUpdatePage(store: Store, input: unknown): Page<UpdateSummary> {
  functions(store);
  const query = pageSchema.parse(input), match = search(query, ['name', 'gameId', 'fullName']);
  if (!['all', 'pending', 'available', 'importing', 'preview', 'ready', 'error', 'manual', 'unchecked', 'unavailable', 'current', 'archived'].includes(query.status)) throw new AppError(400, '更新篩選條件不正確');
  const filter = query.scope === 'all' ? '1' : query.scope === 'archived' ? 'archived = 1' : 'archived = 0';
  const result = page(store, updatesCTE, 'update_rows', query,
    `${match.sql} AND ${filter} AND (? = '' OR substr(fullName,1,instr(fullName,'/')-1) = ?) AND (? = 'all' OR (? = 'pending' AND state NOT IN ('current','archived')) OR state = ?)`,
    [...match.values, query.owner, query.owner, query.status, query.status, query.status],
    query.sort === 'recent' ? 'latestImportedAt DESC, key ASC' : 'name COLLATE NOCASE ASC, key ASC', (row) => row);
  return { ...result, items: updateSummaries(store, result.items) };
}
export function readSelection(store: Store, keys: string[], choices: Record<string, string> = {}) {
  functions(store);
  const placeholders = keys.map(() => '?').join(',');
  const rows = store.sqlite.prepare(`${updatesCTE} SELECT * FROM update_rows WHERE key IN (${placeholders}) ORDER BY name COLLATE NOCASE, key`).all(...keys) as Record<string, unknown>[];
  return updateSummaries(store, rows, choices);
}
export function readAdminSummary(store: Store): AdminSummary {
  functions(store);
  const counts = store.sqlite.prepare('SELECT count(*) AS games, COALESCE(sum(published),0) AS published FROM games').get() as { games: number; published: number };
  const activeSources = (store.sqlite.prepare('SELECT count(*) AS count FROM repositories WHERE archived = 0').get() as { count: number }).count;
  const pending = (store.sqlite.prepare(`${updatesCTE} SELECT count(*) AS count FROM update_rows WHERE state NOT IN ('current','archived')`).get() as { count: number }).count;
  return { ...counts, activeSources, pending };
}
export function readAdminTasks(store: Store): AdminTasks {
  const jobs = store.sqlite.prepare(`SELECT j.id, j.repository_id AS repositoryId, j.release_id AS releaseId,
    j.status, j.phase, j.error, j.game_id AS gameId, j.version, j.created_at AS createdAt, j.updated_at AS updatedAt,
    r.full_name AS repositoryName FROM import_jobs j JOIN repositories r ON r.id = j.repository_id ORDER BY j.created_at DESC, j.id ASC LIMIT 50`).all() as AdminTasks['jobs'];
  const pending = (store.sqlite.prepare("SELECT count(*) AS count FROM import_jobs WHERE status IN ('queued','running')").get() as { count: number }).count;
  const revision = jobs.map((j) => `${j.id}:${j.status}:${j.phase}:${j.updatedAt}`).join('|');
  return { jobs, pending, revision };
}
export function readSourceSelection(store: Store, ids: number[]) {
  functions(store);
  const rows = ids.length ? store.sqlite.prepare(`${sourceCTE} SELECT * FROM source_rows WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids) as Record<string, unknown>[] : [];
  return rows.map(sourceSummary);
}
export function readSourceOwners(store: Store) {
  return (store.sqlite.prepare("SELECT DISTINCT substr(full_name,1,instr(full_name,'/')-1) AS owner FROM repositories ORDER BY owner COLLATE NOCASE LIMIT 10000").all() as { owner: string }[]).map((row) => row.owner);
}
