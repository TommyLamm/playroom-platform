import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from '../server/database/schema.js';
import { openStore } from '../server/db.js';
import { runMigrations } from '../server/database/runner.js';
import { migrations } from '../server/database/migrations/index.js';
import { CURRENT_SCHEMA_VERSION, SUPPORTED_BACKUP_SCHEMA_VERSIONS } from '../server/database/version.js';
import { inspectSchema } from '../server/database/schema-inspection.js';
import { backup, restore } from '../server/maintenance.js';
import { createHistoricalFixture, HISTORICAL_FIXTURE_VERSIONS } from './fixtures/database/fixture.js';

function root(t: test.TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'playroom-db-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function checkIntegrity(sqlite: Database.Database) {
  assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
  assert.equal(sqlite.pragma('integrity_check', { simple: true }), 'ok');
}
function checkRetained(sqlite: Database.Database, from: number, restore = false) {
  assert.equal((sqlite.prepare('SELECT password,role FROM users WHERE id=1').get() as { password: string }).password, 'password-hash');
  assert.equal((sqlite.prepare('SELECT role FROM users WHERE id=1').get() as { role: string }).role, 'admin');
  assert.equal((sqlite.prepare('SELECT COUNT(*) n FROM sessions').get() as { n: number }).n, restore ? 0 : 1);
  assert.equal((sqlite.prepare('SELECT COUNT(*) n FROM previews').get() as { n: number }).n, restore ? 0 : 1);
  assert.equal((sqlite.prepare('SELECT COUNT(*) n FROM versions').get() as { n: number }).n, 1);
  if (from >= 3) assert.equal((sqlite.prepare("SELECT score FROM runs WHERE id='fixture-run'").get() as { score: number }).score, 42);
  if (from >= 4) assert.equal((sqlite.prepare('SELECT COUNT(*) n FROM favorites').get() as { n: number }).n, 1);
  if (from >= 5) assert.equal((sqlite.prepare('SELECT career_visibility FROM account_settings WHERE user_id=2').get() as { career_visibility: string }).career_visibility, 'private');
  if (from >= 7) assert.equal((sqlite.prepare('SELECT COUNT(*) n FROM import_batch_items').get() as { n: number }).n, 1);
  if (from >= 8) assert.equal((sqlite.prepare("SELECT role FROM users WHERE username='FixtureManager'").get() as { role: string }).role, 'game_manager');
  if (from >= 9) assert.equal((sqlite.prepare('SELECT reviewed_by FROM versions').get() as { reviewed_by: string }).reviewed_by, 'FixtureManager');
  if (from >= 10) assert.deepEqual(sqlite.prepare('SELECT data,revision,format_version FROM cloud_saves').get(), { data: '{"level":4}', revision: 3, format_version: 1 });
}

test('frozen v10 inventory matches the unmodified historical migration path', () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys=ON');
    runMigrations(sqlite, migrations.slice(0, 10));
    assert.deepEqual(inspectSchema(sqlite), JSON.parse(fs.readFileSync(new URL('../docs/database-schema-v10.json', import.meta.url), 'utf8')));
  } finally { sqlite.close(); }
});

for (const version of HISTORICAL_FIXTURE_VERSIONS) test(`real v${version} structure upgrades to the same fresh schema and retains applicable data`, (t) => {
  const directory = root(t);
  const old = createHistoricalFixture(path.join(directory, 'old'), version);
  checkIntegrity(old);
  old.close();
  const fresh = openStore(path.join(directory, 'fresh'));
  const upgraded = openStore(path.join(directory, 'old'));
  try {
    assert.deepEqual(inspectSchema(upgraded.sqlite), inspectSchema(fresh.sqlite));
    assert.equal(upgraded.sqlite.pragma('user_version', { simple: true }), CURRENT_SCHEMA_VERSION);
    checkRetained(upgraded.sqlite, version);
    checkIntegrity(upgraded.sqlite);
    assert.throws(() => upgraded.sqlite.prepare('INSERT INTO users(username,password) VALUES(?,?)').run('fixtureadmin', 'duplicate'), /UNIQUE/);
    assert.throws(() => upgraded.sqlite.prepare('INSERT INTO users(username,password,role) VALUES(?,?,?)').run('BadRole', 'x', 'owner'), /CHECK/);
    assert.throws(() => upgraded.sqlite.prepare("INSERT INTO favorites VALUES(999,'test-game',1)").run(), /FOREIGN KEY/);
    assert.throws(() => upgraded.sqlite.exec("INSERT INTO versions(game_id,version,manifest,sha256,imported_at) SELECT game_id,version,manifest,sha256,imported_at FROM versions"), /UNIQUE/);
    const inserted = upgraded.sqlite.prepare('INSERT INTO users(username,password) VALUES(?,?)').run('NextUser', 'x');
    if (version >= 2) assert.ok(Number(inserted.lastInsertRowid) >= 100, 'autoincrement must preserve deleted high ids through v8');
  } finally { fresh.sqlite.close(); upgraded.sqlite.close(); }
  const reopened = openStore(path.join(directory, 'old'));
  try { checkIntegrity(reopened.sqlite); } finally { reopened.sqlite.close(); }
});

