import { migrations } from './migrations/index.js';

export const CURRENT_SCHEMA_VERSION = migrations[migrations.length - 1].version;
export const MIN_SUPPORTED_BACKUP_SCHEMA_VERSION = 1;
export const SUPPORTED_BACKUP_SCHEMA_VERSIONS: readonly number[] = Object.freeze(
  migrations.map(({ version }) => version).filter((version) => version >= MIN_SUPPORTED_BACKUP_SCHEMA_VERSION),
);

export function isSupportedBackupSchemaVersion(version: number): boolean {
  return SUPPORTED_BACKUP_SCHEMA_VERSIONS.includes(version);
}
