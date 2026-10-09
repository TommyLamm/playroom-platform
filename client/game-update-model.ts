import type { AdminGame, StoredVersion } from '../shared/types';
import type { Source } from '../shared/sources';
import { defaultRelease } from '../shared/sources';
import { pendingVersion, updateRelease } from '../shared/game-updates';

export const updateLabels = { available: '有新版可匯入', importing: '匯入中', preview: '待預覽確認', ready: '已確認待發布', error: '檢查失敗', manual: '請手動選版本', unchecked: '尚未檢查', unavailable: '無有效正式版', current: '暫無待更新', archived: '已封存' };
export function updateRows(sources: Source[], games: AdminGame[], choices: Record<string, string> = {}) {
  const gameByRepo = new Map(games.map((g) => [g.repositoryId, g]));
  const sourceIds = new Set(sources.map((s) => s.id));
  return [
    ...sources.map((source) => ({ source, game: gameByRepo.get(source.id), key: `repo:${source.id}` })),
    ...games.filter((g) => g.repositoryId === null || !sourceIds.has(g.repositoryId)).map((game) => ({ source: undefined, game, key: `game:${game.id}` })),
  ].map((row) => {
    const draft: StoredVersion | undefined = row.game && (row.game.id in choices
      ? row.game.versions.find((v) => v.version === choices[row.game!.id] && !v.publishedAt) : pendingVersion(row.game));
    const release = row.source && updateRelease(row.source, row.game);
    const state: keyof typeof updateLabels = row.source?.archived ? 'archived' : row.source?.status === 'importing' ? 'importing' : row.source?.checkError ? 'error'
      : draft ? draft.reviewedAt ? 'ready' : 'preview' : release ? 'available'
      : row.game?.versions.some((v) => !v.publishedAt) ? 'manual'
      : row.source && !row.source.checkedAt ? 'unchecked'
      : row.source && !defaultRelease(row.source.releases) ? 'unavailable' : 'current';
    return { ...row, draft, release, state, name: row.game?.versions[0]?.manifest.name || row.source?.fullName || row.game!.id };
  });
}
export const isPendingUpdate = (row: ReturnType<typeof updateRows>[number]) => row.state !== 'current' && row.state !== 'archived';