test('every current ORM table and column exists, with uniqueness, keys and checks declared', (t) => {
  const store = openStore(root(t));
  try {
    const inventory = inspectSchema(store.sqlite);
    const tables = Object.values(schema).filter((table) => is(table, SQLiteTable));
    assert.equal(tables.length, inventory.length);
    for (const table of tables) {
      const definition = getTableConfig(table);
      const actual = inventory.find(({ name }) => name === definition.name);
      assert.ok(actual, definition.name);
      const columns = actual.columns as { name: string; pk: number; notnull: number }[];
      assert.deepEqual(definition.columns.map(({ name }) => name).sort(), columns.map(({ name }) => name).sort());
      for (const column of definition.columns) {
        const deployed = columns.find(({ name }) => name === column.name)!;
        // SQLite INTEGER/TEXT PRIMARY KEY has historical notnull metadata 0.
        if (!column.primary) assert.equal(Number(column.notNull), deployed.notnull, `${definition.name}.${column.name}`);
      }
      assert.equal(definition.foreignKeys.length, (actual.foreignKeys as unknown[]).length, definition.name);
      assert.equal(definition.checks.length, (actual.sql.match(/CHECK\s*\(/gi) ?? []).length, definition.name);
      const uniqueKeys = definition.columns.filter((column) => column.isUnique).length + definition.uniqueConstraints.length;
      assert.equal(uniqueKeys, actual.indexes.filter(({ unique, origin }) => unique && origin === 'u').length, definition.name);
      assert.deepEqual(definition.indexes.map(({ config }) => config.name).sort(), actual.indexes.filter(({ origin }) => origin === 'c').map(({ name }) => name).sort());
    }
    assert.equal(schema.users.username.getSQLType(), 'TEXT COLLATE NOCASE');
    assert.equal(schema.githubOwners.login.getSQLType(), 'TEXT COLLATE NOCASE');
  } finally { store.sqlite.close(); }
});

test('v11 upgrades to durable installations without altering saves or snapshots, and v12 backup restores them', async (t) => {
  const directory = root(t);
  const data = path.join(directory, 'v11');
  const old = createHistoricalFixture(data, 10);
  runMigrations(old, migrations.slice(0, 11));
  old.prepare("INSERT INTO cloud_save_snapshots(user_id,game_id,data,revision,format_version,game_version,updated_at,request_id,captured_at,reason) VALUES(2,'test-game','{\"level\":2}',2,1,'1.0.0','old','request','captured','migration')").run();
  const saved = old.prepare('SELECT * FROM cloud_saves').all();
  const snapshots = old.prepare('SELECT * FROM cloud_save_snapshots').all();
  old.close();
  const upgraded = openStore(data);
  try {
    assert.equal(upgraded.sqlite.pragma('user_version', { simple: true }), 12);
    assert.deepEqual(upgraded.sqlite.prepare('SELECT * FROM cloud_saves').all(), saved);
    assert.deepEqual(upgraded.sqlite.prepare('SELECT * FROM cloud_save_snapshots').all(), snapshots);
    assert.deepEqual(upgraded.sqlite.prepare('SELECT * FROM installations').all(), []);
    checkIntegrity(upgraded.sqlite);
  } finally { upgraded.sqlite.close(); }
  await backup(data, path.join(directory, 'backup-v12'));
  await restore(path.join(directory, 'backup-v12'), path.join(directory, 'restored-v12'));
  const restored = openStore(path.join(directory, 'restored-v12'));
  try {
    assert.deepEqual(restored.sqlite.prepare('SELECT * FROM cloud_saves').all(), saved);
    assert.deepEqual(restored.sqlite.prepare('SELECT * FROM cloud_save_snapshots').all(), snapshots);
    checkIntegrity(restored.sqlite);
  } finally { restored.sqlite.close(); }
});

test('failed migration rolls back DDL and version, then restart completes once', () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys=ON');
    runMigrations(sqlite);
    const next = CURRENT_SCHEMA_VERSION + 1;
    const failed = [...migrations, { version: next, name: 'injected-failure', up(sql: Database.Database) {
      sql.transaction(() => { sql.exec(`CREATE TABLE injected(id INTEGER); PRAGMA user_version=${next};`); throw new Error('injected interruption'); })();
    } }];
    assert.throws(() => runMigrations(sqlite, failed), /injected interruption/);
    assert.equal(sqlite.pragma('user_version', { simple: true }), CURRENT_SCHEMA_VERSION);
    assert.equal(sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='injected'").get(), undefined);
    assert.equal(sqlite.inTransaction, false);
    const repaired = [...migrations, { version: next, name: 'injected-success', up(sql: Database.Database) {
      sql.transaction(() => sql.exec(`CREATE TABLE injected(id INTEGER); PRAGMA user_version=${next};`))();
    } }];
    runMigrations(sqlite, repaired);
    runMigrations(sqlite, repaired);
    assert.equal(sqlite.pragma('user_version', { simple: true }), next);
  } finally { sqlite.close(); }
});

