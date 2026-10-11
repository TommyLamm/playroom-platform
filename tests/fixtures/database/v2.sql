-- Frozen real schema at v2, from published historical migrations.
-- Do not regenerate these fixtures when changing the migration runner.
CREATE TABLE games (id TEXT PRIMARY KEY, repository_id INTEGER UNIQUE REFERENCES repositories(id), active_version TEXT, published INTEGER NOT NULL DEFAULT 0);

CREATE TABLE import_jobs (id TEXT PRIMARY KEY, repository_id INTEGER NOT NULL REFERENCES repositories(id), release_id INTEGER NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL, error TEXT, game_id TEXT, version TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE previews (token_hash TEXT PRIMARY KEY, game_id TEXT NOT NULL, version TEXT NOT NULL, expires_at INTEGER NOT NULL);

CREATE TABLE repositories (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);

CREATE TABLE "sessions" (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);

CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player', 'admin')), created_at TEXT NOT NULL DEFAULT '');

CREATE TABLE versions (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL REFERENCES games(id), version TEXT NOT NULL, manifest TEXT NOT NULL, sha256 TEXT NOT NULL, release_id INTEGER, asset_id INTEGER, release_tag TEXT, imported_at TEXT NOT NULL, published_at TEXT, UNIQUE(game_id, version));

CREATE INDEX previews_expiry ON previews(expires_at);

CREATE INDEX sessions_expiry ON sessions(expires_at);

PRAGMA user_version=2;
