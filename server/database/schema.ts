import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, customType, check, index, primaryKey, unique } from 'drizzle-orm/sqlite-core';
import type { GameManifest } from '../../shared/manifest.js';
import type { UserRole } from '../../shared/account.js';
import type { Release } from '../../shared/types.js';
import type { FileDigest } from '../version-files.js';
import type { InstallSource } from '../installation-service.js';

// Migrations are the deployment authority. Drizzle cannot declare COLLATE on its
// built-in text builder, so these two columns explicitly retain the SQL type.
const caseInsensitiveText = customType<{ data: string; driverData: string }>({
  dataType: () => 'TEXT COLLATE NOCASE',
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: caseInsensitiveText('username').notNull().unique(),
  password: text('password').notNull(),
  role: text('role').$type<UserRole>().notNull().default('player'),
  createdAt: text('created_at').notNull().default(''),
}, (table) => [check('users_role_check', sql`${table.role} IN ('player','game_manager','analyst','admin')`)]);
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  csrf: text('csrf').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => [index('sessions_expiry').on(table.expiresAt)]);
export const repositories = sqliteTable('repositories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fullName: text('full_name').notNull().unique(),
  createdAt: text('created_at').notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  checkedAt: text('checked_at'),
  checkError: text('check_error'),
  cachedReleases: text('cached_releases', { mode: 'json' }).$type<Release[]>().notNull().default([]),
});
export const githubOwners = sqliteTable('github_owners', {
  login: caseInsensitiveText('login').primaryKey(),
  kind: text('kind').$type<'User' | 'Organization'>().notNull(),
  createdAt: text('created_at').notNull(),
});
export const importBatches = sqliteTable('import_batches', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
});
export const importBatchItems = sqliteTable('import_batch_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  batchId: text('batch_id').notNull().references(() => importBatches.id),
  repositoryId: integer('repository_id').notNull().references(() => repositories.id),
  releaseId: integer('release_id').notNull(),
  jobId: text('job_id').references(() => jobs.id),
  outcome: text('outcome').$type<'job' | 'skipped' | 'failed'>().notNull(),
  error: text('error'),
}, (table) => [
  unique().on(table.batchId, table.repositoryId, table.releaseId),
  index('import_batch_items_batch').on(table.batchId, table.id),
]);
export const games = sqliteTable('games', {
  id: text('id').primaryKey(),
  repositoryId: integer('repository_id')
    .unique()
    .references(() => repositories.id),
  activeVersion: text('active_version'),
  published: integer('published', { mode: 'boolean' }).notNull().default(false),
});
export const versions = sqliteTable('versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gameId: text('game_id')
    .notNull()
    .references(() => games.id),
  version: text('version').notNull(),
  manifest: text('manifest', { mode: 'json' }).$type<GameManifest>().notNull(),
  sha256: text('sha256').notNull(),
  releaseId: integer('release_id'),
  assetId: integer('asset_id'),
  releaseTag: text('release_tag'),
  importedAt: text('imported_at').notNull(),
  publishedAt: text('published_at'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: text('reviewed_at'),
}, (table) => [unique().on(table.gameId, table.version)]);
export const jobs = sqliteTable('import_jobs', {
  id: text('id').primaryKey(),
  repositoryId: integer('repository_id')
    .notNull()
    .references(() => repositories.id),
  releaseId: integer('release_id').notNull(),
  status: text('status').notNull(),
  phase: text('phase').notNull(),
  error: text('error'),
  gameId: text('game_id'),
  version: text('version'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const installations = sqliteTable('installations', {
  id: text('id').primaryKey(),
  jobId: text('job_id').unique().references(() => jobs.id),
  gameId: text('game_id').notNull(), version: text('version').notNull(),
  stagingPath: text('staging_path').notNull(),
  manifest: text('manifest', { mode: 'json' }).$type<GameManifest>().notNull(),
  source: text('source', { mode: 'json' }).$type<InstallSource>().notNull(),
  files: text('files', { mode: 'json' }).$type<FileDigest[]>().notNull(),
  state: text('state').$type<'prepared' | 'registered' | 'completed' | 'quarantining' | 'quarantined' | 'blocked'>().notNull(),
  reason: text('reason'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  check('installations_state_check', sql`${table.state} IN ('prepared','registered','completed','quarantining','quarantined','blocked')`),
  index('installations_version').on(table.gameId, table.version),
]);
export const previews = sqliteTable('previews', {
  tokenHash: text('token_hash').primaryKey(),
  gameId: text('game_id').notNull(),
  version: text('version').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => [index('previews_expiry').on(table.expiresAt)]);

export const plays = sqliteTable('plays', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  sessionHash: text('session_hash').notNull(),
  requestId: text('request_id').notNull(),
  gameId: text('game_id').notNull().references(() => games.id),
  version: text('version').notNull(),
  gameName: text('game_name').notNull(),
  boardId: text('board_id'),
  startedAt: integer('started_at').notNull(),
  lastHeartbeatAt: integer('last_heartbeat_at').notNull(),
  activeMs: integer('active_ms').notNull().default(0),
  heartbeatActive: integer('heartbeat_active').notNull().default(0),
}, (table) => [
  unique().on(table.sessionHash, table.requestId),
  index('plays_user_game').on(table.userId, table.gameId, table.startedAt),
]);

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  playId: text('play_id').notNull().references(() => plays.id),
  requestId: text('request_id').notNull(),
  startedAt: integer('started_at').notNull(),
  score: integer('score'),
  finishedAt: integer('finished_at'),
}, (table) => [unique().on(table.playId, table.requestId), index('runs_play_finished').on(table.playId, table.finishedAt)]);

export const bestScores = sqliteTable('best_scores', {
  userId: integer('user_id').notNull().references(() => users.id),
  gameId: text('game_id').notNull().references(() => games.id),
  boardId: text('board_id').notNull(),
  score: integer('score').notNull(),
  achievedAt: integer('achieved_at').notNull(),
  runId: text('run_id').notNull().references(() => runs.id),
}, (table) => [
  primaryKey({ columns: [table.userId, table.gameId, table.boardId] }),
  index('best_scores_ranking').on(table.gameId, table.boardId, table.score, table.achievedAt, table.userId),
]);

export const favorites = sqliteTable('favorites', {
  userId: integer('user_id').notNull().references(() => users.id),
  gameId: text('game_id').notNull().references(() => games.id),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.gameId] }),
  index('favorites_user_created').on(table.userId, sql`${table.createdAt} DESC`, table.gameId),
]);

