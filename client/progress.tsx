import { useEffect, useId, useState } from 'react';
import type { CareerGame, PersonalProgress } from '../shared/career';
import { api } from './api';
import './progress.css';

const formatTime = (value: string) => new Intl.DateTimeFormat('zh-HK', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const pointLabel = (point: PersonalProgress['points'][number]) => point.previousBest === null ? '首次成績' : point.personalBest ? '突破個人最佳' : '一般成績';

function ScoreTrend({ progress }: { progress: PersonalProgress }) {
  const descriptionId = useId();
  const { points, board } = progress;
  if (!points.length) return <p>此榜單還沒有完成的局次。開始遊玩並保存成績後，就會顯示你的進步。</p>;
  const scores = points.map((point) => point.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const width = 720;
  const height = 260;
  const left = 100;
  const right = width - 24;
  const top = 26;
  const bottom = height - 48;
  const x = (index: number) => points.length === 1 ? (left + right) / 2 : left + (right - left) * index / (points.length - 1);
  const y = (score: number) => min === max ? (top + bottom) / 2 : bottom - (bottom - top) * (score - min) / (max - min);
  const line = points.map((point, index) => `${x(index)},${y(point.score)}`).join(' ');
  const recentChange = points[points.length - 1].score - points[0].score;
  const improved = board.order === 'asc' ? recentChange < 0 : recentChange > 0;
  const shortScore = (score: number) => new Intl.NumberFormat('zh-HK', { notation: 'compact', maximumFractionDigits: 1 }).format(score);
  return <>
    <p className="progress-caption" id={descriptionId}>
      最近 {points.length} 局，按完成時間由左至右排列；{board.order === 'asc' ? '越低越好' : '越高越好'}，單位為{board.unit}。
      {points.length === 1 ? '目前只有一局，保存更多成績後可查看趨勢。' : recentChange === 0 ? '最近一局與圖中第一局同分。' : `最近一局較圖中第一局${improved ? '改善' : '落後'} ${Math.abs(recentChange)} ${board.unit}。`}
    </p>
    <div className="progress-chart-wrap">
      <svg className="progress-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="近期成績趨勢" aria-describedby={descriptionId}>
        <title>近期成績趨勢</title>
        <desc>折線代表每局成績，金色標記代表突破個人最佳。完整分數、時間及突破記錄列於下方表格。</desc>
        {[min, ...(min === max ? [] : [max])].map((score) => <g key={score}>
          <line x1={left} x2={right} y1={y(score)} y2={y(score)} className="progress-grid-line" />
          <text x={left - 12} y={y(score) + 5} textAnchor="end" className="progress-axis-label">{shortScore(score)}</text>
        </g>)}
        <polyline points={line} fill="none" className="progress-score-line" />
        {points.map((point, index) => <circle key={point.runId} cx={x(index)} cy={y(point.score)} r={point.personalBest && point.previousBest !== null ? 6 : 4} className={point.personalBest && point.previousBest !== null ? 'progress-best-point' : 'progress-score-point'}>
          <title>{formatTime(point.finishedAt)}：{point.score} {board.unit} · {pointLabel(point)}</title>
        </circle>)}
        <text x={left} y={height - 16} className="progress-axis-label">{points.length === 1 ? '唯一一局' : '較早完成'}</text>
        {points.length > 1 && <text x={right} y={height - 16} textAnchor="end" className="progress-axis-label">最近完成</text>}
      </svg>
    </div>
    <p className="muted progress-legend"><span className="progress-legend-dot" aria-hidden="true" />金色標記：突破個人最佳 · 趨勢顯示每局成績，並非累積分數</p>
    <div className="career-table-wrap"><table className="career-table progress-table">
      <caption>最近 {points.length} 局成績，最近完成的局次在上方</caption>
      <thead><tr><th>完成時間</th><th>成績</th><th>個人進步</th></tr></thead>
      <tbody>{[...points].reverse().map((point) => <tr key={point.runId}>
        <td>{formatTime(point.finishedAt)}</td><td>{point.score} {board.unit}</td>
        <td>{point.personalBest && point.previousBest !== null ? <span className="progress-badge">突破個人最佳</span> : pointLabel(point)}
          {point.personalBest && point.previousBest !== null && <span className="progress-improvement">改善 {Math.abs(point.score - point.previousBest)} {board.unit}</span>}
        </td>
      </tr>)}</tbody>
    </table></div>
  </>;
}

export function PersonalProgressSection({ games }: { games: CareerGame[] }) {
  const scoredGames = games.filter((game) => game.bests.length > 0);
  const [selectedGame, setSelectedGame] = useState('');
  const game = scoredGames.find((entry) => entry.gameId === selectedGame) ?? scoredGames[0];
  const [selectedBoard, setSelectedBoard] = useState('');
  const board = game?.bests.find((entry) => entry.board.id === selectedBoard)?.board ?? game?.bests[0]?.board;
  const [response, setResponse] = useState<{ gameId: string; boardId: string; progress: PersonalProgress } | null>(null);
  const [error, setError] = useState<{ gameId: string; boardId: string; message: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const gameId = game?.gameId;
  const boardId = board?.id;
  useEffect(() => {
    const controller = new AbortController();
    setResponse(null); setError(null);
    if (gameId && boardId) void api<PersonalProgress>(`/me/progress?gameId=${encodeURIComponent(gameId)}&boardId=${encodeURIComponent(boardId)}`, undefined, { signal: controller.signal }).then((progress) => {
      if (!controller.signal.aborted) setResponse({ gameId, boardId, progress });
    }).catch((reason: Error) => {
      if (!controller.signal.aborted) setError({ gameId, boardId, message: reason.message });
    });
    return () => controller.abort();
  }, [gameId, boardId, refresh]);
  // Selection changes must hide the preceding board before its request is replaced.
  const progress = response?.gameId === gameId && response?.boardId === boardId ? response.progress : null;
  const currentError = error?.gameId === gameId && error?.boardId === boardId ? error.message : '';
  return <section className="career-section progress-section" aria-label="我的進步">
    <div className="section-heading"><h2>我的進步</h2><button className="button secondary small" disabled={!board} onClick={() => setRefresh((value) => value + 1)}>重新整理進步</button></div>
    <p className="muted">只有本人可以查看。不同榜單分開追蹤；沿用同一榜單的遊戲版本會合併成績。</p>
    {!scoredGames.length ? <p>尚未保存成績。完成支援排行榜的遊戲後，這裡會呈現你的個人最佳與近期趨勢。</p> : <>
      <div className="progress-filters">
        <label className="career-filter">遊戲<select aria-label="選擇進步遊戲" value={gameId} onChange={(event) => { setSelectedGame(event.target.value); setSelectedBoard(''); }}>
          {scoredGames.map((entry) => <option key={entry.gameId} value={entry.gameId}>{entry.name}{entry.published ? '' : '（已下架）'}</option>)}
        </select></label>
        <label className="career-filter">榜單<select aria-label="選擇進步榜單" value={boardId} onChange={(event) => setSelectedBoard(event.target.value)}>
          {game?.bests.map((entry) => <option key={entry.board.id} value={entry.board.id}>{entry.board.id} · {entry.board.order === 'asc' ? '越低越好' : '越高越好'}</option>)}
        </select></label>
      </div>
      {currentError ? <div><p role="alert">{currentError}</p><button className="button secondary small" onClick={() => setRefresh((value) => value + 1)}>重試載入進步</button></div> : !progress ? <p role="status">進步載入中…</p> : <>
        <div className="progress-stats">
          <div><span>個人最佳</span><strong>{progress.bestScore === null ? '尚無成績' : `${progress.bestScore} ${progress.board.unit}`}</strong></div>
          <div><span>此榜完成局數</span><strong>{progress.totalRuns} 局</strong></div>
          <div><span>突破個人最佳</span><strong>{progress.breakthroughs} 次</strong></div>
        </div>
        <p className="muted">突破次數計算此榜單的所有歷史成績，首次成績作為起點。</p>
        <ScoreTrend progress={progress} />
      </>}
    </>}
  </section>;
}
