import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Gamepad2, Play, History, Upload, Pause, Search } from 'lucide-react';
import type { AdminGame, Repository, StoredVersion } from '../shared/types';
import { Dialog } from './dialog';

const date = (value: string) => new Date(value).toLocaleString('zh-HK');
const name = (game: AdminGame) => game.versions[0]?.manifest.name || game.id;
const versionStatus = (game: AdminGame, version: StoredVersion) =>
  game.published && game.activeVersion === version.version ? '目前上架' : version.publishedAt ? '歷史版本' : version.reviewedAt ? '已確認待發布' : '待預覽確認';

export function AdminGames({ games, repositories, onPreview, onPublish, onUnpublish, onRevokeReview, onImport }: {
  games: AdminGame[]; repositories: Repository[];
  onPreview: (game: AdminGame, version: string) => void;
  onPublish: (game: AdminGame, version: string) => void;
  onUnpublish: (game: AdminGame) => void;
  onRevokeReview: (game: AdminGame, version: string) => void;
  onImport: () => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const repo = (game: AdminGame) => repositories.find((r) => r.id === game.repositoryId)?.fullName;
  const filtered = games.filter((g) => `${name(g)} ${g.id} ${repo(g) || ''}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (status === 'all' || status === 'published' && g.published || status === 'unpublished' && !g.published || status === 'pending' && g.versions.some((v) => !v.publishedAt)))
    .sort((a, b) => (sort === 'recent' ? (b.versions[0]?.importedAt || '').localeCompare(a.versions[0]?.importedAt || '') : name(a).localeCompare(name(b), 'zh-HK')) || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const shownPage = Math.min(page, pages);
  const shown = filtered.slice((shownPage - 1) * size, shownPage * size);
  const game = games.find((g) => g.id === selectedId);
  return <section className="admin-games-panel" aria-label="遊戲與版本列表">
    <div className="admin-panel-heading"><div><h2>遊戲與版本</h2><p>搜尋遊戲，管理上架狀態與歷史版本。</p></div><span className="badge neutral">{games.length} 款遊戲</span></div>
    <div className="admin-list-filters">
      <label className="admin-search">搜尋遊戲<span><Search size={16} /><input aria-label="搜尋管理遊戲" placeholder="名稱、遊戲 ID 或 repository" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></span></label>
      <label>遊戲狀態<select aria-label="遊戲狀態" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="all">全部遊戲</option><option value="published">已上架</option><option value="unpublished">未上架</option><option value="pending">有待發布版本</option></select></label>
      <label>排序<select aria-label="遊戲排序" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}><option value="name">名稱</option><option value="recent">最近匯入</option></select></label>
    </div>
    <div className="admin-list-scroll"><table className="admin-games-table"><thead><tr><th>遊戲／來源</th><th>狀態</th><th>目前上架</th><th>最新匯入</th><th>待發布</th><th>操作</th></tr></thead><tbody>
      {shown.map((g) => <tr key={g.id}>
        <td data-label="遊戲／來源"><div className="admin-game-cell"><span className="game-mini-icon"><Gamepad2 size={20} /></span><div><strong>{name(g)}</strong><small>{repo(g) || '本機遊戲'}</small><small>{g.id}</small></div></div></td>
        <td data-label="狀態"><span className={`badge ${g.published ? 'green' : 'neutral'}`}>{g.published ? '已上架' : '未上架'}</span></td>
        <td data-label="目前上架">{g.published ? `v${g.activeVersion}` : '—'}</td>
        <td data-label="最新匯入">v{g.versions[0]?.version}<small>{g.versions[0] && date(g.versions[0].importedAt)}</small></td>
        <td data-label="待發布">{g.versions.filter((v) => !v.publishedAt).length} 個版本</td>
        <td data-label="操作"><button className="button small" aria-label={`管理版本 ${name(g)}`} onClick={() => setSelectedId(g.id)}>管理版本</button></td>
      </tr>)}
    </tbody></table>
      {!shown.length && <div className="admin-list-empty"><Gamepad2 size={28} /><h3>{games.length ? '沒有符合條件的遊戲' : '準備好第一款遊戲了嗎？'}</h3><p>{games.length ? '調整搜尋或篩選條件。' : '從 GitHub Release 匯入你的第一款遊戲。'}</p>{!games.length && <button className="button primary" onClick={onImport}>匯入遊戲</button>}</div>}
    </div>
    <div className="admin-pagination"><span>{filtered.length} 款 · 第 {shownPage} / {pages} 頁</span><label>每頁<select aria-label="每頁遊戲數量" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }}>{[20, 50, 100].map((n) => <option key={n} value={n}>{n} 款</option>)}</select></label><button className="button small" disabled={shownPage <= 1} onClick={() => setPage(shownPage - 1)}>上一頁</button><button className="button small" disabled={shownPage >= pages} onClick={() => setPage(shownPage + 1)}>下一頁</button></div>
    {game && <Dialog drawer title={`管理版本 · ${name(game)}`} onClose={() => setSelectedId(null)}><GameVersions key={game.id} game={game} repository={repo(game)} onPreview={(v) => onPreview(game, v)} onPublish={(v) => onPublish(game, v)} onUnpublish={() => onUnpublish(game)} onRevokeReview={(v) => onRevokeReview(game, v)} /></Dialog>}
  </section>;
}

function GameVersions({ game, repository, onPreview, onPublish, onUnpublish, onRevokeReview }: {
  game: AdminGame; repository?: string; onPreview: (version: string) => void;
  onPublish: (version: string) => void; onUnpublish: () => void; onRevokeReview: (version: string) => void;
}) {
  const [version, setVersion] = useState(game.published && game.activeVersion || game.versions[0]?.version);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const selected = game.versions.find((v) => v.version === version) || game.versions[0];
  const filtered = game.versions.filter((v) => v.version.toLowerCase().includes(query.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const shownPage = Math.min(page, pages);
  if (!selected) return <p>沒有可管理的版本。</p>;
  const current = game.published && game.activeVersion === selected.version;
  return <div className="game-version-panel">
    <div className="game-version-intro"><span className={`badge ${game.published ? 'green' : 'neutral'}`}>{game.published ? '已上架' : '未上架'}</span><p>{repository || '本機遊戲'} · {game.id}</p>{game.published && <Link className="button small" to={`/games/${game.id}`}><ExternalLink size={14} />開啟遊戲頁</Link>}</div>
    <label>搜尋版本<input aria-label="搜尋版本" placeholder="例如 1.2.0" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></label>
    <div className="version-picker"><table><thead><tr><th>選取版本</th><th>狀態</th><th>匯入時間</th></tr></thead><tbody>{filtered.slice((shownPage - 1) * 10, shownPage * 10).map((v) => <tr key={v.id} className={v.version === selected.version ? 'selected' : ''}><td><label><input type="radio" name={`version-${game.id}`} aria-label={`v${v.version}`} checked={selected.version === v.version} onChange={() => setVersion(v.version)} />v{v.version}</label></td><td>{versionStatus(game, v)}</td><td>{date(v.importedAt)}</td></tr>)}</tbody></table>{!filtered.length && <p className="admin-list-empty">沒有符合條件的版本。</p>}</div>
    <div className="admin-pagination"><span>{filtered.length} 個版本 · {shownPage} / {pages}</span><button className="button small" disabled={shownPage <= 1} onClick={() => setPage(shownPage - 1)}>上一頁版本</button><button className="button small" disabled={shownPage >= pages} onClick={() => setPage(shownPage + 1)}>下一頁版本</button></div>
    <section className="selected-version"><h3>v{selected.version}<span className="badge neutral">{versionStatus(game, selected)}</span></h3><p>{selected.reviewedAt ? `${selected.reviewedBy} · ${date(selected.reviewedAt)} 確認通過` : '尚未預覽確認；首次發布前需實際驗收。'}</p>
      <div className="version-actions"><button className="button" onClick={() => onPreview(selected.version)}><Play size={15} />預覽</button>{current ? <button className="button danger-text" onClick={onUnpublish}><Pause size={15} />下架</button> : <button className="button primary" disabled={!selected.publishedAt && !selected.reviewedAt} title={!selected.publishedAt && !selected.reviewedAt ? '請先預覽並確認通過' : undefined} onClick={() => onPublish(selected.version)}>{selected.publishedAt ? <History size={15} /> : <Upload size={15} />}{selected.publishedAt ? '回退到此版本' : '發布'}</button>}{selected.reviewedAt && <button className="button small" onClick={() => onRevokeReview(selected.version)}>撤銷確認</button>}</div>
      <details className="version-details"><summary>版本來源與校驗</summary><dl><dt>Release</dt><dd>{selected.releaseTag || '本機匯入'}</dd><dt>SHA-256</dt><dd className="checksum">{selected.sha256}</dd><dt>匯入時間</dt><dd>{date(selected.importedAt)}</dd></dl></details>
    </section>
  </div>;
}
