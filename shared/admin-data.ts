import type { StoredVersion, ImportJob, Release } from './types.js';
import type { Source } from './sources.js';

export type Page<T> = { items: T[]; total: number; page: number; size: number };
export type VersionSummary = Omit<StoredVersion, 'manifest'>;
export type AdminGameSummary = {
  id: string; name: string; repositoryId: number | null; repositoryName: string | null;
  activeVersion: string | null; published: boolean;
  latestVersion: string | null; latestImportedAt: string | null;
  versionCount: number; pendingCount: number; defaultDraft: VersionSummary | null;
};
export type UpdateState = 'available' | 'importing' | 'preview' | 'ready' | 'error' | 'manual' | 'unchecked' | 'unavailable' | 'current' | 'archived';
export type UpdateSummary = {
  key: string; name: string; source?: Source; game?: AdminGameSummary;
  draft?: VersionSummary; drafts: VersionSummary[]; release?: Release; state: UpdateState;
};
export type AdminSummary = { games: number; published: number; activeSources: number; pending: number };
export type AdminTasks = { jobs: (ImportJob & { repositoryName: string })[]; pending: number; revision: string };
