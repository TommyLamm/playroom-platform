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

export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
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
  })
  .strict();

export type GameManifest = z.infer<typeof manifestSchema>;
