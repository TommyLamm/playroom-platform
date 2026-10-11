import { z } from 'zod';
import { saveProgressInput } from './cloud-save.js';

export const emptySdkPayload = z.object({}).strict();
export const finishRunPayload = z.object({ runId: z.string().uuid(), score: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict();
export const sdkPayloads = { startRun: emptySdkPayload, finishRun: finishRunPayload, loadProgress: emptySdkPayload, saveProgress: saveProgressInput };
