export type ProgressSave = {
  data: Record<string, unknown>; revision: number; formatVersion: number; gameVersion: string; updatedAt: string;
};
export const Playroom: {
  ready(): Promise<{ available: boolean; progressAvailable: boolean; mode: 'authenticated' | 'guest' | 'preview' | 'standalone' }>;
  /** null means no save (or cloud saves unavailable). Preview reads are temporary only. */
  loadProgress(): Promise<ProgressSave | null>;
  /** JSON object <=64 KiB. revision=0 only after a successful empty load. Errors include code (409=conflict). */
  saveProgress(input: { data: Record<string, unknown>; revision: number; formatVersion: number; requestId?: string }): Promise<({ saved: true } & ProgressSave) | null>;
  /** Admin diagnostic previews return a temporary run ID; no account record is created. */
  startRun(): Promise<{ runId: string } | null>;
  /** Diagnostic preview validates the score but always returns null, never saved: true. */
  finishRun(result: { runId: string; score: number }): Promise<{
    saved: true; runId: string; score: number; finishedAt: string;
  } | null>;
};
