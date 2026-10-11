import type Database from 'better-sqlite3';

function quoted(name: string): string { return `'${name.replaceAll("'", "''")}'`; }

/** Actual SQLite metadata, including index collation, sort order and CHECK SQL. */
export function inspectSchema(sqlite: Database.Database) {
  const tables = sqlite.prepare("SELECT name, sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string; sql: string }[];
  return tables.map(({ name, sql }) => ({
    name,
    sql: sql.replace(/\s+/g, ' ').trim(),
    columns: sqlite.pragma(`table_info(${quoted(name)})`),
    foreignKeys: sqlite.pragma(`foreign_key_list(${quoted(name)})`),
    indexes: (sqlite.pragma(`index_list(${quoted(name)})`) as { name: string; unique: number; origin: string; partial: number }[])
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))
      .map(({ name: indexName, unique, origin, partial }) => ({
        name: indexName, unique, origin, partial,
        columns: sqlite.pragma(`index_xinfo(${quoted(indexName)})`),
      })),
  }));
}
