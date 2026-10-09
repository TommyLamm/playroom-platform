export type BackupState = {
  status: 'never' | 'running' | 'success' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessAt: string | null;
  error?: string;
};
export type OperationalAnalytics = {
  window: { days: 7 | 30; start: string; end: string; generatedAt: string; timezone: 'UTC' };
  totals: { activePlayers: number; opens: number; completedRuns: number };
  games: { gameId: string; name: string; published: boolean; opens: number; completedRuns: number; activePlayers: number }[];
  submissions: {
    success: number; rejected: number; serverError: number; attempts: number; failureRate: number | null;
    daily: { day: string; success: number; rejected: number; serverError: number }[];
  };
  storage?: { totalBytes: number | null; availableBytes: number | null; dataBytes: number | null; gameBytes: number | null; measuredAt: string };
  backup?: BackupState;
};
