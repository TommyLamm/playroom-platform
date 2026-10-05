import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api.js';
import type { VisitorAnalytics, VisitorRecords } from '../shared/visitors.js';

const count = (value: number) => value.toLocaleString('zh-Hant');
const regions = new Intl.DisplayNames(['zh-Hant'], { type: 'region' });
const countryName = (code: string | null) => code ? `${regions.of(code) ?? code}（${code}）` : '未知／內網';
type Filters = { country: string; ip: string; gameId: string; kind: string; visitor: string };
const emptyFilters: Filters = { country: '', ip: '', gameId: '', kind: '', visitor: '' };

export function AdminVisitors({ days, refresh }: { days: 7 | 30; refresh: number }) {
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
    const controller = new AbortController();
    setRecords(null); setRecordError('');
    api<VisitorRecords>(`/admin/visitors/records?${recordQuery}`, undefined, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setRecords(value); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setRecordError(error instanceof Error ? error.message : '無法讀取訪客記錄'); });
    return () => controller.abort();
  }, [recordQuery, refresh, retry]);
  function apply(event: FormEvent) {
    event.preventDefault(); setPage(1); setFilters({ ...draft, ip: draft.ip.trim() });
  }
  function selectVisitor(visitor: string) {
    setPage(1); setDraft({ ...draft, visitor }); setFilters({ ...filters, visitor });
  }
  function clear() { setDraft(emptyFilters); setFilters(emptyFilters); setPage(1); }
  const fail = (message: string) => <div role="alert" className="analytics-error"><p>{message}</p><button type="button" onClick={() => setRetry((n) => n + 1)}>重試訪客資料</button></div>;
  return <section aria-label="訪客統計與記錄" className="visitor-analytics">
    <h3>訪客統計</h3>
    <p className="analytics-note">包含匿名訪客與登入玩家，以此瀏覽器的訪客 Cookie 去重。記錄保留 90 天；管理員活動與後台預覽不納入。停用 Cookie 或更換裝置可能再次計數。</p>
    {summaryError ? fail(summaryError) : !data ? <p role="status">正在讀取訪客統計…</p> : <>
      <div className="analytics-totals">
        <article><span>獨立訪客</span><strong>{count(data.totals.visitors)}</strong></article>
        <article><span>頁面瀏覽</span><strong>{count(data.totals.pageViews)}</strong></article>
        <article><span>訪客遊戲開啟</span><strong>{count(data.totals.gameOpens)}</strong></article>
      </div>
      <div className="analytics-system">
        <article className="analytics-panel"><h4>國家／地區分佈</h4>
          {data.countries.length ? <div className="analytics-table"><table><thead><tr><th scope="col">國家／地區</th><th scope="col">訪客</th><th scope="col">活動</th></tr></thead>
            <tbody>{data.countries.map((row) => <tr key={row.country ?? 'unknown'}><th scope="row">{countryName(row.country)}</th><td>{count(row.visitors)}</td><td>{count(row.events)}</td></tr>)}</tbody></table></div> : <p>此期間尚無訪客。</p>}
          <p className="analytics-note">國家按 IP 推算，VPN 或代理可能影響結果；無法辨識時顯示未知。同一訪客可能出現在多個國家。</p>
        </article>
        <article className="analytics-panel"><h4>訪客熱門遊戲</h4>
          {data.games.length ? <div className="analytics-table"><table><thead><tr><th scope="col">遊戲</th><th scope="col">開啟</th><th scope="col">訪客</th></tr></thead>
            <tbody>{data.games.map((game) => <tr key={game.gameId}><th scope="row">{game.name}</th><td>{count(game.opens)}</td><td>{count(game.visitors)}</td></tr>)}</tbody></table></div> : <p>此期間尚無訪客遊戲開啟記錄。</p>}
          <p className="analytics-note">遊戲頁成功載入 iframe 後記錄開啟，包含未登入玩家與無 SDK 的遊戲；不代表已完成一局。</p>
        </article>
      </div>
      <article className="analytics-panel"><details><summary>每日訪客趨勢（UTC）</summary><div className="analytics-table"><table><thead><tr><th scope="col">日期</th><th scope="col">訪客</th><th scope="col">頁面瀏覽</th><th scope="col">遊戲開啟</th></tr></thead>
        <tbody>{data.daily.map((day) => <tr key={day.day}><th scope="row">{day.day}</th><td>{count(day.visitors)}</td><td>{count(day.pageViews)}</td><td>{count(day.gameOpens)}</td></tr>)}</tbody></table></div></details></article>
    </>}
    <article className="analytics-panel"><h4>訪客活動記錄</h4>
      <form className="visitor-filters" onSubmit={apply}>
        <label>國家／地區<select value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })}>
          <option value="">全部國家</option><option value="unknown">未知／內網</option>
          {data?.countries.filter((c) => c.country).map((c) => <option key={c.country!} value={c.country!}>{countryName(c.country)}</option>)}
        </select></label>
        <label>訪客 IP<input value={draft.ip} placeholder="完整 IPv4 或 IPv6" maxLength={45} onChange={(e) => setDraft({ ...draft, ip: e.target.value })} /></label>
        <label>遊戲 ID<input value={draft.gameId} placeholder="例如 signal-tap" maxLength={100} onChange={(e) => setDraft({ ...draft, gameId: e.target.value.trim() })} /></label>
        <label>活動類型<select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}><option value="">全部活動</option><option value="page_view">瀏覽頁面</option><option value="game_open">開啟遊戲</option></select></label>
        <button type="submit">套用篩選</button><button type="button" onClick={clear}>清除篩選</button>
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
        <div className="visitor-pagination"><button type="button" disabled={records.page <= 1} onClick={() => setPage((n) => n - 1)}>上一頁</button>
          <span>第 {records.page} / {Math.max(1, Math.ceil(records.total / records.pageSize))} 頁</span>
          <button type="button" disabled={records.page * records.pageSize >= records.total} onClick={() => setPage((n) => n + 1)}>下一頁</button></div>
      </>}
    </article>
  </section>;
}
