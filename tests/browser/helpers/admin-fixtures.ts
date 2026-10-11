import type { Page } from '@playwright/test';
import type { AdminGame } from '../../../shared/types';
import type { Source } from '../../../shared/sources';
import type { AdminGameSummary } from '../../../shared/admin-data';
import { pendingVersions } from '../../../shared/game-updates';
import { updateRows, isPendingUpdate } from '../../../client/game-update-model';

const withoutManifest = ({ manifest: _manifest, ...version }: AdminGame['versions'][number]) => version;
export function gameSummary(game: AdminGame, sources: Source[]): AdminGameSummary {
  return { id: game.id, name: game.versions[0]?.manifest.name || game.id, repositoryId: game.repositoryId,
    repositoryName: sources.find((source) => source.id === game.repositoryId)?.fullName || null,
    activeVersion: game.activeVersion, published: game.published, latestVersion: game.versions[0]?.version || null,
    latestImportedAt: game.versions[0]?.importedAt || null, versionCount: game.versions.length,
    pendingCount: game.versions.filter((v) => !v.publishedAt).length,
    defaultDraft: pendingVersions(game).find((v) => !v.version.includes('-')) ? withoutManifest(pendingVersions(game).find((v) => !v.version.includes('-'))!) : null };
}
export async function mockAdminData(page: Page, games: () => AdminGame[] = () => [], sources: () => Source[] = () => []) {
  await page.route(/\/api\/v1\/admin\/(games(?:\/.*)?|source-list(?:\/.*)?|source-selection|source-owners|update-candidates(?:\/selection)?|summary)(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/api/v1/admin/', '');
    if (route.request().method() !== 'GET' && !['update-candidates/selection', 'source-selection'].includes(path)) return route.continue();
    const allGames = games(), allSources = sources(), query = url.searchParams;
    const q = (query.get('q') || '').toLowerCase(), status = query.get('status') || 'all', scope = query.get('scope') || 'active', owner = query.get('owner') || '';
    const rows = () => updateRows(allSources, allGames).map((row) => ({ ...row, game: row.game && gameSummary(row.game, allSources), draft: row.draft && withoutManifest(row.draft), drafts: row.drafts.map(withoutManifest) }));
    const paged = (items: unknown[], defaultSize: number) => { const size = Number(query.get('size') || defaultSize), current = Math.min(Number(query.get('page') || 1), Math.max(1, Math.ceil(items.length / size))); return { items: items.slice((current - 1) * size, current * size), total: items.length, page: current, size }; };
    let json: unknown;
    if (path === 'summary') json = { games: allGames.length, published: allGames.filter((g) => g.published).length, activeSources: allSources.filter((s) => !s.archived).length, pending: rows().filter((row) => row.state !== 'current' && row.state !== 'archived').length };
    else if (path === 'source-owners') json = { owners: [...new Set(allSources.map((s) => s.fullName.split('/')[0]))].sort() };
    else if (path === 'source-selection') { const { ids } = route.request().postDataJSON(); json = { items: allSources.filter((source) => ids.includes(source.id)) }; }
    else if (path === 'update-candidates/selection') {
      const { keys, choices = {} } = route.request().postDataJSON();
      json = { items: rows().filter((row) => keys.includes(row.key)).map((row) => row.game && row.game.id in choices ? { ...row, draft: row.drafts.find((v) => v.version === choices[row.game!.id]) } : row) };
    } else if (path === 'update-candidates') json = paged(rows().filter((row) => (scope === 'archived' ? row.source?.archived : !row.source?.archived) && (!owner || row.source?.fullName.split('/')[0] === owner) && `${row.name} ${row.game?.id || ''} ${row.source?.fullName || ''}`.toLowerCase().includes(q) && (status === 'all' || status === 'pending' && isPendingUpdate(row as ReturnType<typeof updateRows>[number]) || status === row.state)), 25);
    else if (path === 'source-list') json = paged(allSources.filter((s) => `${s.fullName} ${s.gameName || ''}`.toLowerCase().includes(q) && (scope === 'all' || (scope === 'archived' ? s.archived : !s.archived))), 25);
    else if (path.startsWith('source-list/')) json = { source: allSources.find((source) => source.id === Number(path.split('/')[1])) };
    else if (path === 'games') json = paged(allGames.map((game) => gameSummary(game, allSources)).filter((g) => `${g.name} ${g.id} ${g.repositoryName || ''}`.toLowerCase().includes(q) && (status === 'all' || status === 'published' && g.published || status === 'unpublished' && !g.published || status === 'pending' && g.pendingCount > 0)).sort((a, b) => (query.get('sort') === 'recent' ? (b.latestImportedAt || '').localeCompare(a.latestImportedAt || '') : a.name.localeCompare(b.name, 'zh-HK')) || a.id.localeCompare(b.id)), 20);
    else {
      const [, id, part, version] = path.split('/'), game = allGames.find((g) => g.id === id)!;
      if (part === 'versions' && version) json = { game: gameSummary(game, allSources), version: game.versions.find((v) => v.version === version) };
      else if (part === 'versions') json = paged(game.versions.filter((v) => v.version.toLowerCase().includes(q)).map(withoutManifest), 10);
      else json = { game: gameSummary(game, allSources) };
    }
    await route.fulfill({ json });
  });
}
