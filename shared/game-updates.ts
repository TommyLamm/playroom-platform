import { defaultRelease } from './sources.js';
import type { Source } from './sources.js';
import type { AdminGame, StoredVersion } from './types.js';

export type SourceCheck = {
  id: string; status: 'running' | 'completed' | 'cancelled';
  total: number; completed: number; failed: number;
  startedAt: string; finishedAt: string | null; retryAt: number | null;
};
export type PublishSelection = {
  gameId: string; version: string; expectedActiveVersion: string | null; expectedPublished: boolean;
};
export type PublishResult = { gameId: string; version: string; status: 'published' | 'skipped' | 'failed'; error: string | null };
// Compare numeric components without overflowing JavaScript's safe integer range.
export function compareVersions(a: string, b: string) {
  const [coreA, ...preA] = a.split('-');
  const [coreB, ...preB] = b.split('-');
  const partsA = coreA.split('.').map(BigInt), partsB = coreB.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (partsA[i] !== partsB[i]) return partsA[i] > partsB[i] ? 1 : -1;
  if (!preA.length || !preB.length) return preA.length === preB.length ? 0 : preA.length ? -1 : 1;
  const idsA = preA.join('-').split('.'), idsB = preB.join('-').split('.');
  for (let i = 0; i < Math.max(idsA.length, idsB.length); i++) {
    if (idsA[i] === undefined || idsB[i] === undefined) return idsA[i] === undefined ? -1 : 1;
    if (idsA[i] === idsB[i]) continue;
    const numericA = /^\d+$/.test(idsA[i]), numericB = /^\d+$/.test(idsB[i]);
    if (numericA && numericB) { const va = BigInt(idsA[i]), vb = BigInt(idsB[i]); if (va === vb) continue; return va > vb ? 1 : -1; }
    if (numericA !== numericB) return numericA ? -1 : 1;
    return idsA[i] > idsB[i] ? 1 : -1;
  }
  return 0;
}
export function updateRelease(source: Source, game?: AdminGame) {
  if (source.archived || source.checkError || source.status === 'importing') return undefined;
  const release = defaultRelease(source.releases, source.importedReleaseIds);
  return release && (!game?.activeVersion || compareVersions(release.tag.slice(1), game.activeVersion) > 0) ? release : undefined;
}
export function pendingVersions(game: AdminGame): StoredVersion[] {
  return game.versions.filter((v) => !v.publishedAt &&
    (!game.activeVersion || compareVersions(v.version, game.activeVersion) > 0));
}
export function pendingVersion(game: AdminGame): StoredVersion | undefined {
  return pendingVersions(game).find((v) => !v.version.includes('-'));
}
