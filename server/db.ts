import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import type { GameManifest } from '../shared/manifest.js';
import type { UserRole } from '../shared/account.js';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  role: text('role').$type<UserRole>().notNull().default('player'),
  createdAt: text('created_at').notNull().default(''),
});
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  csrf: text('csrf').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export const repositories = sqliteTable('repositories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fullName: text('full_name').notNull().unique(),
  createdAt: text('created_at').notNull(),
});
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
});
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
export const previews = sqliteTable('previews', {
  tokenHash: text('token_hash').primaryKey(),
  gameId: text('game_id').notNull(),
  version: text('version').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export function openStore(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(path.join(dataDir, 'platform.sqlite'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const version = sqlite.pragma('user_version', { simple: true }) as number;
  if (version > 5) throw new Error('Database was created by a newer platform version');
  if (version === 0)
    sqlite.transaction(() => {
      sqlite.exec(`
      CREATE TABLE admins (id INTEGER PRIMARY KEY CHECK(id = 1), username TEXT NOT NULL UNIQUE, password TEXT NOT NULL);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE repositories (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE games (id TEXT PRIMARY KEY, repository_id INTEGER UNIQUE REFERENCES repositories(id), active_version TEXT, published INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE versions (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL REFERENCES games(id), version TEXT NOT NULL, manifest TEXT NOT NULL, sha256 TEXT NOT NULL, release_id INTEGER, asset_id INTEGER, release_tag TEXT, imported_at TEXT NOT NULL, published_at TEXT, UNIQUE(game_id, version));
      CREATE TABLE import_jobs (id TEXT PRIMARY KEY, repository_id INTEGER NOT NULL REFERENCES repositories(id), release_id INTEGER NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL, error TEXT, game_id TEXT, version TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE previews (token_hash TEXT PRIMARY KEY, game_id TEXT NOT NULL, version TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE INDEX sessions_expiry ON sessions(expires_at);
      CREATE INDEX previews_expiry ON previews(expires_at);
      PRAGMA user_version = 1;
    `);
    })();
  if (version <= 1)
    sqlite.transaction(() => {
      // Preserve the existing administrator and sessions while introducing player accounts.
      sqlite.exec(`
        CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player', 'admin')), created_at TEXT NOT NULL DEFAULT '');
        INSERT INTO users (id, username, password, role, created_at)
          SELECT id, username, password, 'admin', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM admins;
        CREATE TABLE sessions_v2 (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
        INSERT INTO sessions_v2 SELECT token_hash, admin_id, csrf, expires_at FROM sessions;
        DROP TABLE sessions;
        DROP TABLE admins;
        ALTER TABLE sessions_v2 RENAME TO sessions;
        CREATE INDEX sessions_expiry ON sessions(expires_at);
        PRAGMA user_version = 2;
      `);
    })();
  if (version <= 2)
    sqlite.transaction(() => {
      sqlite.exec(`
        CREATE TABLE plays (
          id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
          session_hash TEXT NOT NULL, request_id TEXT NOT NULL,
          game_id TEXT NOT NULL REFERENCES games(id), version TEXT NOT NULL,
          game_name TEXT NOT NULL, board_id TEXT,
          started_at INTEGER NOT NULL, last_heartbeat_at INTEGER NOT NULL,
          active_ms INTEGER NOT NULL DEFAULT 0, heartbeat_active INTEGER NOT NULL DEFAULT 0,
          UNIQUE(session_hash, request_id)
        );
        CREATE TABLE runs (
          id TEXT PRIMARY KEY, play_id TEXT NOT NULL REFERENCES plays(id),
          request_id TEXT NOT NULL, started_at INTEGER NOT NULL,
          score INTEGER, finished_at INTEGER, UNIQUE(play_id, request_id)
        );
        CREATE TABLE best_scores (
          user_id INTEGER NOT NULL REFERENCES users(id), game_id TEXT NOT NULL REFERENCES games(id),
          board_id TEXT NOT NULL, score INTEGER NOT NULL, achieved_at INTEGER NOT NULL,
          run_id TEXT NOT NULL REFERENCES runs(id), PRIMARY KEY(user_id, game_id, board_id)
        );
        CREATE INDEX plays_user_game ON plays(user_id, game_id, started_at);
        CREATE INDEX runs_play_finished ON runs(play_id, finished_at);
        CREATE INDEX best_scores_ranking ON best_scores(game_id, board_id, score, achieved_at, user_id);
        PRAGMA user_version = 3;
      `);
    })();
  if (version <= 3)
    sqlite.transaction(() => {
      sqlite.exec(`
        CREATE TABLE favorites (
          user_id INTEGER NOT NULL REFERENCES users(id),
          game_id TEXT NOT NULL REFERENCES games(id),
          created_at INTEGER NOT NULL,
          PRIMARY KEY(user_id, game_id)
        );
        CREATE INDEX favorites_user_created ON favorites(user_id, created_at DESC, game_id);
        PRAGMA user_version = 4;
      `);
    })();
  if (version <= 4)
    sqlite.transaction(() => {
      sqlite.exec(`
        CREATE TABLE account_settings (
          user_id INTEGER PRIMARY KEY REFERENCES users(id),
          career_visibility TEXT NOT NULL DEFAULT 'public' CHECK(career_visibility IN ('public','limited','private'))
        );
        CREATE TABLE score_submission_metrics (
          day TEXT NOT NULL, game_id TEXT NOT NULL REFERENCES games(id),
          outcome TEXT NOT NULL CHECK(outcome IN ('success','rejected','server_error')),
          count INTEGER NOT NULL CHECK(count >= 0), PRIMARY KEY(day,game_id,outcome)
        );
        CREATE TABLE operational_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version = 5;
      `);
    })();
  return { sqlite, db: drizzle(sqlite) };
}
export type Store = ReturnType<typeof openStore>;
