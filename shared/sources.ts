import type { Release, Repository, ImportJob } from './types.js';

export type GitHubOwner = { login: string; kind: 'User' | 'Organization'; createdAt: string };
export type DiscoveredRepository = {
  fullName: string;
  description: string | null;
  archived: boolean;
  fork: boolean;
  added: boolean;
};
export type Source = Repository & {
  archived: boolean;
  checkedAt: string | null;
  checkError: string | null;
  releases: Release[];
  importedReleaseIds: number[];
  gameId: string | null;
  gameName: string | null;
  importedVersion: string | null;
  status: 'unchecked' | 'available' | 'current' | 'unavailable' | 'error' | 'importing';
};
export type BatchItem = {
  repositoryId: number;
  fullName: string;
  releaseId: number;
  jobId: string | null;
  error: string | null;
  status: 'skipped' | 'failed' | 'queued' | 'running' | 'completed';
  phase: string | null;
  gameId: string | null;
  version: string | null;
};
export type ImportBatch = { id: string; createdAt: string; items: BatchItem[] };
export type BatchSummary = {
  id: string;
  createdAt: string;
  total: number;
  completed: number;
  failed: number;
  pending: number;
};
export type ImportSelection = { repositoryId: number; releaseId: number };

// GitHub's list order is not a version ordering. Select by publication date,
// with a deterministic ID tie-breaker; prereleases always require explicit choice.
export function eligibleRelease(release: Release) {
  return (
    !!release.asset && /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/.test(release.tag)
  );
}
export function defaultRelease(releases: Release[], importedIds: number[] = []) {
  const latest = releases
    .filter((r) => !r.prerelease && eligibleRelease(r))
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '') || b.id - a.id)[0];
  return latest && !importedIds.includes(latest.id) ? latest : undefined;
}
export function pendingJob(job: Pick<ImportJob, 'status'>) {
  return job.status === 'queued' || job.status === 'running';
}
