import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { testManifest } from '../../helpers.js';

export const HISTORICAL_FIXTURE_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** Frozen DDL, with only data/columns which existed at that historical version. */
export function createHistoricalFixture(dataDir: string, version: number) {
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(path.join(dataDir, 'platform.sqlite'));
  sqlite.pragma('foreign_keys=ON');
  sqlite.exec(fs.readFileSync(new URL(`./v${version}.sql`, import.meta.url), 'utf8'));
  const now = '2026-01-01T00:00:00.000Z';
  if (version === 1) sqlite.prepare('INSERT INTO admins VALUES(1, ?, ?)').run('FixtureAdmin', 'password-hash');
  else {
    sqlite.prepare('INSERT INTO users(id,username,password,role,created_at) VALUES(1,?,?,?,?)').run('FixtureAdmin', 'password-hash', 'admin', now);
    sqlite.prepare('INSERT INTO users(id,username,password,role,created_at) VALUES(2,?,?,?,?)').run('FixturePlayer', 'player-hash', 'player', now);
    // Deleted high ID must not be reused, including through the v8 rebuild.
    sqlite.prepare('INSERT INTO users(id,username,password) VALUES(99,?,?)').run('DeletedUser', 'deleted-hash');
    sqlite.prepare('DELETE FROM users WHERE id=99').run();
  }
  sqlite.prepare(`INSERT INTO sessions(token_hash,${version === 1 ? 'admin_id' : 'user_id'},csrf,expires_at) VALUES(?,1,?,?)`).run('fixture-session', 'fixture-csrf', 4_000_000_000_000);
  sqlite.prepare('INSERT INTO repositories(id,full_name,created_at) VALUES(1,?,?)').run('fixture/game', now);
  sqlite.prepare('INSERT INTO games(id,repository_id,active_version,published) VALUES(?,1,?,1)').run(testManifest.id, testManifest.version);
  sqlite.prepare('INSERT INTO versions(id,game_id,version,manifest,sha256,imported_at,published_at) VALUES(1,?,?,?,?,?,?)').run(testManifest.id, testManifest.version, JSON.stringify(testManifest), 'a'.repeat(64), now, now);
  sqlite.prepare('INSERT INTO import_jobs VALUES(?,1,101,?,?,?,?,?,?,?)').run('fixture-job', 'queued', 'queued', null, testManifest.id, testManifest.version, now, now);
  sqlite.prepare('INSERT INTO previews VALUES(?,?,?,?)').run('fixture-preview', testManifest.id, testManifest.version, 4_000_000_000_000);
  if (version >= 3) {
    sqlite.prepare('INSERT INTO plays VALUES(?,2,?,?,?,?,?,?,100,200,100,1)').run('fixture-play', 'fixture-session', 'play-request', testManifest.id, testManifest.version, testManifest.name, 'main');
    sqlite.prepare('INSERT INTO runs VALUES(?,?,?,100,42,200)').run('fixture-run', 'fixture-play', 'run-request');
    sqlite.prepare('INSERT INTO best_scores VALUES(2,?,?,42,200,?)').run(testManifest.id, 'main', 'fixture-run');
  }
  if (version >= 4) sqlite.prepare('INSERT INTO favorites VALUES(2,?,300)').run(testManifest.id);
  if (version >= 5) {
    sqlite.exec("INSERT INTO account_settings VALUES(2,'private'); INSERT INTO operational_state VALUES('fixture','retained');");
    sqlite.prepare("INSERT INTO score_submission_metrics VALUES('2026-01-01',?,'success',1)").run(testManifest.id);
  }
  if (version >= 6) sqlite.prepare("INSERT INTO visitor_events(visitor_id,request_id,occurred_at,kind,path,ip,user_id,game_id,user_agent) VALUES('visitor','visit-request',100,'game_open','/','127.0.0.1',2,?,'fixture')").run(testManifest.id);
  if (version >= 7) {
    sqlite.exec("INSERT INTO github_owners VALUES('Fixture','User','2026-01-01'); INSERT INTO import_batches VALUES('fixture-batch','2026-01-01'); INSERT INTO import_batch_items VALUES(1,'fixture-batch',1,101,'fixture-job','job',NULL);");
  }
  if (version >= 8) sqlite.prepare('INSERT INTO users(username,password,role) VALUES(?,?,?)').run('FixtureManager', 'manager-hash', 'game_manager');
  if (version >= 9) sqlite.prepare("UPDATE versions SET reviewed_by='FixtureManager',reviewed_at=?").run(now);
  if (version >= 10) sqlite.prepare('INSERT INTO cloud_saves VALUES(2,?,?,3,1,?,?,?)').run(testManifest.id, '{"level":4}', testManifest.version, now, 'save-request');
  const versionDir = path.join(dataDir, 'games', testManifest.id, testManifest.version);
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, testManifest.entry), '<!doctype html><title>fixture</title>');
  fs.writeFileSync(path.join(versionDir, testManifest.cover), 'fixture-cover');
  fs.writeFileSync(path.join(versionDir, 'game.json'), JSON.stringify(testManifest));
  return sqlite;
}
