import { useEffect, useRef, useState, type FormEvent } from 'react';
import { userRoleSchema, roleLabels, roleDescriptions, type UserRole, type AccountList, type ManagedAccount } from '../shared/account';
import { api } from './api';
import './admin-accounts.css';

export function AdminAccounts({ username, onChanged }: { username: string; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<AccountList | null>(null);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ account: ManagedAccount; role: UserRole } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!pending) return;
    dialog.current?.showModal();
    const current = dialog.current;
    return () => current?.close();
  }, [pending]);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError('');
    void api<AccountList>(`/admin/accounts?${new URLSearchParams({ search, page: String(page) })}`, undefined, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setData(value); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '無法讀取帳號'); });
    return () => controller.abort();
  }, [search, page, retry]);
  function find(event: FormEvent) {
    event.preventDefault(); setSearch(draft.trim()); setPage(1); setRetry((n) => n + 1);
  }
  async function save() {
    if (!pending) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api(`/admin/accounts/${pending.account.id}/role`, { role: pending.role, expectedRole: pending.account.role });
      setMessage(`${pending.account.username} 已設為${roleLabels[pending.role]}`);
      setPending(null); setRetry((n) => n + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '無法變更角色');
    } finally {
      setBusy(false);
      try { await onChanged(); } catch { setError('無法同步目前權限，請重新整理頁面'); }
    }
  }
  return <section className="admin-accounts" aria-label="帳號權限">
    <h2>帳號權限</h2>
    <p>帳號先完成一般註冊，再由平台管理員分配角色。變更會立即套用至所有已登入裝置。</p>
    <div className="account-role-guide">{userRoleSchema.options.map((role) => <article key={role}><h3>{roleLabels[role]}</h3><p>{roleDescriptions[role]}</p></article>)}</div>
    <form className="account-search" onSubmit={find}><label htmlFor="account-search">搜尋帳號</label><input id="account-search" maxLength={32} value={draft} onChange={(event) => setDraft(event.target.value)} /><button className="button" type="submit">搜尋</button></form>
    {error && !pending && <div role="alert" className="error-banner">{error}<button className="button" type="button" onClick={() => { setPending(null); setRetry((n) => n + 1); }}>重新整理帳號</button></div>}
    {message && <p role="status">{message}</p>}
    {!data ? (!error && <p role="status">正在讀取帳號…</p>) : <>
      <p>共 {data.total} 個帳號</p>
      <div className="managed-account-list">{data.accounts.map((account) => <article key={account.id} className="managed-account">
        <div><strong>{account.username}</strong>{account.username.toLowerCase() === username.toLowerCase() && <span>（你）</span>}<p>{roleLabels[account.role]}</p></div>
        <label>角色<select aria-label={`${account.username} 的角色`} value={account.role} disabled={busy} onChange={(event) => { setError(''); setMessage(''); setPending({ account, role: userRoleSchema.parse(event.target.value) }); }}>
          {userRoleSchema.options.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
        </select></label>
      </article>)}</div>
      {!data.accounts.length && <p>沒有符合的帳號。</p>}
      <div className="account-pagination"><button className="button" disabled={page <= 1 || busy} onClick={() => { setPending(null); setPage((n) => n - 1); }}>上一頁</button><span>第 {page} / {Math.max(1, Math.ceil(data.total / data.pageSize))} 頁</span><button className="button" disabled={page * data.pageSize >= data.total || busy} onClick={() => { setPending(null); setPage((n) => n + 1); }}>下一頁</button></div>
    </>}
    {pending && <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); if (!busy) setPending(null); }} aria-labelledby="role-confirm-title" className="dialog account-role-confirm">
      <h2 id="role-confirm-title">確認變更角色</h2><p>將 {pending.account.username} 從{roleLabels[pending.account.role]}變更為{roleLabels[pending.role]}。</p><p>{roleDescriptions[pending.role]}</p>
      {pending.account.username.toLowerCase() === username.toLowerCase() && pending.role !== 'admin' && <p>你會失去帳號權限管理功能。平台必須保留至少一位平台管理員。</p>}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions"><button className="button" disabled={busy} onClick={() => setPending(null)}>取消</button><button className="button primary" disabled={busy} onClick={() => void save()}>{busy ? '儲存中…' : '確認變更'}</button></div>
    </dialog>}
  </section>;
}
