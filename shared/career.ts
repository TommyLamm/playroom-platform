import type { Leaderboard } from './manifest.js';

export type RankedScore = { username: string; score: number; achievedAt: string; rank: number };
export type LeaderboardView = {
  board: Leaderboard; entries: RankedScore[]; me: RankedScore | null;
  nextTarget: { rank: number; score: number; gap: number } | null;
};
export type ProgressPoint = {
  runId: string; score: number; finishedAt: string; personalBest: boolean; previousBest: number | null;
};
export type PersonalProgress = {
  gameId: string; board: Leaderboard; totalRuns: number; bestScore: number | null;
  breakthroughs: number; points: ProgressPoint[];
};
export type CareerGame = {
  gameId: string; name: string; published: boolean; opens: number | null; completedRuns: number | null;
  activeMs: number | null; lastPlayedAt: string | null;
  bests: { board: Leaderboard; score: number; rank: number | null }[];
};
export type Career = {
  username: string; games: CareerGame[]; activityVisible: boolean;
  totals: { games: number; opens: number | null; completedRuns: number | null; activeMs: number | null };
};
export type RunResult = {
  id: string; gameId: string; name: string; version: string; boardId: string;
  score: number; unit: string; finishedAt: string;
};
export type ResultsPage = { results: RunResult[]; total: number; page: number; pageSize: number };