export const accountSettings = sqliteTable('account_settings', {
  userId: integer('user_id').primaryKey().references(() => users.id),
  careerVisibility: text('career_visibility').$type<'public' | 'limited' | 'private'>().notNull().default('public'),
}, (table) => [check('account_settings_visibility_check', sql`${table.careerVisibility} IN ('public','limited','private')`)]);

export const scoreSubmissionMetrics = sqliteTable('score_submission_metrics', {
  day: text('day').notNull(),
  gameId: text('game_id').notNull().references(() => games.id),
  outcome: text('outcome').$type<'success' | 'rejected' | 'server_error'>().notNull(),
  count: integer('count').notNull(),
}, (table) => [
  primaryKey({ columns: [table.day, table.gameId, table.outcome] }),
  check('score_submission_metrics_outcome_check', sql`${table.outcome} IN ('success','rejected','server_error')`),
  check('score_submission_metrics_count_check', sql`${table.count} >= 0`),
]);

export const operationalState = sqliteTable('operational_state', {
  key: text('key').primaryKey(), value: text('value').notNull(),
});

export const visitorEvents = sqliteTable('visitor_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  visitorId: text('visitor_id').notNull(),
  requestId: text('request_id').notNull(),
  occurredAt: integer('occurred_at').notNull(),
  kind: text('kind').$type<'page_view' | 'game_open'>().notNull(),
  path: text('path').notNull(), ip: text('ip').notNull(), country: text('country'),
  userId: integer('user_id').references(() => users.id),
  gameId: text('game_id').references(() => games.id),
  gameName: text('game_name'), gameVersion: text('game_version'),
  referrerHost: text('referrer_host'), userAgent: text('user_agent').notNull(),
}, (table) => [
  unique().on(table.visitorId, table.requestId),
  check('visitor_events_kind_check', sql`${table.kind} IN ('page_view','game_open')`),
  index('visitor_events_time').on(sql`${table.occurredAt} DESC`, sql`${table.id} DESC`),
  index('visitor_events_visitor').on(table.visitorId, table.occurredAt),
  index('visitor_events_game').on(table.gameId, table.occurredAt),
]);

export const cloudSaves = sqliteTable('cloud_saves', {
  userId: integer('user_id').notNull().references(() => users.id),
  gameId: text('game_id').notNull().references(() => games.id),
  data: text('data', { mode: 'json' }).$type<unknown>().notNull(),
  revision: integer('revision').notNull(), formatVersion: integer('format_version').notNull(),
  gameVersion: text('game_version').notNull(), updatedAt: text('updated_at').notNull(),
  requestId: text('request_id').notNull(),
  // Retained for restore retry identity even after the bounded snapshot is evicted.
  sourceSnapshotId: integer('source_snapshot_id'),
}, (table) => [
  primaryKey({ columns: [table.userId, table.gameId] }),
  check('cloud_saves_revision_check', sql`${table.revision} > 0`),
  index('cloud_saves_game_format').on(table.gameId, table.formatVersion),
]);

export const cloudSaveSnapshots = sqliteTable('cloud_save_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  gameId: text('game_id').notNull().references(() => games.id),
  data: text('data', { mode: 'json' }).$type<unknown>().notNull(),
  revision: integer('revision').notNull(), formatVersion: integer('format_version').notNull(),
  gameVersion: text('game_version').notNull(), updatedAt: text('updated_at').notNull(),
  requestId: text('request_id').notNull(), capturedAt: text('captured_at').notNull(),
  reason: text('reason').$type<'migration' | 'restore'>().notNull(),
}, (table) => [
  unique().on(table.userId, table.gameId, table.revision),
  check('cloud_save_snapshots_revision_check', sql`${table.revision} > 0`),
  check('cloud_save_snapshots_reason_check', sql`${table.reason} IN ('migration','restore')`),
  index('cloud_save_snapshots_owner').on(table.userId, table.gameId, sql`${table.id} DESC`),
]);
