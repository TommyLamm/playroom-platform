import { useContext, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Gamepad2, LoaderCircle, ShieldCheck, UserRound, UserPlus, Eye, EyeOff } from 'lucide-react';
import type { Session } from '../../../shared/account';
import { canAccessAdmin } from '../../../shared/account';
import { api } from '../../api';
import { SessionContext } from '../../environment/session';
import { useNotice } from '../../environment/notices';
import { Spinner, Empty, ErrorMessage } from '../../ui/status';

export function AuthPage({ register = false, admin = false }: { register?: boolean; admin?: boolean }) {
  const { session, refresh } = useContext(SessionContext);
  const navigate = useNavigate();
  const notice = useNotice();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password'));
    if (register && password !== form.get('confirmation')) {
      setError('兩次輸入的密碼不一致');
      setBusy(false);
      return;
    }
    try {
      const result = await api<Session>(register ? '/register' : '/login', {
        username: form.get('username'),
        password,
      });
      await refresh();
      notice(register ? '帳號已建立，歡迎加入！' : '登入成功');
      navigate(admin && result.authenticated && canAccessAdmin(result.role) ? '/admin' : '/', {
        replace: true,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (session?.authenticated)
    return <Navigate to={admin && canAccessAdmin(session.role) ? '/admin' : '/'} replace />;
  if (!session)
    return (
      <main className="page">
        <Spinner />
      </main>
    );
  return (
    <main className="page login-page">
      <section className="auth-aside" aria-label="遊戲收藏">
        <div className="auth-aside-heading">
          <Gamepad2 size={22} />
          <span>PLAYROOM</span>
        </div>
        <h2>{register ? '一起玩，多一點好時光。' : '你的下一局，隨時開始。'}</h2>
        <div className="auth-art-grid">
          <div className="auth-art signal-art">
            <span className="art-label">光點反應</span>
            <div className="art-tiles">
              {Array.from({ length: 12 }, (_, i) => (
                <i key={i} className={i === 5 ? 'lit' : ''} />
              ))}
            </div>
            <span className="art-caption">REACTION / 20 SEC</span>
          </div>
          <div className="auth-art colors-art">
            <span className="art-label">色彩尋蹤</span>
            <div className="art-tiles">
              {Array.from({ length: 12 }, (_, i) => (
                <i key={i} className={i === 7 ? 'lit' : ''} />
              ))}
            </div>
            <span className="art-caption">COLOR / ONE MORE</span>
          </div>
        </div>
        <p>小小一局，讓今天輕鬆一點。</p>
      </section>
      <div className="login-form">
        <span className="login-symbol">
          {register ? (
            <UserPlus size={28} />
          ) : admin ? (
            <ShieldCheck size={28} />
          ) : (
            <UserRound size={28} />
          )}
        </span>
        <div className="eyebrow">{admin ? 'PLAYROOM ADMIN' : 'YOUR LITTLE BREAK'}</div>
        <h1>{register ? '建立玩家帳號' : '歡迎回來'}</h1>
        <p>
          {register ? '加入集合所，和大家一起玩。' : admin ? '登入管理後台' : '登入你的玩家帳號'}
        </p>
        <form onSubmit={submit} onChange={() => setError('')}>
          {error && <ErrorMessage message={error} />}
          <label>
            <span id="account-username-label">帳號</span>
            <input
              name="username"
              autoComplete="username"
              required
              minLength={register ? 3 : 1}
              maxLength={register ? 32 : 100}
              pattern={register ? '[a-zA-Z0-9_.\\-]+' : undefined}
              aria-labelledby="account-username-label"
              aria-describedby={register ? 'username-hint' : undefined}
              placeholder={register ? '你的玩家名稱' : '輸入帳號'}
            />
            {register && (
              <small className="field-hint" id="username-hint">
                3–32 個英文字母、數字或 _ . -；保留大小寫，登入不分大小寫
              </small>
            )}
          </label>
          <label>
            密碼
            <span className="password-field">
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={register ? 'new-password' : 'current-password'}
                required
                minLength={register ? 12 : 1}
                maxLength={256}
                placeholder={register ? '至少 12 個字元' : '輸入密碼'}
              />
              <button
                type="button"
                className="icon-button"
                title={showPassword ? '隱藏密碼' : '顯示密碼'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>
          {register && (
            <label>
              確認密碼
              <input
                name="confirmation"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={256}
                placeholder="再輸入一次密碼"
              />
            </label>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : register ? (
              <UserPlus size={18} />
            ) : (
              <ArrowRight size={18} />
            )}
            {register ? '建立帳號' : '登入'}
          </button>
        </form>
        <p className="auth-switch">
          {register ? '已經有帳號？' : '還沒有帳號？'}{' '}
          <Link to={register ? '/login' : '/register'}>{register ? '登入' : '註冊玩家帳號'}</Link>
        </p>
        <Link className="back-link" to="/">
          <ArrowLeft size={15} />
          返回遊戲大廳
        </Link>
      </div>
    </main>
  );
}
