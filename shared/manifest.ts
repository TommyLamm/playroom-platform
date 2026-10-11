import { z } from 'zod';

export const gameId = z.string().regex(/^[a-z][a-z0-9-]{1,47}$/);
export const gameVersion = z
  .string()
  .max(64)
  .regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/);
export const relativePath = z
  .string()
  .min(1)
  .max(240)
  .refine(isSafePath, 'Must be a portable relative path');

export function isSafePath(value: string): boolean {
  return (
    !/[\\:\x00-\x1f\x7f?#%]/.test(value) &&
    value
      .split('/')
      .every(
        (part) =>
          part !== '' &&
          part !== '.' &&
          part !== '..' &&
          !/[. ]$/.test(part) &&
          !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
      )
  );
}

export const leaderboardSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  order: z.enum(['desc', 'asc']).default('desc'),
  unit: z.string().min(1).max(16).default('分'),
  minScore: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  maxScore: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(Number.MAX_SAFE_INTEGER),
}).strict().refine((value) => value.minScore <= value.maxScore, 'Invalid score range');
export type Leaderboard = z.infer<typeof leaderboardSchema>;

export const cloudSaveDeclaration = z.object({
  readableFormats: z.array(z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)).min(1).max(32),
  writeFormat: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
}).strict().refine((value) => new Set(value.readableFormats).size === value.readableFormats.length && value.readableFormats.includes(value.writeFormat), 'Readable formats must be unique and include writeFormat');

export const manifestSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    id: gameId,
    name: z.string().min(1).max(80),
    version: gameVersion,
    description: z.string().min(1).max(2000),
    author: z.string().min(1).max(100),
    entry: relativePath.refine((v) => /\.html$/i.test(v), 'Entry must be HTML'),
    cover: relativePath.refine(
      (v) => /\.(png|jpe?g|webp|gif)$/i.test(v),
      'Cover must be PNG, JPEG, WebP or GIF',
    ),
    tags: z.array(z.string().min(1).max(24)).max(8),
    instructions: z.string().min(1).max(2000),
    devices: z
      .array(z.enum(['desktop', 'mobile']))
      .min(1)
      .max(2),
    leaderboard: leaderboardSchema.optional(),
    cloudSave: cloudSaveDeclaration.optional(),
  })
  .strict().refine((value) => value.schemaVersion === 2 || !value.cloudSave, 'cloudSave requires schemaVersion 2');

export type GameManifest = z.infer<typeof manifestSchema>;

export function cloudSaveCompatibility(manifest: GameManifest, format: number): 'compatible' | 'incompatible' | 'unknown' {
  return !manifest.cloudSave ? 'unknown' : manifest.cloudSave.readableFormats.includes(format) ? 'compatible' : 'incompatible';
}
