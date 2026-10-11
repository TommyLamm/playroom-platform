import { z } from 'zod';
import { gameId, gameVersion } from './manifest.js';
import { userRoleSchema, type ManagedAccount } from './account.js';
import type { StoredVersion } from './types.js';
import type { ErrorCode, ErrorDetails } from './errors.js';

export const expectedGameState = z.object({
  expectedActiveVersion: gameVersion.nullable(), expectedPublished: z.boolean(),
}).strict();
export const publishRequest = expectedGameState.extend({ version: gameVersion }).strict();
export const unpublishRequest = expectedGameState;
export const reviewRequest = z.object({ version: gameVersion, approved: z.boolean() }).strict();
export const previewRequest = z.object({ version: gameVersion }).strict();
export const publishSelection = publishRequest.extend({ gameId }).strict();
export const publishBatchRequest = z.object({ items: z.array(publishSelection).min(1).max(100)
  .refine((values) => new Set(values.map((v) => v.gameId)).size === values.length) }).strict();
export const roleChangeRequest = z.object({ role: userRoleSchema, expectedRole: userRoleSchema }).strict();
export type ExpectedGameState = z.infer<typeof expectedGameState>;
export type PublishSelection = z.infer<typeof publishSelection>;
export type PublishStatus = 'published' | 'skipped';
export type PublishResult = {
  gameId: string; version: string; status: PublishStatus | 'failed'; error: string | null;
  code: ErrorCode | null; details?: ErrorDetails;
};
export const commandRequests = {
  publish: publishRequest, unpublish: unpublishRequest, review: reviewRequest, preview: previewRequest,
  publishBatch: publishBatchRequest, roleChange: roleChangeRequest,
};
export type CommandName = keyof typeof commandRequests;
export type CommandInput<K extends CommandName> = z.infer<typeof commandRequests[K]>;
export type CommandResponses = {
  publish: { ok: true; status: PublishStatus };
  unpublish: { ok: true; status: 'unpublished' | 'skipped' };
  review: { version: StoredVersion };
  preview: { url: string; expiresAt: number };
  publishBatch: { results: PublishResult[] };
  roleChange: { account: ManagedAccount };
};
