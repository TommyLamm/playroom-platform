import type { GameManifest } from '../shared/manifest';
import type { SdkDiagnostics } from './game-bridge';
import './sdk-diagnostics.css';

export function SdkDiagnosticsPanel({ manifest, diagnostics, loading, error, expired, clear }: {
  manifest: GameManifest;
  diagnostics: SdkDiagnostics;
  loading: boolean;
  error: string;
  expired: boolean;
  clear: () => void;
}) {
  const board = manifest.leaderboard;
  const state = expired ? '預覽已過期' : error ? '入口載入失敗' : loading ? '遊戲載入中' : diagnostics.state === 'connected' ? 'SDK 已連線' : diagnostics.state === 'timeout' ? 'SDK 未連線' : '等候 SDK 連線';
  return <section className="sdk-diagnostics" aria-label="SDK 診斷面板">
    <div className="sdk-diagnostics-heading"><div><span className="sdk-diagnostics-kicker">管理員預覽</span><h2>SDK 診斷</h2></div><button className="button secondary small" onClick={clear}>清除事件</button></div>
    <p className="sdk-diagnostics-state" role="status">{state} · 協定 v1</p>
    <p>本面板模擬局次與驗證成績，不寫入遊玩記錄、生涯或排行榜。重新開始會重建連線並清空事件。</p>
    <dl className="sdk-diagnostics-config">
      <div><dt>遊戲</dt><dd>{manifest.name}（{manifest.id}）</dd></div>
      <div><dt>版本</dt><dd>v{manifest.version}</dd></div>
      <div><dt>排行榜</dt><dd>{board ? board.id : '尚未設定 leaderboard'}</dd></div>
      {board && <><div><dt>排序</dt><dd>{board.order === 'asc' ? '分數越低越好' : '分數越高越好'}</dd></div><div><dt>單位</dt><dd>{board.unit}</dd></div><div><dt>有效範圍</dt><dd>{board.minScore} – {board.maxScore}</dd></div></>}
    </dl>
    {diagnostics.state === 'connected' && !diagnostics.simulation && <p className="sdk-diagnostics-warning">此 SDK 未支援預覽局次診斷，請更新 SDK 後重新匯入。連線成功不代表成績接入已完成。</p>}
    {diagnostics.state === 'timeout' && <p className="sdk-diagnostics-warning">確認入口有載入 playroom-sdk.js，並檢查遊戲內的載入錯誤。遊戲仍可操作。</p>}
    <h3>事件（最近 80 筆）</h3>
    {diagnostics.events.length ? <ol className="sdk-diagnostics-events" aria-label="SDK 診斷事件">{diagnostics.events.map((event) => <li key={event.id} data-kind={event.kind}><time>{new Date(event.at).toLocaleTimeString('zh-HK', { hour12: false })}</time><span>{event.text}</span></li>)}</ol> : <p className="sdk-diagnostics-empty">尚無事件。開始並完成一局以檢查 SDK 接入。</p>}
  </section>;
}
