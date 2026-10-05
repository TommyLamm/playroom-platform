import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api.js';
import type { OperationalAnalytics } from '../shared/analytics.js';
import './admin-analytics.css';
import { AdminVisitors } from './admin-visitors.js';

const count = (value: number) => value.toLocaleString('zh-Hant');
function bytes(value: number | null) {
  if (value === null) return '未知';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(value ? Math.floor(Math.log(value) / Math.log(1024)) : 0, units.length - 1);
  return `${(value / 1024 ** index).toLocaleString('zh-Hant', { maximumFractionDigits: 1 })} ${units[index]}`;
}
const date = (value: string | null) => value ? new Date(value).toLocaleString('zh-Hant') : '尚無記錄';
const labels = { never: '尚未備份', running: '正在備份', success: '備份成功', failed: '備份未完成' };

export function AdminAnalytics() {
  const [days, setDays] = useState<7 | 30>(7);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<OperationalAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api<OperationalAnalytics>(`/admin/analytics?days=${days}`, undefined, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setData(value); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '無法讀取營運概況'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, refresh]);
  const reload = () => setRefresh((value) => value + 1);
  return <section className="analytics" aria-label="營運概況" aria-busy={loading}>
    <div className="analytics-heading"><div><h2>營運概況</h2><p>查看訪客來源、遊戲活動、成績提交與備份狀態。</p></div>
      <div className="analytics-controls"><label>統計期間 <select value={days} onChange={(event) => { setDays(Number(event.target.value) as 7 | 30); setData(null); }}>
        <option value={7}>最近 7 天</option><option value={30}>最近 30 天</option>
      </select></label><button type="button" onClick={reload} disabled={loading}>重新整理</button></div>
    </div>
    {loading && <p role="status">正在讀取營運概況…</p>}
    {error && <div role="alert" className="analytics-error"><p>{error}</p><button type="button" onClick={reload}>重試</button></div>}
    {data && <p className="analytics-note">統計區間：{data.window.start.replace('T', ' ').replace('.000Z', '')} 至 {data.window.end.replace('T', ' ').replace('Z', '')}（UTC）。更新：{date(data.window.generatedAt)}</p>}
    <AdminVisitors days={days} refresh={refresh} />
    {data && <>
      <h3>登入玩家與成績</h3>
      <div className="analytics-totals">
        <article><span>活躍玩家</span><strong>{count(data.totals.activePlayers)}</strong></article>
        <article><span>遊戲開啟次數</span><strong>{count(data.totals.opens)}</strong></article>
        <article><span>完成局數</span><strong>{count(data.totals.completedRuns)}</strong></article>
      </div>
      <p className="analytics-note">以下玩家與成績指標只統計登入帳號；活躍玩家指期間內開啟遊戲、回報活躍或完成一局的玩家。匿名訪客與預覽不納入帳號指標。</p>
      <article className="analytics-panel"><h3>熱門遊戲</h3><p className="analytics-note">按開啟次數排序，最多顯示 10 款；保留下架遊戲的歷史活動。</p>
        {data.games.length ? <div className="analytics-table"><table><thead><tr><th scope="col">遊戲</th><th scope="col">狀態</th><th scope="col">開啟</th><th scope="col">完成局數</th><th scope="col">玩家</th></tr></thead>
          <tbody>{data.games.map((game) => <tr key={game.gameId}><th scope="row">{game.published ? <Link to={`/games/${encodeURIComponent(game.gameId)}`}>{game.name}</Link> : game.name}</th>
            <td>{game.published ? '已上架' : '已下架'}</td><td>{count(game.opens)}</td><td>{count(game.completedRuns)}</td><td>{count(game.activePlayers)}</td></tr>)}</tbody></table></div>
          : <p>此期間尚無帳號遊玩記錄。</p>}
      </article>
      <article className="analytics-panel"><h3>成績提交</h3><div className="analytics-totals">
        <div><span>保存失敗率</span><strong>{data.submissions.failureRate === null ? '尚無提交' : `${(data.submissions.failureRate * 100).toLocaleString('zh-Hant', { maximumFractionDigits: 1 })}%`}</strong></div>
        <div><span>伺服器收到的提交</span><strong>{count(data.submissions.attempts)}</strong></div>
        <div><span>保存成功</span><strong>{count(data.submissions.success)}</strong></div>
      </div><p>拒絕的提交：{count(data.submissions.rejected)}；伺服器錯誤：{count(data.submissions.serverError)}。</p>
        <p className="analytics-note">統計已登入且局次屬於目前工作階段的提交；重複提交與重試會再次計數。失敗包含輸入被拒絕與伺服器錯誤；離線及未到達伺服器的失敗無法統計。</p>
        <details><summary>每日提交統計（UTC）</summary><div className="analytics-table"><table><thead><tr><th scope="col">日期</th><th scope="col">成功</th><th scope="col">被拒絕</th><th scope="col">伺服器錯誤</th></tr></thead>
          <tbody>{data.submissions.daily.map((day) => <tr key={day.day}><th scope="row">{day.day}</th><td>{count(day.success)}</td><td>{count(day.rejected)}</td><td>{count(day.serverError)}</td></tr>)}</tbody></table></div></details>
      </article>
      <div className="analytics-system"><article className="analytics-panel"><h3>儲存空間</h3><dl>
        <div><dt>平台資料用量</dt><dd>{bytes(data.storage.dataBytes)}</dd></div><div><dt>其中遊戲版本檔案</dt><dd>{bytes(data.storage.gameBytes)}</dd></div>
        <div><dt>磁碟可用空間</dt><dd>{bytes(data.storage.availableBytes)}</dd></div><div><dt>磁碟總容量</dt><dd>{bytes(data.storage.totalBytes)}</dd></div>
      </dl><p className="analytics-note">磁碟容量包含同一磁碟上的其他資料。平台用量包含資料庫與遊戲檔案，不追蹤符號連結。測量結果最多快取 30 秒；無法讀取時顯示未知。</p><p className="analytics-note">測量：{date(data.storage.measuredAt)}</p></article>
      <article className="analytics-panel"><h3>最近備份</h3><p className={`analytics-backup analytics-backup-${data.backup.status}`}>{labels[data.backup.status]}</p><dl>
        <div><dt>最近一次開始</dt><dd>{date(data.backup.startedAt)}</dd></div><div><dt>最近一次完成</dt><dd>{date(data.backup.finishedAt)}</dd></div>
        <div><dt>最近成功備份</dt><dd>{date(data.backup.lastSuccessAt)}</dd></div>
      </dl>{data.backup.error && <p className="analytics-error">{data.backup.error}</p>}
        <p className="analytics-note">顯示平台備份指令記錄的狀態，不代表備份目的地仍可用。還原快照時，本次備份完成狀態尚未寫入快照；請重新備份以更新狀態。</p>
      </article></div>
    </>}
  </section>;
}
