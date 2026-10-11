import { z } from 'zod';
import { gameVersion } from './manifest.js';

export const MAX_SAVE_BYTES = 64 * 1024;
// Walk before serialization: bound nesting and reject values JSON would silently lose.
export const progressData = z.custom<Record<string, unknown>>((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const pending = [{ value, depth: 0 }];
  const seen = new Set<object>();
  while (pending.length) {
    const entry = pending.pop()!;
    const item = entry.value;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue;
    if (typeof item === 'number') { if (!Number.isFinite(item)) return false; continue; }
    if (typeof item !== 'object' || entry.depth > 32 || seen.has(item)) return false;
    seen.add(item);
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return false;
    for (const child of Object.values(item)) pending.push({ value: child, depth: entry.depth + 1 });
  }
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_SAVE_BYTES; }
  catch { return false; }
}, '存檔需為 JSON 物件，最多 64 KiB、32 層');

export const saveProgressInput = z.object({
  data: progressData,
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  formatVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
}).strict();
export const saveProgressRequest = saveProgressInput.extend({ version: gameVersion, requestId: z.string().uuid() });
export const loadProgressQuery = z.object({ version: gameVersion.optional() }).strict();
export const restoreProgressRequest = z.object({
  snapshotId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  requestId: z.string().uuid(),
}).strict();
export const MAX_SAVE_SNAPSHOTS = 20;
export type SaveCompatibilitySummary = {
  status: 'compatible' | 'incompatible' | 'unknown'; total: number; affected: number;
  formats: { formatVersion: number; count: number; compatibility: 'compatible' | 'incompatible' | 'unknown' }[];
};
export type SaveSnapshotList = {
  revision: number;
  snapshots: { id: number; revision: number; formatVersion: number; gameVersion: string;
    updatedAt: string; capturedAt: string; reason: 'migration' | 'restore' }[];
};
export type ProgressSave = {
  data: Record<string, unknown>; revision: number; formatVersion: number;
  gameVersion: string; updatedAt: string;
};
export type SaveProgressInput = z.infer<typeof saveProgressInput>;