test('v8 foreign-key failure rolls back, restores enforcement and openStore closes failed handles', (t) => {
  const directory = root(t);
  const sqlite = createHistoricalFixture(directory, 7);
  sqlite.pragma('foreign_keys=OFF');
  sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('orphan', 999, 'csrf', 100);
  sqlite.pragma('foreign_keys=ON');
  assert.throws(() => runMigrations(sqlite), /foreign key validation/);
  assert.equal(sqlite.pragma('user_version', { simple: true }), 7);
  assert.equal(sqlite.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(sqlite.inTransaction, false);
  assert.equal(sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='users_v8'").get(), undefined);
  sqlite.close();
  const originalClose = Database.prototype.close;
  let closes = 0;
  Database.prototype.close = function() { closes++; return originalClose.call(this); };
  try { assert.throws(() => openStore(directory), /foreign key validation/); } finally { Database.prototype.close = originalClose; }
  assert.equal(closes, 1);
  const repair = new Database(path.join(directory, 'platform.sqlite'));
  repair.prepare("DELETE FROM sessions WHERE token_hash='orphan'").run();
  repair.close();
  const restarted = openStore(directory);
  try { assert.equal(restarted.sqlite.pragma('user_version', { simple: true }), CURRENT_SCHEMA_VERSION); checkIntegrity(restarted.sqlite); } finally { restarted.sqlite.close(); }
});

test('a newer schema is refused without downgrade and the handle is closed', (t) => {
  const directory = root(t);
  const store = openStore(directory);
  store.sqlite.pragma(`user_version=${CURRENT_SCHEMA_VERSION + 1}`);
  store.sqlite.close();
  const originalClose = Database.prototype.close;
  let closes = 0;
  Database.prototype.close = function() { closes++; return originalClose.call(this); };
  try { assert.throws(() => openStore(directory), /newer platform version/); } finally { Database.prototype.close = originalClose; }
  assert.equal(closes, 1);
  const reopened = new Database(path.join(directory, 'platform.sqlite'));
  try { assert.equal(reopened.pragma('user_version', { simple: true }), CURRENT_SCHEMA_VERSION + 1); } finally { reopened.close(); }
});

for (const version of HISTORICAL_FIXTURE_VERSIONS) test(`supported v${version} backup validates, upgrades and revokes sessions/previews on restore`, async (t) => {
  assert.ok(SUPPORTED_BACKUP_SCHEMA_VERSIONS.includes(version));
  const directory = root(t);
  createHistoricalFixture(path.join(directory, 'old'), version).close();
  await backup(path.join(directory, 'old'), path.join(directory, 'backup'));
  await restore(path.join(directory, 'backup'), path.join(directory, 'restored'));
  const restored = openStore(path.join(directory, 'restored'));
  try {
    checkRetained(restored.sqlite, version, true);
    checkIntegrity(restored.sqlite);
    assert.equal(restored.sqlite.pragma('user_version', { simple: true }), CURRENT_SCHEMA_VERSION);
    assert.equal((restored.sqlite.prepare("SELECT phase FROM import_jobs WHERE id='fixture-job'").get() as { phase: string }).phase, 'interrupted');
  } finally { restored.sqlite.close(); }
});

test('restore rejects unsupported backup schemas before creating its target', async (t) => {
  const directory = root(t);
  for (const version of [0, CURRENT_SCHEMA_VERSION + 1]) {
    const dataDir = path.join(directory, `source-${version}`);
    const store = openStore(dataDir);
    store.sqlite.pragma(`user_version=${version}`);
    store.sqlite.close();
    const backupDir = path.join(directory, `backup-${version}`);
    const restoreDir = path.join(directory, `restore-${version}`);
    await backup(dataDir, backupDir);
    await assert.rejects(restore(backupDir, restoreDir), /Unsupported database version/);
    assert.equal(fs.existsSync(restoreDir), false);
  }
});

test('restore rejects foreign-key-invalid backups before copying data', async (t) => {
  const directory = root(t);
  const dataDir = path.join(directory, 'source');
  const sqlite = createHistoricalFixture(dataDir, 10);
  sqlite.pragma('foreign_keys=OFF');
  sqlite.exec('UPDATE cloud_saves SET user_id=999');
  sqlite.close();
  const backupDir = path.join(directory, 'backup');
  const restoreDir = path.join(directory, 'restored');
  await backup(dataDir, backupDir);
  await assert.rejects(restore(backupDir, restoreDir), /foreign key check failed/);
  assert.equal(fs.existsSync(restoreDir), false);
});
