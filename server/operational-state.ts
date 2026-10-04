import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { BackupState } from '../shared/analytics.js';

const date = z.string().datetime().nullable();
const stateSchema = z.object({
  status: z.enum(['never', 'running', 'success', 'failed']),
  startedAt: date, finishedAt: date, lastSuccessAt: date,
  error: z.string().max(160).optional(), ownerPid: z.number().int().positive().optional(),
});
const never: BackupState = { status: 'never', startedAt: null, finishedAt: null, lastSuccessAt: null };

function hasState(sql: Database.Database) {
  return !!sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='operational_state'").get();
}
export function readBackupState(sql: Database.Database): BackupState {
  if (!hasState(sql)) return { ...never };
  const row = sql.prepare("SELECT value FROM operational_state WHERE key='backup'").get() as { value: string } | undefined;
  if (!row) return { ...never };
  try {
    const state = stateSchema.parse(JSON.parse(row.value));
    if (state.status === 'running' && state.ownerPid) {
      try { process.kill(state.ownerPid, 0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
          state.status = 'failed';
          state.finishedAt = new Date().toISOString();
          state.error = '備份程序已中斷，請重新執行備份';
          delete state.ownerPid;
          writeState(sql, state);
        }
      }
    }
    const { ownerPid: _ownerPid, ...publicState } = state;
    return publicState;
  } catch { return { ...never }; }
}
function writeState(sql: Database.Database, state: BackupState & { ownerPid?: number }) {
  if (!hasState(sql)) return;
  sql.prepare("INSERT INTO operational_state (key,value) VALUES ('backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(state));
}
export function recordBackupStart(sql: Database.Database): string {
  const startedAt = new Date().toISOString();
  writeState(sql, { status: 'running', startedAt, finishedAt: null, lastSuccessAt: readBackupState(sql).lastSuccessAt, ownerPid: process.pid });
  return startedAt;
}
export function recordBackupEnd(sql: Database.Database, startedAt: string, success: boolean) {
  const current = readBackupState(sql);
  // A later concurrent attempt owns the dashboard state; never overwrite its progress.
  if (current.startedAt !== startedAt) return;
  const finishedAt = new Date().toISOString();
  writeState(sql, { status: success ? 'success' : 'failed', startedAt, finishedAt,
    lastSuccessAt: success ? finishedAt : current.lastSuccessAt,
    ...(success ? {} : { error: '備份未能完成，請檢查伺服器記錄後重試' }) });
}
export function normalizeBackupSnapshot(sql: Database.Database) {
  const current = readBackupState(sql);
  if (current.status !== 'running') return;
  writeState(sql, { ...current, status: 'failed', finishedAt: new Date().toISOString(),
    error: '快照建立時備份尚未完成，請重新執行備份以更新狀態' });
}
