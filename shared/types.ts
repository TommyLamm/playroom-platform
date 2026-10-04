import type { GameManifest } from './manifest.js';

export type PublicGame = GameManifest & { coverUrl: string; playUrl: string; publishedAt: string };
export type Repository = { id: number; fullName: string; createdAt: string };
export type Release = {
  id: number;
  tag: string;
  name: string;
  publishedAt: string | null;
  prerelease: boolean;
  asset: { id: number; name: string; size: number } | null;
};
export type ImportJob = {
  id: string;
  repositoryId: number;
  releaseId: number;
  status: string;
  phase: string;
  error: string | null;
  gameId: string | null;
  version: string | null;
  createdAt: string;
  updatedAt: string;
};
export type StoredVersion = {
  id: number;
  gameId: string;
  version: string;
  manifest: GameManifest;
  sha256: string;
  releaseId: number | null;
  assetId: number | null;
  releaseTag: string | null;
  importedAt: string;
  publishedAt: string | null;
};
export type AdminGame = {
  id: string;
  repositoryId: number | null;
  activeVersion: string | null;
  published: boolean;
  versions: StoredVersion[];
};
