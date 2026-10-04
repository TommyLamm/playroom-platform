import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '../shared/account';
import type { AccountSettings } from '../shared/settings';
import { api } from './api';
import './account-settings.css';

type Props = { session: Session | null; onSessionChanged: () => Promise<void>; notify?: (message: string, error?: boolean) => void };
type Visibility = AccountSettings['careerVisibility'];

export function AccountSettingsPage({ session, onSessionChanged, notify }: Props) {
  if (!session) return <main className="page account-settings-page"><h1>帳號設定</h1><p role="status">帳號載入中…</p></main>;
  if (!session.authenticated) return <main className="page account-settings-page"><h1>帳號設定</h1><p>登入後可以管理密碼、其他裝置與生涯公開範圍。</p><Link className="button" to="/login">登入帳號</Link></main>;
  return <AuthenticatedSettings key={`${session.username}:${session.csrf}`} session={session} onSessionChanged={onSessionChanged} notify={notify} />;
}

function AuthenticatedSettings({ session, onSessionChanged, notify }: Props & { session: Extract<Session, { authenticated: true }> }) {
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState('');
  const [privacyStatus, setPrivacyStatus] = useState('');
  const [privacyError, setPrivacyError] = useState('');
  const [passwordStatus, setPasswordStatus] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [revokePassword, setRevokePassword] = useState('');
  const [revokeStatus, setRevokeStatus] = useState('');
  const [revokeError, setRevokeError] = useState('');
  const life = useRef(new AbortController());
  useEffect(() => {
    life.current = new AbortController();
    return () => life.current.abort();
  }, []);
  useEffect(() => {
    const request = new AbortController();
    const signal = AbortSignal.any([request.signal, life.current.signal]);
    setSettings(null); setLoadError('');
    void api<AccountSettings>('/me/settings', undefined, { signal }).then((value) => {
      if (signal.aborted) return;
      setSettings(value); setVisibility(value.careerVisibility);
    }).catch((error: Error) => { if (!signal.aborted) setLoadError(error.message); });
    return () => request.abort();
  }, [reload]);

  async function savePrivacy(event: FormEvent) {
    event.preventDefault();
    if (busy || !settings) return;
    const signal = life.current.signal;
    setBusy('privacy'); setPrivacyError(''); setPrivacyStatus('');
    try {
      const value = await api<AccountSettings>('/me/settings', { careerVisibility: visibility }, { signal });
      if (signal.aborted) return;
      setSettings(value); setVisibility(value.careerVisibility); setPrivacyStatus('生涯公開範圍已儲存。');
    } catch (error) { if (!signal.aborted) setPrivacyError((error as Error).message); }
    finally { if (!signal.aborted) setBusy(''); }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setPasswordError(''); setPasswordStatus('');
    if (newPassword.length < 12 || newPassword.length > 256) { setPasswordError('新密碼必須介於 12 至 256 個字元。'); return; }
    if (newPassword !== confirmation) { setPasswordError('確認新密碼與新密碼不一致。'); return; }
    const signal = life.current.signal;
    let saved = false;
    setBusy('password');
    try {
      await api<{ ok: true; session: Session }>('/me/password', { currentPassword, newPassword }, { signal });
      if (signal.aborted) return;
      saved = true;
      setCurrentPassword(''); setNewPassword(''); setConfirmation(''); setRevokePassword('');
      setPasswordStatus('密碼已更新，其他裝置已登出。');
      await onSessionChanged();
      notify?.('密碼已更新，其他裝置已登出。');
    } catch (error) {
      if (saved) notify?.('密碼已更新；重新整理登入狀態失敗，請重新載入本頁。', true);
      else if (!signal.aborted) setPasswordError((error as Error).message);
    }
    finally { if (!signal.aborted) setBusy(''); }
  }

  async function revokeOthers(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const signal = life.current.signal;
    setBusy('revoke'); setRevokeError(''); setRevokeStatus('');
    try {
      const value = await api<{ revoked: number }>('/me/sessions/revoke', { currentPassword: revokePassword }, { signal });
      if (signal.aborted) return;
      setRevokePassword(''); setRevokeStatus(`已登出 ${value.revoked} 個其他登入工作階段。`); setReload((value) => value + 1);
    } catch (error) { if (!signal.aborted) setRevokeError((error as Error).message); }
    finally { if (!signal.aborted) setBusy(''); }
  }

  return <main className="page account-settings-page">
    <Link className="back-link" to="/">← 返回遊戲大廳</Link>
    <h1>帳號設定</h1><p className="muted">管理 {session.username} 的帳號與公開資料。</p>
    <section className="career-section" aria-label="生涯公開範圍">
      <h2>生涯公開範圍</h2>
      <p>逐局成績與進步趨勢只有本人可查看。無論此設定為何，已提交的排行榜成績與玩家名稱仍然公開。</p>
      {loadError ? <><p role="alert">{loadError}</p><button className="button secondary small" disabled={!!busy} onClick={() => setReload((value) => value + 1)}>重試載入設定</button></> : !settings ? <p role="status">設定載入中…</p> : <form onSubmit={(event) => void savePrivacy(event)}>
        <label>公開範圍<select aria-label="生涯公開範圍" value={visibility} disabled={!!busy} onChange={(event) => { setVisibility(event.target.value as Visibility); setPrivacyStatus(''); setPrivacyError(''); }}>
          <option value="public">公開：遊戲、最佳成績與活躍記錄</option>
          <option value="limited">部分公開：只顯示遊戲與最佳成績</option>
          <option value="private">私人：只有本人可查看生涯</option>
        </select></label>
        <p className="muted">部分公開會隱藏開啟次數、完成局數、活躍時間與最近遊玩時間。你自己仍可查看完整生涯。</p>
        {privacyError && <p role="alert">{privacyError}</p>}{privacyStatus && <p className="settings-success" role="status">{privacyStatus}</p>}
        <button className="button" type="submit" disabled={!!busy}>{busy === 'privacy' ? '儲存中…' : '儲存公開範圍'}</button>
      </form>}
    </section>
    <section className="career-section" aria-label="修改密碼">
      <h2>修改密碼</h2><p>更新成功後保留本裝置登入，並登出所有其他裝置。新密碼須為 12 至 256 個字元。</p>
      <form onSubmit={(event) => void changePassword(event)}>
        <label>目前密碼<input type="password" autoComplete="current-password" required maxLength={256} value={currentPassword} disabled={!!busy} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <label>新密碼<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={newPassword} disabled={!!busy} onChange={(event) => setNewPassword(event.target.value)} /></label>
        <label>確認新密碼<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={confirmation} disabled={!!busy} onChange={(event) => setConfirmation(event.target.value)} /></label>
        {passwordError && <p role="alert">{passwordError}</p>}{passwordStatus && <p className="settings-success" role="status">{passwordStatus}</p>}
        <button className="button" type="submit" disabled={!!busy}>{busy === 'password' ? '更新中…' : '更新密碼'}</button>
      </form>
    </section>
    <section className="career-section" aria-label="其他裝置">
      <h2>其他裝置</h2>
      {settings && <p>目前有 {settings.otherSessions} 個其他有效登入工作階段；同一裝置可能有多個工作階段。</p>}
      <p>驗證目前密碼後，可以登出其他裝置。本裝置會保持登入。</p>
      <form onSubmit={(event) => void revokeOthers(event)}>
        <label>驗證目前密碼<input type="password" autoComplete="current-password" required maxLength={256} value={revokePassword} disabled={!!busy} onChange={(event) => setRevokePassword(event.target.value)} /></label>
        {revokeError && <p role="alert">{revokeError}</p>}{revokeStatus && <p className="settings-success" role="status">{revokeStatus}</p>}
        <button className="button secondary" type="submit" disabled={!!busy}>{busy === 'revoke' ? '登出中…' : '登出其他裝置'}</button>
      </form>
    </section>
  </main>;
}
