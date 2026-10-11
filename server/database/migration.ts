import type Database from 'better-sqlite3';

export interface Migration {
  readonly version: number;
  readonly name: string;
  // Each published migration owns its transaction boundary. v8 additionally owns
  // the foreign_keys OFF/ON ordering around its account-table rebuild.
  up(sqlite: Database.Database): void;
}
