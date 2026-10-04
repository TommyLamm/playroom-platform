import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Session } from '../shared/account';
import type { Leaderboard } from '../shared/manifest';
import type { Career, LeaderboardView, ResultsPage } from '../shared/career';
import { api, ApiError } from './api';
import { PersonalProgressSection } from './progress';

const time = (value: string) => new Intl.DateTimeFormat('zh-HK', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const duration = (ms: number) => `${Math.floor(ms / 3600000)} 小時 ${Math.floor(ms / 60000) % 60} 分 ${Math.floor(ms / 1000) % 60} 秒`;

export function LeaderboardPanel({ gameId, activeBoardId }: { gameId: string; activeBoardId?: string }) {
  const [boards, setBoards] = useState<Leaderboard[] | null>(null);
  const [selected, setSelected] = useState(activeBoardId ?? '');
  const [view, setView] = useState<LeaderboardView | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setBoards(null); setError(''); setSelected(activeBoardId ?? ''); setView(null);
    void api<{ boards: Leaderboard[]; activeBoardId: string | null }>(`/games/${gameId}/leaderboards`).then((data) => {
      if (cancelled) return;
      setBoards(data.boards);
      setSelected(data.activeBoardId ?? data.boards[0]?.id ?? '');
    }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [gameId, activeBoardId, refresh]);
  useEffect(() => {
    let cancelled = false;
    setView(null);
    if (selected) void api<LeaderboardView>(`/games/${gameId}/leaderboards/${selected}`).then((data) => {
      if (!cancelled) setView(data);
    }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [gameId, selected, refresh]);
  return <section className="career-section" id="leaderboard">
    <div className="section-heading"><h2>玩家排行榜</h2>
      <button className="button secondary small" onClick={() => setRefresh((n) => n + 1)}>重新整理排行榜</button>
    </div>
    <p className="muted">每位玩家的最佳成績 · 同分並列 · 休閒排行榜</p>
    {error ? <p role="alert">{error}</p> : boards === null ? <p role="status">排行榜載入中…</p> : !boards.length ?
      <p>此遊戲尚未接入成績排行榜</p> : <>
        <label className="career-filter">榜單<select aria-label="選擇榜單" value={selected} onChange={(e) => { setError(''); setSelected(e.target.value); }}>
          {boards.map((board) => <option key={board.id} value={board.id}>{board.id}{board.id === activeBoardId ? '（目前）' : ''} · {board.order === 'asc' ? '越低越好' : '越高越好'}</option>)}
        </select></label>
        {!view ? <p role="status">成績載入中…</p> : <>
          {view.me && <p className="personal-rank">你的最佳成績：{view.me.score} {view.board.unit} · 第 {view.me.rank} 名</p>}
          {view.me && <p className="rank-next-target">{view.me.rank === 1 ? (view.entries.filter((entry) => entry.rank === 1).length > 1 ? '你與其他玩家並列第一名。' : '你已位居第一名。') : view.nextTarget ?
            `距離並列第 ${view.nextTarget.rank} 名還差 ${view.nextTarget.gap} ${view.board.unit}：${view.board.order === 'asc' ? '將成績減少至' : '將成績提高至'} ${view.nextTarget.score} ${view.board.unit} 即可達到目前該組玩家的分數。同分會並列，名次會隨其他玩家的新成績變動。` : '暫無更高名次的成績可供比較。'}</p>}
          {!view.entries.length ? <p>還沒有成績，成為第一位挑戰者吧。</p> :
            <div className="career-table-wrap"><table className="career-table"><thead><tr><th>名次</th><th>玩家</th><th>最佳成績</th><th>達成時間</th></tr></thead>
              <tbody>{view.entries.map((entry) => <tr key={entry.username}><td>{entry.rank}</td><td><Link to={`/players/${encodeURIComponent(entry.username)}`}>{entry.username}</Link></td><td>{entry.score} {view.board.unit}</td><td>{time(entry.achievedAt)}</td></tr>)}</tbody>
            </table></div>}
        </>}
      </>}
  </section>;
}

export function CareerPage({ session }: { session: Session | null }) {
  const { username = '' } = useParams();
  const [careerData, setCareer] = useState<Career | null>(null);
  const [careerScope, setCareerScope] = useState('');
  const [results, setResults] = useState<ResultsPage | null>(null);
  const [error, setError] = useState('');
  const [resultsError, setResultsError] = useState('');
  const [gameId, setGameId] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const own = !!session?.authenticated && session.username.toLowerCase() === username.toLowerCase();
  const scope = `${username.toLowerCase()}:${session?.authenticated ? `${session.username}:${session.csrf}` : 'guest'}`;
  const career = careerScope === scope ? careerData : null;
  useEffect(() => {
    const request = new AbortController();
    setCareer(null); setError(''); setGameId(''); setPage(1);
    void api<Career>(`/players/${encodeURIComponent(username)}/career`, undefined, { signal: request.signal }).then((data) => {
      if (!request.signal.aborted) { setCareer(data); setCareerScope(scope); }
    }).catch((e: Error) => {
      if (!request.signal.aborted) setError(e instanceof ApiError && e.status === 404 ? '此玩家的遊戲生涯未公開或不存在。' : e.message);
    });
    return () => request.abort();
  }, [username, scope, refresh]);
  useEffect(() => {
    let cancelled = false;
    setResults(null); setResultsError('');
    if (own) void api<ResultsPage>(`/me/results?page=${page}${gameId ? `&gameId=${encodeURIComponent(gameId)}` : ''}`).then((data) => {
      if (!cancelled) setResults(data);
    }).catch((e: Error) => { if (!cancelled) setResultsError(e.message); });
    return () => { cancelled = true; };
  }, [own, username, session?.authenticated ? session.csrf : '', gameId, page, refresh]);
  return <main className="page career-page">
    <Link className="back-link" to="/">← 返回遊戲大廳</Link>
    <div className="section-heading"><h1>{username} 的遊戲生涯</h1><button className="button secondary small" onClick={() => setRefresh((n) => n + 1)}>重新整理生涯</button></div>
    <p className="muted">生涯依玩家設定的範圍公開；逐局成績與進步趨勢只有本人可以查看。</p>
    {error ? <p role="alert">{error}</p> : !career ? <p role="status">生涯載入中…</p> : <>
      <div className="career-stats">
        <div><strong>{career.totals.games}</strong><span>玩過的遊戲</span></div>
        {career.activityVisible && career.totals.opens !== null && <div><strong>{career.totals.opens}</strong><span>開啟次數</span></div>}
        {career.activityVisible && career.totals.completedRuns !== null && <div><strong>{career.totals.completedRuns}</strong><span>完成局數</span></div>}
        {career.activityVisible && career.totals.activeMs !== null && <div><strong>{duration(career.totals.activeMs)}</strong><span>估計活躍時間</span></div>}
      </div>
      {!career.activityVisible && <p className="muted">活躍記錄未公開。</p>}
      <section className="career-section"><h2>玩過的遊戲</h2>
        {!career.games.length ? <p>還沒有遊戲記錄。登入後開始遊玩，就能累積你的生涯。</p> :
          <div className="career-games">{career.games.map((game) => <article className="career-game" key={game.gameId}>
            <h3>{game.published ? <Link to={`/games/${game.gameId}`}>{game.name}</Link> : `${game.name}（已下架）`}</h3>
            {career.activityVisible && game.opens !== null && game.completedRuns !== null && game.activeMs !== null && <p>開啟 {game.opens} 次 · 完成 {game.completedRuns} 局 · {duration(game.activeMs)}</p>}
            {career.activityVisible && game.lastPlayedAt !== null && <p className="muted">最近遊玩：{time(game.lastPlayedAt)}</p>}
            {game.bests.map((best) => <p key={best.board.id}>榜單 {best.board.id}：最佳 {best.score} {best.board.unit}{best.rank !== null ? ` · 第 ${best.rank} 名` : ''}</p>)}
            {!game.bests.length && <p className="muted">尚未保存逐局成績</p>}
          </article>)}</div>}
      </section>
      {own && career.username.toLowerCase() === username.toLowerCase() && <PersonalProgressSection key={`${username.toLowerCase()}:${session?.authenticated ? session.csrf : ''}`} games={career.games} />}
      {own && career.username.toLowerCase() === username.toLowerCase() && <section className="career-section"><h2>我的逐局成績</h2>
        <label className="career-filter">篩選遊戲<select aria-label="篩選逐局遊戲" value={gameId} onChange={(e) => { setGameId(e.target.value); setPage(1); }}>
          <option value="">全部遊戲</option>{career.games.map((g) => <option key={g.gameId} value={g.gameId}>{g.name}</option>)}
        </select></label>
        {resultsError ? <p role="alert">{resultsError}</p> : !results ? <p role="status">成績載入中…</p> : !results.results.length ? <p>還沒有完成的局次。成績需要遊戲支援回報。</p> : <>
          <div className="career-table-wrap"><table className="career-table"><thead><tr><th>遊戲</th><th>成績</th><th>版本／榜單</th><th>完成時間</th></tr></thead>
            <tbody>{results.results.map((r) => <tr key={r.id}><td>{r.name}</td><td>{r.score} {r.unit}</td><td>v{r.version} / {r.boardId}</td><td>{time(r.finishedAt)}</td></tr>)}</tbody>
          </table></div>
          <div className="career-pagination"><button className="button secondary small" disabled={page === 1} onClick={() => setPage((n) => n - 1)}>上一頁</button><span>第 {page} 頁 · 共 {results.total} 局</span><button className="button secondary small" disabled={page * results.pageSize >= results.total} onClick={() => setPage((n) => n + 1)}>下一頁</button></div>
        </>}
      </section>}
    </>}
  </main>;
}
