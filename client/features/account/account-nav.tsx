import { useContext, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, History, LayoutDashboard, LogOut, Settings2, UserRound, UserPlus, LogIn } from 'lucide-react';
import { canAccessAdmin, roleLabels } from '../../../shared/account';
import { api, ApiError } from '../../api';
import { SessionContext } from '../../environment/session';
import { useNotice } from '../../environment/notices';

export function AccountNav() {
  const { session, refresh } = useContext(SessionContext);
  const notice = useNotice();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (menu.current?.open && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector('summary')?.focus();
      }
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);
  if (!session) return <div className="account-nav account-placeholder" aria-busy="true" />;
  if (!session.authenticated)
    return (
      <div className="account-nav">
        <Link className="account-login" to="/login">
          <LogIn size={16} />
          <span>登入</span>
        </Link>
        <Link className="button primary small" to="/register">
          <UserPlus size={16} />
          <span>註冊</span>
        </Link>
      </div>
    );
  return (
    <div className="account-nav">
      <details className="account-menu" ref={menu}>
        <summary title={session.username}>
          <span className="account-avatar">
            <UserRound size={17} />
          </span>
          <span className="account-name">{session.username}</span>
          <ChevronDown size={14} />
        </summary>
        <div className="account-dropdown">
          <div className="account-info">
            <strong>{session.username}</strong>
            <span>{roleLabels[session.role]}</span>
          </div>
          <Link to={`/players/${encodeURIComponent(session.username)}`}
            onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}>
            <History size={16} />我的遊戲生涯
          </Link>
          <Link to="/settings/account"
            onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}>
            <Settings2 size={16} />帳號設定
          </Link>
          {canAccessAdmin(session.role) && (
            <Link
              to="/admin"
              onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}
            >
              <LayoutDashboard size={16} />
              管理後台
            </Link>
          )}
          <button
            disabled={busy}
            onClick={async (event) => {
              event.currentTarget.closest('details')?.removeAttribute('open');
              setBusy(true);
              try {
                try {
                  await api('/logout', {});
                } catch (error) {
                  if (!(error instanceof ApiError && error.status === 401)) throw error;
                }
                await refresh();
                navigate('/');
              } catch (error) {
                notice((error as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <LogOut size={16} />
            登出帳號
          </button>
        </div>
      </details>
    </div>
  );
}
