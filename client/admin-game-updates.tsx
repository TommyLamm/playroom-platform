import { useEffect, useState } from 'react';
import { RefreshCw, Download, Play, Upload, Check, Plus, Archive } from 'lucide-react';
import type { AdminGame } from '../shared/types';
import type { ImportSelection, Source } from '../shared/sources';
import { defaultRelease } from '../shared/sources';
import { type SourceCheck, type PublishSelection, type PublishResult } from '../shared/game-updates';
import { api } from './api';
import './admin-game-updates.css';
import { Dialog } from './dialog';
import { AddSources, limited } from './admin-sources';
import { isPendingUpdate, updateLabels as labels, updateRows } from './game-update-model';

type PreviewSelection = { gameId: string; version: string };
export function GameUpdatesPanel({ sources, games, check, onChanged, onCheck, onImport, onPreview, onManualImport }: {
  sources: Source[]; games: AdminGame[]; check: SourceCheck | null;
  onChanged: () => Promise<void>; onCheck: () => Promise<void>;
  onImport: (items: ImportSelection[]) => void; onPreview: (items: PreviewSelection[]) => void;
  onManualImport: (ids: number[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('pending');
  const [owner, setOwner] = useState('');
  const [scope, setScope] = useState('active');
  const [adding, setAdding] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState<{ ids: number[]; archived: boolean } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<PublishSelection[] | null>(null);
  const [results, setResults] = useState<PublishResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rows = updateRows(sources, games, choices);
  const selectable = (r: typeof rows[number]) => !!r.source || !!r.draft;
  const eligibleKeys = rows.filter(selectable).map((r) => r.key).join('|');
  useEffect(() => {
    const keys = new Set(eligibleKeys.split('|'));
    setSelected((values) => values.every((v) => keys.has(v)) ? values : values.filter((v) => keys.has(v)));
  }, [eligibleKeys]);
  const filtered = rows.filter((r) => (scope === 'archived' ? r.source?.archived : !r.source?.archived) &&
    (!owner || r.source?.fullName.split('/')[0] === owner) && `${r.name} ${r.game?.id || ''} ${r.source?.fullName || ''}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (scope === 'archived' || filter === 'all' || filter === 'pending' && isPendingUpdate(r) || filter === r.state));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
  const shownPage = Math.min(page, pageCount);
  const shown = filtered.slice((shownPage - 1) * 25, shownPage * 25);
  const picked = rows.filter((r) => selected.includes(r.key));
  const imports = picked.flatMap((r) => !r.source?.archived && r.source && r.release ? [{ repositoryId: r.source.id, releaseId: r.release.id }] : []);
  const previews = picked.flatMap((r) => !r.source?.archived && r.game && r.draft ? [{ gameId: r.game.id, version: r.draft.version }] : []);
  const publications = picked.flatMap((r) => !r.source?.archived && r.game && r.draft?.reviewedAt ? [{ gameId: r.game.id, version: r.draft.version,
    expectedActiveVersion: r.game.activeVersion, expectedPublished: r.game.published }] : []);
  const toggle = (key: string) => setSelected((values) => values.includes(key) ? values.filter((v) => v !== key) : [...values, key]);
  const activeIds = picked.flatMap((r) => r.source && !r.source.archived ? [r.source.id] : []);
  const archivedIds = picked.flatMap((r) => r.source?.archived ? [r.source.id] : []);
  async function act(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function publish(items: PublishSelection[]) {
    await act(async () => {
      const response = await api<{ results: PublishResult[] }>('/admin/publish-batches', { items });
      setResults(response.results); setConfirm(null);
      await onChanged();
    });
  }
  async function sourceAction(ids: number[], archived?: boolean) {
    await act(async () => {
      setProgress({ done: 0, total: ids.length });
      const failures: string[] = [];
      await limited(ids, async (id) => {
        try { await api(`/admin/repositories/${id}/${archived === undefined ? 'check' : 'state'}`, archived === undefined ? {} : { archived }); }
        catch (e) { failures.push(`${sources.find((s) => s.id === id)?.fullName || id}：${(e as Error).message}`); }
        finally { setProgress((p) => p && { ...p, done: p.done + 1 }); }
      });
      if (archived !== undefined) { setArchiveConfirm(null); setSelected((values) => values.filter((key) => !ids.includes(Number(key.replace('repo:', ''))))); }
      await onChanged();
      if (failures.length) setError(failures.join('；'));
    });
  }
  return <section className="game-updates-panel">
    <div className="source-heading"><div><h2>遊戲更新</h2><p>檢查新版、批量匯入，預覽確認後一次發布。</p></div>
      <div className="source-actions"><button className="button" disabled={busy || check?.status === 'running'} onClick={() => void act(onCheck)}><RefreshCw size={16} />立即檢查</button><button className="button primary" disabled={busy} onClick={() => setAdding(true)}><Plus size={16} />加入來源</button></div></div>
    <p className="update-check-status" aria-live="polite">{check?.status === 'running'
      ? `正在檢查 ${check.completed} / ${check.total} 款${check.retryAt ? `，暫停至 ${new Date(check.retryAt).toLocaleString('zh-HK')}` : ''}`
      : check ? `最近檢查 ${new Date(check.finishedAt || check.startedAt).toLocaleString('zh-HK')} · ${check.failed} 款失敗`
      : '每小時及進入管理後台時自動檢查；匯入和發布由你確認。'}</p>
    {error && <p role="alert" className="update-error">{error}</p>}
    {progress && <p className="update-check-status" role="status">{busy ? '處理中' : '已處理'} {progress.done} / {progress.total} 個來源</p>}
    <div className="update-filters"><label>搜尋遊戲更新<input aria-label="搜尋遊戲更新" placeholder="名稱、遊戲 ID 或 repository" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></label>
      <label>開發者<select aria-label="開發者篩選" value={owner} onChange={(e) => { setOwner(e.target.value); setPage(1); }}><option value="">全部開發者</option>{[...new Set(sources.map((s) => s.fullName.split('/')[0]))].sort().map((o) => <option key={o}>{o}</option>)}</select></label>
      <label>來源範圍<select aria-label="來源範圍" value={scope} onChange={(e) => { setScope(e.target.value); setPage(1); }}><option value="active">使用中／本機遊戲</option><option value="archived">已封存來源</option></select></label>
      <label>更新狀態<select aria-label="更新狀態" disabled={scope === 'archived'} value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
        <option value="pending">全部待處理</option><option value="all">全部遊戲</option>{Object.entries(labels).filter(([key]) => key !== 'archived').map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label></div>
    <div className="update-bulk-actions">
      <button className="button small" disabled={busy} onClick={() => setSelected((values) => [...new Set([...values, ...shown.filter(selectable).map((r) => r.key)])])}>選取本頁</button>
      <button className="button small" disabled={busy || scope === 'archived'} onClick={() => setSelected(filtered.filter((r) => !r.source?.archived && r.draft?.reviewedAt).slice(0, 100).map((r) => r.key))}><Check size={14} />選取全部已確認版本</button>
      <button className="button small" disabled={busy || !selected.length} onClick={() => setSelected([])}>清除選取</button><span>已選 {picked.length} 款（跨頁保留）</span>
      {!!picked.length && <>
      <button className="button" disabled={busy || !imports.length || imports.length > 100} onClick={() => onImport(imports)}><Download size={15} />匯入所選更新（{imports.length}）</button>
      <button className="button" disabled={busy || !previews.length} onClick={() => onPreview(previews)}><Play size={15} />預覽所選版本（{previews.length}）</button>
      <button className="button primary" disabled={busy || !publications.length || publications.length > 100} onClick={() => setConfirm(publications)}><Upload size={15} />發布所選版本（{publications.length}）</button>
      <button className="button small" disabled={busy || !activeIds.length} onClick={() => void sourceAction(activeIds)}><RefreshCw size={14} />檢查所選來源（{activeIds.length}）</button>
      <button className="button small" disabled={busy || !activeIds.length} onClick={() => setArchiveConfirm({ ids: activeIds, archived: true })}><Archive size={14} />封存所選來源（{activeIds.length}）</button>
      {!!archivedIds.length && <button className="button small" disabled={busy} onClick={() => setArchiveConfirm({ ids: archivedIds, archived: false })}>恢復所選來源（{archivedIds.length}）</button>}
      </>}
    </div>
    {(imports.length > 100 || publications.length > 100) && <p role="alert">每批最多 100 款，請減少選取。</p>}
    <div className="table-scroll admin-list-scroll"><table className="game-update-table"><thead><tr><th>選取</th><th>遊戲／來源</th><th>目前上架</th><th>最新正式 Release</th><th>待發布版本</th><th>狀態／操作</th></tr></thead><tbody>
      {shown.map((r) => <tr key={r.key}><td data-label="選取"><input type="checkbox" aria-label={`更新 ${r.name}`} checked={selected.includes(r.key)} disabled={busy || !selectable(r)} onChange={() => toggle(r.key)} /></td>
        <td data-label="遊戲／來源"><strong>{r.name}</strong><small>{r.source?.fullName || '本機遊戲'}</small>{r.source?.checkedAt && <small>檢查：{new Date(r.source.checkedAt).toLocaleString('zh-HK')}</small>}</td>
        <td data-label="目前上架">{r.game?.published ? `v${r.game.activeVersion}` : r.game?.activeVersion ? `未上架（原 v${r.game.activeVersion}）` : '首次上架'}</td>
        <td data-label="最新 Release">{r.source && defaultRelease(r.source.releases)?.tag || '—'}</td>
        <td data-label="待發布版本">{!r.source?.archived && r.game?.versions.some((v) => !v.publishedAt) ? <><select aria-label={`${r.name} 待發布版本`} disabled={busy} value={r.draft?.version || ''} onChange={(e) => { setChoices((values) => ({ ...values, [r.game!.id]: e.target.value })); setSelected((values) => values.filter((v) => v !== r.key)); }}>
          <option value="">手動選擇版本</option>{r.game.versions.filter((v) => !v.publishedAt).map((v) => <option key={v.id} value={v.version}>v{v.version}{v.version.includes('-') ? ' · 預發布' : ''}</option>)}</select>
          {r.draft?.reviewedAt && <small>{r.draft.reviewedBy} · {new Date(r.draft.reviewedAt).toLocaleString('zh-HK')} 確認</small>}</> : '—'}</td>
        <td data-label="狀態／操作"><span className={`badge ${r.state === 'ready' ? 'green' : r.state === 'error' ? 'red' : ['available', 'preview', 'manual'].includes(r.state) ? 'amber' : 'neutral'}`}>{labels[r.state]}</span>{r.source?.checkError && <small className="update-error">{r.source.checkError}</small>}
          <div className="update-row-actions">{!r.source?.archived && r.game && r.draft && <button className="button small" disabled={busy} onClick={() => onPreview([{ gameId: r.game!.id, version: r.draft!.version }])}>預覽</button>}
            {!r.source?.archived && r.game && r.draft?.reviewedAt && <button className="button small" disabled={busy} onClick={() => void act(async () => { await api(`/admin/games/${r.game!.id}/review`, { version: r.draft!.version, approved: false }); await onChanged(); })}>撤銷確認</button>}
            {r.source && (r.source.archived ? <button className="button small" disabled={busy} onClick={() => setArchiveConfirm({ ids: [r.source!.id], archived: false })}>恢復來源</button> : <><button className="button small" disabled={busy} onClick={() => onManualImport([r.source!.id])}>選其他 Release</button><button className="icon-button" aria-label={`檢查 ${r.source.fullName}`} title="檢查 Release" disabled={busy} onClick={() => void sourceAction([r.source!.id])}><RefreshCw size={14} /></button><button className="icon-button" aria-label={`封存 ${r.source.fullName}`} title="封存來源" disabled={busy} onClick={() => setArchiveConfirm({ ids: [r.source!.id], archived: true })}><Archive size={14} /></button></>)}</div></td></tr>)}
    </tbody></table></div>
    {!shown.length && <p className="update-empty">沒有符合條件的遊戲更新。</p>}
    <div className="update-pagination"><button className="button small" disabled={shownPage <= 1} onClick={() => setPage(shownPage - 1)}>上一頁</button><span>{shownPage} / {pageCount} · {filtered.length} 款</span><button className="button small" disabled={shownPage >= pageCount} onClick={() => setPage(shownPage + 1)}>下一頁</button></div>
    {results.length > 0 && <div className="update-results" aria-live="polite"><h3>發布結果</h3>{results.map((r) => <p key={r.gameId}>{games.find((g) => g.id === r.gameId)?.versions[0].manifest.name || r.gameId} · v{r.version}：{r.status === 'published' ? '已發布' : r.status === 'skipped' ? '已是此版本，略過' : r.error}</p>)}
      {results.some((r) => r.status === 'failed') && <p>請刷新並重新確認失敗項目，再選取發布；已成功項目不需重做。</p>}</div>}
    {adding && <Dialog title="加入遊戲來源" wide onClose={() => setAdding(false)}><AddSources known={sources} onAdded={async () => { await onChanged(); }} /></Dialog>}
    {archiveConfirm && <Dialog title={archiveConfirm.archived ? '封存遊戲來源' : '恢復遊戲來源'} closeDisabled={busy} onClose={() => { if (!busy) setArchiveConfirm(null); }}><p>{archiveConfirm.archived ? '以下來源將停止檢查更新。已匯入的遊戲、版本及上架狀態會保留。' : '以下來源將重新加入更新檢查。'}</p><ul className="update-confirm-list">{archiveConfirm.ids.map((id) => <li key={id}>{sources.find((s) => s.id === id)?.fullName || id}</li>)}</ul><div className="dialog-actions"><button className="button" disabled={busy} onClick={() => setArchiveConfirm(null)}>取消</button><button className="button primary" disabled={busy} onClick={() => void sourceAction(archiveConfirm.ids, archiveConfirm.archived)}>{busy ? '處理中…' : '確認'}</button></div></Dialog>}
    {confirm && <Dialog title={`確認批量發布 ${confirm.length} 款遊戲`} closeDisabled={busy} onClose={() => { if (!busy) setConfirm(null); }}>
      <ul className="update-confirm-list">{confirm.map((item) => <li key={item.gameId}><strong>{games.find((g) => g.id === item.gameId)?.versions[0].manifest.name || item.gameId}</strong>：{item.expectedPublished ? `v${item.expectedActiveVersion}` : item.expectedActiveVersion ? '重新上架' : '首次上架'} → v{item.version}</li>)}</ul>
      <p>僅發布以上已確認版本；其他管理者若修改上架狀態，該款會停止並提示重新確認。</p><div className="dialog-actions"><button className="button" disabled={busy} onClick={() => setConfirm(null)}>取消</button><button className="button primary" disabled={busy} onClick={() => void publish(confirm)}>{busy ? '發布中…' : '確認發布'}</button></div>
      {error && <p className="update-error" role="alert">{error}</p>}
    </Dialog>}
  </section>;
}
