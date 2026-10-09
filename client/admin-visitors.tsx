import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api.js';
import type { VisitorAnalytics, VisitorRecords } from '../shared/visitors.js';
import { Eye, Gamepad2, Globe2, History, TrendingUp, Users } from 'lucide-react';
import { DailyTrend, MetricCard, PanelHeading } from './analytics-visuals';

const count = (value: number) => value.toLocaleString('zh-Hant');
const regions = new Intl.DisplayNames(['zh-Hant'], { type: 'region' });
const countryName = (code: string | null) => code ? `${regions.of(code) ?? code}（${code}）` : '未知／內網';
type Filters = { country: string; ip: string; gameId: string; kind: string; visitor: string };
const emptyFilters: Filters = { country: '', ip: '', gameId: '', kind: '', visitor: '' };

export function AdminVisitors({ days, refresh, canViewRecords = false }: { days: 7 | 30; refresh: number; canViewRecords?: boolean }) {
  const [data, setData] = useState<VisitorAnalytics | null>(null);
  const [records, setRecords] = useState<VisitorRecords | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [recordError, setRecordError] = useState('');
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const query = new URLSearchParams({ days: String(days), page: String(page) });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  const recordQuery = query.toString();

  useEffect(() => { setPage(1); }, [days]);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setSummaryError('');
    api<VisitorAnalytics>(`/admin/visitors?days=${days}`, undefined, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setData(value); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setSummaryError(error instanceof Error ? error.message : '無法讀取訪客統計'); });
    return () => controller.abort();
  }, [days, refresh, retry]);
  useEffect(() => {
    if (!canViewRecords) return;
    const controller = new AbortController();
    setRecords(null); setRecordError('');
    api<VisitorRecords>(`/admin/visitors/records?${recordQuery}`, undefined, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setRecords(value); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setRecordError(error instanceof Error ? error.message : '無法讀取訪客記錄'); });
    return () => controller.abort();
  }, [recordQuery, refresh, retry, canViewRecords]);
  function apply(event: FormEvent) {
    event.preventDefault(); setPage(1); setFilters({ ...draft, ip: draft.ip.trim() });
  }
  function selectVisitor(visitor: string) {
    setPage(1); setDraft({ ...draft, visitor }); setFilters({ ...filters, visitor });
  }
  function clear() { setDraft(emptyFilters); setFilters(emptyFilters); setPage(1); }
  const fail = (message: string) => <div role="alert" className="analytics-error"><p>{message}</p><button type="button" onClick={() => setRetry((n) => n + 1)}>重試訪客資料</button></div>;
  return <section aria-label="訪客統計與記錄" className="visitor-analytics">
    <div className="analytics-section-heading"><span className="analytics-panel-icon"><Globe2 size={18} /></span><div><h3>訪客統計</h3><p>從流量趨勢到遊戲偏好，了解每一次造訪。</p></div></div>
    <p className="analytics-note">包含匿名訪客與登入玩家，以此瀏覽器的訪客 Cookie 去重。記錄保留 90 天；後台角色活動與預覽不納入。停用 Cookie 或更換裝置可能再次計數。</p>
    {summaryError ? fail(summaryError) : !data ? <p role="status">正在讀取訪客統計…</p> : <>
      <div className="analytics-totals">
        <MetricCard label="獨立訪客" value={count(data.totals.visitors)} icon={Users} note="按訪客 Cookie 去重" />
        <MetricCard label="頁面瀏覽" value={count(data.totals.pageViews)} icon={Eye} note="匿名訪客與登入玩家的瀏覽" tone="blue" />
        <MetricCard label="訪客遊戲開啟" value={count(data.totals.gameOpens)} icon={Gamepad2} note="成功載入遊戲畫面的次數" tone="amber" />
      </div>
      <article className="analytics-panel analytics-traffic"><PanelHeading title="造訪趨勢" icon={TrendingUp}>比較每日頁面瀏覽與遊戲開啟。</PanelHeading>
        <DailyTrend title="每日訪客趨勢" rows={data.daily.map((day) => ({ day: day.day, first: day.pageViews, second: day.gameOpens }))} primary="頁面瀏覽" secondary="遊戲開啟" />
        <details><summary>每日訪客趨勢（UTC）</summary><div className="analytics-table"><table><thead><tr><th scope="col">日期</th><th scope="col">訪客</th><th scope="col">頁面瀏覽</th><th scope="col">遊戲開啟</th></tr></thead>
          <tbody>{data.daily.map((day) => <tr key={day.day}><th scope="row">{day.day}</th><td>{count(day.visitors)}</td><td>{count(day.pageViews)}</td><td>{count(day.gameOpens)}</td></tr>)}</tbody></table></div></details>
      </article>
      <div className="analytics-system">
        <article className="analytics-panel"><PanelHeading title="國家／地區分佈" icon={Globe2} />
          {data.countries.length ? <div className="analytics-table"><table><thead><tr><th scope="col">國家／地區</th><th scope="col">訪客</th><th scope="col">活動</th></tr></thead>
            <tbody>{data.countries.map((row) => <tr key={row.country ?? 'unknown'}><th scope="row">{countryName(row.country)}</th><td>{count(row.visitors)}</td><td>{count(row.events)}</td></tr>)}</tbody></table></div> : <p>此期間尚無訪客。</p>}
          <p className="analytics-note">國家按 IP 推算，VPN 或代理可能影響結果；無法辨識時顯示未知。同一訪客可能出現在多個國家。</p>
        </article>
        <article className="analytics-panel"><PanelHeading title="訪客熱門遊戲" icon={Gamepad2} />
          {data.games.length ? <div className="analytics-table"><table><thead><tr><th scope="col">遊戲</th><th scope="col">開啟</th><th scope="col">訪客</th></tr></thead>
            <tbody>{data.games.map((game, index) => <tr key={game.gameId}><th scope="row"><span className="analytics-ranked-name"><span className={`analytics-rank ${index < 3 ? 'top' : ''}`}>{index + 1}</span>{game.name}</span></th><td>{count(game.opens)}</td><td>{count(game.visitors)}</td></tr>)}</tbody></table></div> : <p>此期間尚無訪客遊戲開啟記錄。</p>}
          <p className="analytics-note">遊戲頁成功載入 iframe 後記錄開啟，包含未登入玩家與無 SDK 的遊戲；不代表已完成一局。</p>
        </article>
      </div>
    </>}
    {canViewRecords && <article className="analytics-panel analytics-record-panel"><details><summary className="analytics-record-summary"><History size={18} /><span>訪客活動記錄<small>依國家、IP、遊戲及活動類型查詢</small></span>{records && <span className="analytics-state">{count(records.total)} 筆</span>}</summary>
      <form className="visitor-filters" onSubmit={apply}>
        <label>國家／地區<select value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })}>
          <option value="">全部國家</option><option value="unknown">未知／內網</option>
          {data?.countries.filter((c) => c.country).map((c) => <option key={c.country!} value={c.country!}>{countryName(c.country)}</option>)}
        </select></label>
        <label>訪客 IP<input value={draft.ip} placeholder="完整 IPv4 或 IPv6" maxLength={45} onChange={(e) => setDraft({ ...draft, ip: e.target.value })} /></label>
        <label>遊戲 ID<input value={draft.gameId} placeholder="例如 signal-tap" maxLength={100} onChange={(e) => setDraft({ ...draft, gameId: e.target.value.trim() })} /></label>
        <label>活動類型<select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}><option value="">全部活動</option><option value="page_view">瀏覽頁面</option><option value="game_open">開啟遊戲</option></select></label>
        <button className="button primary" type="submit">套用篩選</button><button className="button" type="button" onClick={clear}>清除篩選</button>
      </form>
      {filters.visitor && <p className="analytics-note">正在查看訪客 {filters.visitor.slice(0, 12)} 的活動。</p>}
      {recordError ? fail(recordError) : !records ? <p role="status">正在讀取訪客記錄…</p> : <>
        <p className="analytics-note">共 {count(records.total)} 筆；按最新活動排序。點選訪客編號可查看同一瀏覽器的活動。</p>
        {records.records.length ? <div className="analytics-table"><table className="visitor-records"><thead><tr>
          <th scope="col">時間</th><th scope="col">訪客／帳號</th><th scope="col">IP</th><th scope="col">國家／地區</th><th scope="col">活動／遊戲</th><th scope="col">來源／裝置</th>
        </tr></thead><tbody>{records.records.map((record) => <tr key={record.id}>
          <td>{new Date(record.occurredAt).toLocaleString('zh-Hant')}</td>
          <td><button type="button" className="visitor-link" onClick={() => selectVisitor(record.visitor)} aria-label={`查看訪客 ${record.visitor.slice(0, 12)} 的活動`}>{record.visitor.slice(0, 12)}</button><small>{record.username ?? '未登入'}</small></td>
          <td><code>{record.ip}</code></td><td>{countryName(record.country)}</td>
          <td><strong>{record.kind === 'game_open' ? '開啟遊戲' : '瀏覽頁面'}</strong>{record.gameName && <small>{record.gameName} · v{record.gameVersion}</small>}<small>{record.path}</small></td>
          <td>{record.referrerHost ?? '直接／站內'}<details><summary>瀏覽器資料</summary><p>{record.userAgent || '未知'}</p></details></td>
        </tr>)}</tbody></table></div> : <p>此期間沒有符合篩選的訪客活動。</p>}
        <div className="visitor-pagination"><button className="button small" type="button" disabled={records.page <= 1} onClick={() => setPage((n) => n - 1)}>上一頁</button>
          <span>第 {records.page} / {Math.max(1, Math.ceil(records.total / records.pageSize))} 頁</span>
          <button className="button small" type="button" disabled={records.page * records.pageSize >= records.total} onClick={() => setPage((n) => n + 1)}>下一頁</button></div>
      </>}
    </details></article>}
  </section>;
}
