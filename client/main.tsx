import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Download,
  ExternalLink,
  Gamepad2,
  Github,
  Grid2X2,
  History,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Maximize,
  Menu,
  Monitor,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserRound,
  UserPlus,
  LogIn,
  Eye,
  EyeOff,
  X,
} from 'lucide-react';
import type { AdminGame, ImportJob, PublicGame, Repository } from '../shared/types';
import type { Session } from '../shared/account';
import { canAccessAdmin, hasPermission, roleLabels } from '../shared/account';
import type { UpdateStatus } from '../shared/update';
import { api, ApiError, setCsrf } from './api';
import './styles.css';
import { useGameBridge } from './game-bridge';
import { SdkDiagnosticsPanel } from './sdk-diagnostics';
import type { GameManifest } from '../shared/manifest';
import { CareerPage, LeaderboardPanel } from './career';
import { FavoriteButton, LibraryError, PlayerLibraryProvider, PlayerLibrarySections } from './player-library';
import { AccountSettingsPage } from './account-settings';
import { VisitorTracking, trackVisitor } from './visitor-tracking';
import { ImportWorkspace, ImportBatches } from './admin-sources';
import { AdminAccounts } from './admin-accounts';
import { Dialog } from './dialog';
import { GameUpdatesPanel } from './admin-game-updates';
import { type SourceCheck } from '../shared/game-updates';
import type { Source, ImportSelection } from '../shared/sources';
import { AdminGames } from './admin-games';
import { updateRows, isPendingUpdate } from './game-update-model';
import './admin-workspace.css';
import './lobby.css';
import './analytics-workspace.css';

const AdminAnalytics = React.lazy(async () => ({ default: (await import('./admin-analytics')).AdminAnalytics }));

const SessionContext = createContext<{ session: Session | null; refresh: () => Promise<void> }>({
  session: null,
  refresh: async () => {},
});
const NoticeContext = createContext<(message: string, error?: boolean) => void>(() => {});
function useNotice() {
  return useContext(NoticeContext);
}
const date = (value: string) =>
  new Intl.DateTimeFormat('zh-HK', { dateStyle: 'medium' }).format(new Date(value));

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const refresh = useCallback(async () => {
    const data = await api<Session>('/session');
    setCsrf(data.authenticated ? data.csrf : '');
    setSession(data);
  }, []);
  useEffect(() => {
    void refresh().catch(() => setSession({ authenticated: false }));
  }, [refresh]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  return (
    <SessionContext.Provider value={{ session, refresh }}>
      <NoticeContext.Provider value={(message, error = false) => setNotice({ message, error })}>
        <BrowserRouter>
        <VisitorTracking session={session} />
        <PlayerLibraryProvider session={session} key={session?.authenticated ? `${session.username}:${session.csrf}` : 'guest'}>
          <header className="site-header">
            <div className="header-inner">
              <Link className="brand" to="/" aria-label="小遊戲集合所首頁">
                <span className="brand-icon">
                  <Gamepad2 size={25} />
                </span>
                <span>
                  PLAYROOM<small>小遊戲集合所</small>
                </span>
              </Link>
              <nav aria-label="主要導覽">
                <NavLink to="/" end>
                  <Grid2X2 size={16} />
                  <span>遊戲大廳</span>
                </NavLink>
                {session?.authenticated && canAccessAdmin(session.role) && (
                  <NavLink to="/admin">
                    <Settings2 size={16} />
                    <span>管理後台</span>
                  </NavLink>
                )}
              </nav>
              <AccountNav />
            </div>
          </header>
          <Routes>
            <Route path="/" element={<Lobby />} />
            <Route path="/games/:id" element={<GameDetail />} />
            <Route path="/play/:id" element={<PlayPage />} />
            <Route path="/players/:username" element={<CareerPage session={session} />} />
            <Route path="/settings/account" element={<AccountSettingsPage session={session} onSessionChanged={refresh} notify={(message, error = false) => setNotice({ message, error })} />} />
            <Route path="/login" element={<AuthPage key="login" />} />
            <Route path="/register" element={<AuthPage key="register" register />} />
            <Route path="/admin" element={<Admin />} />
            <Route
              path="*"
              element={
                <Empty title="找不到這個頁面" text="回到大廳，挑一款遊戲吧。">
                  <Link className="button primary" to="/">
                    返回大廳
                  </Link>
                </Empty>
              }
            />
          </Routes>
          <footer className="site-footer">
            <span>
              PLAYROOM <span className="footer-divider">/</span> 留一點時間給好玩的事
            </span>
            <span>Made for a little break.</span>
          </footer>
          {notice && (
            <div
              className={`toast ${notice.error ? 'error' : ''}`}
              role={notice.error ? 'alert' : 'status'}
            >
              {notice.error ? <CircleAlert size={18} /> : <Check size={18} />}
              <span>{notice.message}</span>
              <button className="icon-button" title="關閉通知" onClick={() => setNotice(null)}>
                <X size={16} />
              </button>
            </div>
          )}
        </PlayerLibraryProvider>
        </BrowserRouter>
      </NoticeContext.Provider>
    </SessionContext.Provider>
  );
}

function AccountNav() {
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

function Spinner({ text = '載入中' }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{text}</span>
    </div>
  );
}
function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <Gamepad2 size={40} />
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}
function ErrorMessage({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <CircleAlert size={19} />
      <span>{message}</span>
      {retry && (
        <button className="button small" onClick={retry}>
          <RefreshCw size={14} />
          重試
        </button>
      )}
    </div>
  );
}

function Lobby() {
  const { session } = useContext(SessionContext);
  const [games, setGames] = useState<PublicGame[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('全部遊戲');
  const [sort, setSort] = useState('recent');
  const load = useCallback(() => {
    setError('');
    void api<{ games: PublicGame[] }>('/games')
      .then((d) => setGames(d.games))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  const tags = [...new Set(games?.flatMap((g) => g.tags))];
  const filtered = (games || [])
    .filter(
      (g) =>
        (tag === '全部遊戲' || g.tags.includes(tag)) &&
        `${g.name} ${g.author} ${g.description} ${g.tags.join(' ')}`
          .toLowerCase()
          .includes(search.toLowerCase().trim()),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, 'zh-Hant')
        : b.publishedAt.localeCompare(a.publishedAt),
    );
  return (
    <main className="page lobby">
      <section className="page-intro lobby-welcome">
        <div>
          <div className="eyebrow">
            <Gamepad2 size={14} /> PLAYROOM · 遊戲大廳
          </div>
          <h1>今天，玩點什麼？</h1>
          <p>一局小遊戲，一段剛剛好的休息。</p>
          <div className="lobby-welcome-tags"><span><Monitor size={14} />電腦與手機，隨時開玩</span><span><Sparkles size={14} />發現你的下一款最愛</span></div>
        </div>
        <div className="collection-count">
          <span className="lobby-collection-icon"><Gamepad2 size={38} strokeWidth={1.5} /></span>
          <div><strong>{games ? games.length : '—'}</strong><span>款遊戲等你探索</span></div>
          <span className="lobby-collection-note">挑一款，享受一點遊戲時光。</span>
        </div>
      </section>
      <PlayerLibrarySections games={games} />
      <section aria-label="遊戲目錄" className="lobby-catalog">
        <div className="lobby-catalog-heading"><div><h2>探索遊戲</h2><p>從熟悉的玩法，到意想不到的小樂趣。</p></div><span><Grid2X2 size={15} />遊戲收藏館</span></div>
        <div className="catalog-toolbar">
          <div className="filter-tabs" aria-label="遊戲分類">
            {['全部遊戲', ...tags].map((t) => (
              <button
                key={t}
                className={tag === t ? 'active' : ''}
                onClick={() => setTag(t)}
                aria-pressed={tag === t}
              >
                {t === '全部遊戲' && <Grid2X2 size={15} />} {t}
              </button>
            ))}
          </div>
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label="搜尋遊戲"
              placeholder="找一款遊戲…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="icon-button" title="清除搜尋" onClick={() => setSearch('')}>
                <X size={14} />
              </button>
            )}
          </label>
        </div>
        <div className="catalog-meta">
          <span>
            {search || tag !== '全部遊戲' ? `找到 ${filtered.length} 款遊戲` : '所有遊戲'}
            <span className="count-pill">{filtered.length}</span>
          </span>
          <label className="sort-field">
            <span className="sr-only">排序方式</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="recent">最近上架</option>
              <option value="name">依名稱排序</option>
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
        {error ? (
          <ErrorMessage message={error} retry={load} />
        ) : !games ? (
          <Spinner />
        ) : !games.length ? (
          <Empty title="第一款遊戲，等你上架" text="遊戲集合即將開始。">
            {session?.authenticated && canAccessAdmin(session.role) && (
              <Link className="button primary" to="/admin">
                <Plus size={17} />
                前往管理後台
              </Link>
            )}
          </Empty>
        ) : !filtered.length ? (
          <Empty title="還沒有找到這款遊戲" text="換個關鍵字，或看看其他分類。">
            <button
              className="button"
              onClick={() => {
                setSearch('');
                setTag('全部遊戲');
              }}
            >
              顯示所有遊戲
            </button>
          </Empty>
        ) : (
          <div className="game-grid">
            {filtered.map((game, i) => (
              <article className="game-card-wrap" key={game.id}>
              <Link className="game-card" to={`/games/${game.id}`}>
                <div className="game-art">
                  <img
                    src={game.coverUrl}
                    alt={`${game.name}遊戲畫面`}
                    loading={i < 3 ? 'eager' : 'lazy'}
                  />
                  <span className="art-play">
                    <Play size={22} fill="currentColor" />
                  </span>
                  <span className="game-index"><Play size={10} fill="currentColor" />隨時開玩</span>
                </div>
                <div className="game-card-body">
                  <div className="card-tags">
                    {game.tags.slice(0, 2).map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                  <h2>
                    {game.name}
                    <ArrowRight size={19} />
                  </h2>
                  <p>{game.description}</p>
                  <div className="card-bottom">
                    <span>by {game.author}</span>
                    <span className="device-icons">
                      {game.devices.includes('desktop') && (
                        <Monitor size={15} aria-label="支援電腦" />
                      )}
                      {game.devices.includes('mobile') && (
                        <Smartphone size={15} aria-label="支援手機" />
                      )}
                    </span>
                  </div>
                </div>
              </Link>
              <FavoriteButton game={game} compact />
              </article>
            ))}
          </div>
        )}
      </section>
      <div className="collection-end">
        <span />
        <Sparkles size={16} />
        <span />
        <p>好玩的事，慢慢收集。</p>
      </div>
    </main>
  );
}

function useGame() {
  const { id } = useParams();
  const [game, setGame] = useState<PublicGame | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setGame(null);
    setError('');
    void api<{ game: PublicGame }>(`/games/${id}`)
      .then((d) => {
        if (active) setGame(d.game);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  return { game, error };
}

function GameDetail() {
  const { game, error } = useGame();
  return (
    <main className="page detail">
      <Link className="back-link" to="/">
        <ArrowLeft size={16} />
        返回遊戲大廳
      </Link>
      {error ? (
        <ErrorMessage message={error} />
      ) : !game ? (
        <Spinner />
      ) : (
        <>
          <div className="detail-grid">
            <div className="detail-image">
              <img src={game.coverUrl} alt={`${game.name}遊戲畫面`} />
            </div>
            <div className="detail-info">
              <div className="card-tags">
                {game.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              <h1>{game.name}</h1>
              <p className="detail-author">by {game.author}</p>
              <p className="description">{game.description}</p>
              <div className="supported-devices">
                {game.devices.map((d) => (
                  <span key={d}>
                    {d === 'desktop' ? <Monitor size={16} /> : <Smartphone size={16} />}{' '}
                    {d === 'desktop' ? '電腦' : '手機'}
                  </span>
                ))}
              </div>
              <Link className="button primary play-button" to={`/play/${game.id}`}>
                <Play size={18} fill="currentColor" />
                開始遊戲
                <ArrowRight size={18} />
              </Link>
              <div className="detail-favorite"><FavoriteButton game={game} /><LibraryError /></div>
              <span className="version-note">
                v{game.version} · {date(game.publishedAt)} 上架
              </span>
            </div>
          </div>
          <section className="instructions">
            <h2>玩法與操作</h2>
            <p>{game.instructions}</p>
          </section>
          <LeaderboardPanel gameId={game.id} activeBoardId={game.leaderboard?.id} />
        </>
      )}
    </main>
  );
}

function GameFrame({
  url,
  title,
  onBack,
  expiresAt,
  game,
  previewManifest,
}: {
  url: string;
  title: string;
  onBack?: () => void;
  expiresAt?: number;
  game?: PublicGame;
  previewManifest?: GameManifest;
}) {
  const [restart, setRestart] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [verified, setVerified] = useState(false);
  const [loadedFrame, setLoadedFrame] = useState('');
  const lastTrackedFrame = useRef('');
  const loadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);
  const notice = useNotice();
  const frame = useRef<HTMLIFrameElement>(null);
  const { session } = useContext(SessionContext);
  const bridge = useGameBridge(frame, url, game, session, restart, previewManifest);
  useEffect(() => {
    if (!game || !session || loadedFrame !== `${url}-${restart}-${bridge.identity}` || lastTrackedFrame.current === loadedFrame) return;
    if (session.authenticated && canAccessAdmin(session.role)) return;
    lastTrackedFrame.current = loadedFrame;
    trackVisitor({ kind: 'game_open', path: `/play/${game.id}`, gameId: game.id, version: game.version });
  }, [game, session, loadedFrame, url, restart, bridge.identity]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setVerified(false);
    // iframe onload fires even for HTTP errors, so verify the entry before mounting it.
    loadTimer.current = setTimeout(() => {
      controller.abort();
      setLoading(false);
      setError('載入時間較長，請檢查連線後重試');
    }, 20000);
    void fetch(url, { method: 'HEAD', credentials: 'omit', signal: controller.signal })
      .then((response) => {
        if (!response.ok)
          throw new Error(
            response.status === 403 ? '預覽連結已失效，請重新預覽' : '遊戲目前無法載入，可能已下架',
          );
        if (!controller.signal.aborted) setVerified(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          clearTimeout(loadTimer.current);
          setLoading(false);
          setError(
            e.message === 'Failed to fetch' ? '無法連線到遊戲，請檢查網路後重試' : e.message,
          );
        }
      });
    return () => {
      controller.abort();
      clearTimeout(loadTimer.current);
    };
  }, [url, restart]);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);
  async function fullscreen() {
    try {
      if (!container.current?.requestFullscreen) throw new Error();
      await container.current.requestFullscreen();
    } catch {
      notice('這個瀏覽器目前不支援全螢幕模式', true);
    }
  }
  return (
    <div className="game-shell" ref={container}>
      <div className="player-toolbar">
        <div>
          {onBack && (
            <button className="icon-button" title="返回" onClick={onBack}>
              <ArrowLeft size={19} />
            </button>
          )}
          <Gamepad2 size={19} />
          <strong>{title}</strong>
          {expiresAt && <span className="badge amber">預覽</span>}
        </div>
        <div>
          <button
            className="icon-button"
            title="重新開始"
            onClick={() => {
              setError('');
              setLoading(true);
              setRestart((v) => v + 1);
            }}
          >
            <RefreshCw size={18} />
          </button>
          <button className="icon-button" title="全螢幕" onClick={fullscreen}>
            <Maximize size={19} />
          </button>
        </div>
      </div>
      <div className="game-viewport">
        {expired ? (
          <Empty title="預覽連結已過期" text="請關閉預覽，重新取得預覽連結。" />
        ) : (
          <>
            {verified && (
              <iframe
                key={`${url}-${restart}-${bridge.identity}`}
                ref={frame}
                title={title}
                src={url}
                sandbox="allow-scripts allow-same-origin allow-pointer-lock"
                allow="fullscreen; autoplay; gamepad"
                allowFullScreen
                referrerPolicy="no-referrer"
                onLoad={() => {
                  clearTimeout(loadTimer.current);
                  setLoading(false);
                  bridge.onLoad();
                  setLoadedFrame(`${url}-${restart}-${bridge.identity}`);
                }}
                onError={() => {
                  clearTimeout(loadTimer.current);
                  setLoading(false);
                  setError('遊戲載入失敗，請重試');
                }}
              />
            )}
            {loading && (
              <div className="frame-overlay">
                <Spinner text="遊戲載入中" />
              </div>
            )}
            {error && (
              <div className="frame-error">
                <ErrorMessage message={error} retry={() => setRestart((v) => v + 1)} />
              </div>
            )}
          </>
        )}
      </div>
      <div className="record-status" role="status">
        <span>{bridge.status}</span>
        {bridge.retryable && <button className="button secondary small" onClick={bridge.retry}>重試保存</button>}
      </div>
      {previewManifest && <SdkDiagnosticsPanel manifest={previewManifest} diagnostics={bridge.diagnostics} loading={loading} error={error} expired={expired} clear={bridge.clearDiagnostics} />}
    </div>
  );
}

function PlayPage() {
  const { game, error } = useGame();
  const navigate = useNavigate();
  return (
    <main className="page play-page">
      {error ? (
        <>
          <Link className="back-link" to="/">
            <ArrowLeft size={16} />
            返回大廳
          </Link>
          <ErrorMessage message={error} />
        </>
      ) : !game ? (
        <Spinner />
      ) : (
        <>
          <GameFrame
            url={game.playUrl}
            title={game.name}
            onBack={() => navigate(`/games/${game.id}`)}
            game={game}
          />
          <div className="play-caption">
            <p>{game.instructions}</p>
            <span>v{game.version}</span>
            <Link to={`/games/${game.id}#leaderboard`}>查看排行榜</Link>
          </div>
        </>
      )}
    </main>
  );
}

function AuthPage({ register = false, admin = false }: { register?: boolean; admin?: boolean }) {
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
                3–32 個英文字母、數字或 _ . -，不分大小寫
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

type Overview = { games: AdminGame[]; repositories: Repository[]; jobs: ImportJob[] };
const phaseNames: Record<string, string> = {
  queued: '等待中',
  resolving: '取得 Release',
  downloading: '下載中',
  validating: '檢查遊戲包',
  completed: '已匯入',
  failed: '匯入失敗',
  interrupted: '已中斷',
};

function Admin() {
  const { session, refresh } = useContext(SessionContext);
  useEffect(() => {
    if (!session?.authenticated) return;
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 3000);
    const focus = () => { void refresh().catch(() => {}); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [session?.authenticated, refresh]);
  return <AdminWorkspace key={session?.authenticated ? `${session.username}:${session.role}` : 'guest'} />;
}

function AdminWorkspace() {
  const { session, refresh } = useContext(SessionContext);
  const role = session?.authenticated ? session.role : 'player';
  const canManageGames = hasPermission(role, 'games.manage');
  const canReadAnalytics = hasPermission(role, 'analytics.read');
  const canManagePlatform = hasPermission(role, 'platform.manage');
  const canManageAccounts = hasPermission(role, 'accounts.manage');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importIds, setImportIds] = useState<number[]>([]);
  const [importSelections, setImportSelections] = useState<ImportSelection[] | undefined>();
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceCheck, setSourceCheck] = useState<SourceCheck | null>(null);
  const checkedOnEntry = useRef(false);
  const [previewQueue, setPreviewQueue] = useState<{ gameId: string; version: string }[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [preview, setPreview] = useState<{ gameId: string; version: string; url: string; title: string; expiresAt: number; previewManifest: GameManifest } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<{
    title: string;
    text: string;
    action: () => Promise<void>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(canManageGames ? 'game-updates' : 'analytics');
  const [visited, setVisited] = useState(() => new Set([canManageGames ? 'game-updates' : 'analytics']));
  const [navigationOpen, setNavigationOpen] = useState(false);
  function selectTab(next: string) { setTab(next); setVisited((tabs) => new Set([...tabs, next])); setNavigationOpen(false); }
  const pageInfo: Record<string, [string, string]> = {
    'game-updates': ['遊戲更新', '集中管理來源、新版匯入與發布。'], games: ['遊戲與版本', '快速找到遊戲，管理目前與歷史版本。'],
    imports: ['匯入紀錄', '追蹤匯入進度，處理需要重試的項目。'], analytics: ['營運概況', '查看遊戲與訪客彙總統計。'],
    updates: ['平台更新', '檢查平台版本與部署狀態。'], accounts: ['帳號權限', '管理工作區成員與角色。'],
  };
  const notice = useNotice();
  const load = useCallback(async () => {
    try {
      const [overview, sourceData, checkData] = await Promise.all([
        api<Overview>('/admin/overview'), api<{ sources: Source[] }>('/admin/sources'),
        api<{ check: SourceCheck | null }>('/admin/source-checks/current'),
      ]);
      setData(overview);
      setSources(sourceData.sources);
      setSourceCheck(checkData.check);
      setError('');
    } catch (e) {
      if (e instanceof ApiError && [401, 403].includes(e.status)) await refresh();
      else setError((e as Error).message);
    }
  }, [refresh]);
  useEffect(() => {
    if (!canManageGames) return;
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [canManageGames, load]);
  const checkSources = useCallback(async () => {
    const result = await api<{ check: SourceCheck }>('/admin/source-checks', {});
    setSourceCheck(result.check);
    await load();
  }, [load]);
  useEffect(() => {
    if (!canManageGames) { checkedOnEntry.current = false; return; }
    if (checkedOnEntry.current) return;
    checkedOnEntry.current = true;
    void checkSources().catch((e) => notice((e as Error).message, true));
  }, [canManageGames, checkSources, notice]);
  async function mutate(url: string, body: unknown, message: string) {
    await api(url, body);
    await load();
    notice(message);
  }
  async function showPreview(game: AdminGame, version: string, keepQueue = false) {
    if (!keepQueue) setPreviewQueue([]);
    try {
      const manifest = game.versions.find((v) => v.version === version)?.manifest;
      if (!manifest) throw new Error('找不到預覽版本');
      const result = await api<{ url: string; expiresAt: number }>(
        `/admin/games/${game.id}/preview`,
        { version },
      );
      setPreview({
        ...result,
        gameId: game.id,
        version,
        title: `${manifest.name} · v${version}`,
        previewManifest: manifest,
      });
      return true;
    } catch (e) {
      notice((e as Error).message, true);
      return false;
    }
  }
  async function previewSequence(items: { gameId: string; version: string }[]) {
    const first = items[0];
    const game = data?.games.find((g) => g.id === first?.gameId);
    if (!game) return;
    if (await showPreview(game, first.version, true)) setPreviewQueue(items.slice(1));
  }
  async function approvePreview() {
    if (!preview) return;
    setReviewing(true);
    try {
      await api(`/admin/games/${preview.gameId}/review`, { version: preview.version, approved: true });
      await load();
      const next = previewQueue[0];
      const game = data?.games.find((g) => g.id === next?.gameId);
      if (next && game) {
        if (await showPreview(game, next.version, true)) setPreviewQueue((items) => items.slice(1));
      } else { setPreview(null); setPreviewQueue([]); }
    } catch (e) { notice((e as Error).message, true); }
    finally { setReviewing(false); }
  }
  async function previewImported(gameId: string, version: string) {
    try {
      const overview = await api<Overview>('/admin/overview');
      setData(overview);
      const game = overview.games.find((g) => g.id === gameId);
      if (!game) throw new Error('找不到遊戲');
      setImporting(false);
      setImportSelections(undefined);
      await showPreview(game, version);
    } catch (e) {
      notice((e as Error).message, true);
    }
  }
  if (!session)
    return (
      <main className="page">
        <Spinner />
      </main>
    );
  if (!session.authenticated) return <AuthPage admin />;
  if (!canAccessAdmin(session.role))
    return (
      <main className="page">
        <Empty title="這裡是管理員工作區" text="你的玩家帳號可以在大廳選擇遊戲。">
          <Link className="button primary" to="/">
            返回遊戲大廳
          </Link>
        </Empty>
      </main>
    );
  const pendingCount = data ? updateRows(sources, data.games).filter(isPendingUpdate).length : 0;
  const navigation = <nav className="admin-navigation" aria-label="後台導覽">
    {canManageGames && <><span className="admin-nav-group">遊戲管理</span>
      <button className={tab === 'game-updates' ? 'active' : ''} aria-current={tab === 'game-updates' ? 'page' : undefined} onClick={() => selectTab('game-updates')}><RefreshCw size={18} /><span>遊戲更新</span><span className="admin-nav-count">{pendingCount}</span></button>
      <button className={tab === 'games' ? 'active' : ''} aria-current={tab === 'games' ? 'page' : undefined} onClick={() => selectTab('games')}><Gamepad2 size={18} /><span>遊戲與版本</span></button>
      <button className={tab === 'imports' ? 'active' : ''} aria-current={tab === 'imports' ? 'page' : undefined} onClick={() => selectTab('imports')}><History size={18} /><span>匯入紀錄</span>{data?.jobs.some((j) => ['queued', 'running'].includes(j.status)) && <span className="status-dot" />}</button></>}
    {(canReadAnalytics || canManagePlatform || canManageAccounts) && <span className="admin-nav-group">平台管理</span>}
    {canReadAnalytics && <button className={tab === 'analytics' ? 'active' : ''} aria-current={tab === 'analytics' ? 'page' : undefined} onClick={() => selectTab('analytics')}><Grid2X2 size={18} /><span>營運概況</span></button>}
    {canManagePlatform && <button className={tab === 'updates' ? 'active' : ''} aria-current={tab === 'updates' ? 'page' : undefined} onClick={() => selectTab('updates')}><RefreshCw size={18} /><span>平台更新</span></button>}
    {canManageAccounts && <button className={tab === 'accounts' ? 'active' : ''} aria-current={tab === 'accounts' ? 'page' : undefined} onClick={() => selectTab('accounts')}><ShieldCheck size={18} /><span>帳號權限</span></button>}
  </nav>;
  const openImport = () => { setImportSelections(undefined); setImportIds([]); setImporting(true); };
  return (
    <main className="page admin-page">
      <aside className="admin-sidebar"><div className="admin-sidebar-brand"><LayoutDashboard size={22} /><div><strong>管理工作台</strong><small>PLAYROOM WORKSPACE</small></div></div>{navigation}<div className="admin-sidebar-account"><span className="account-avatar"><UserRound size={17} /></span><div><strong>{session.username}</strong><small>{roleLabels[role]}</small></div></div></aside>
      <div className="admin-content">
      <header className="admin-intro"><div><div className="eyebrow">管理工作台 / {canManageGames && ['games', 'game-updates', 'imports'].includes(tab) ? '遊戲管理' : '平台管理'}</div><h1>{pageInfo[tab][0]}</h1><p>{pageInfo[tab][1]}</p></div>
        <div className="admin-actions"><button className="button admin-mobile-nav" aria-label="開啟後台導覽" onClick={() => setNavigationOpen(true)}><Menu size={18} /></button>
          {canManageGames && <button className="icon-button" title="重新整理" onClick={() => void load()}><RefreshCw size={17} /></button>}
          <button className="button" onClick={async () => { try { await api('/logout', {}); await refresh(); } catch (e) { notice((e as Error).message, true); } }}><LogOut size={16} /><span>登出</span></button>
          {canManageGames && ['games', 'game-updates', 'imports'].includes(tab) && <button className="button primary" onClick={openImport}><Plus size={17} />匯入遊戲</button>}
        </div>
      </header>
      {canManageGames && ['games', 'game-updates'].includes(tab) && <div className="stats-row">
        <div><span>全部遊戲</span><strong>{data?.games.length || 0}</strong><Gamepad2 /></div>
        <div><span>已上架</span><strong>{data?.games.filter((g) => g.published).length || 0}</strong><span className="stat-dot green" /></div>
        <div><span>待處理更新</span><strong>{pendingCount}</strong><span className="stat-dot yellow" /></div>
        <div><span>使用中來源</span><strong>{sources.filter((s) => !s.archived).length}</strong><Github /></div>
      </div>}
      {error && <ErrorMessage message={error} retry={() => void load()} />}
      {visited.has('accounts') && canManageAccounts && <div hidden={tab !== 'accounts'}><AdminAccounts username={session.username} onChanged={refresh} /></div>}
      {visited.has('analytics') && canReadAnalytics && <div hidden={tab !== 'analytics'}><React.Suspense fallback={<Spinner />}><AdminAnalytics canViewRecords={hasPermission(role, 'visitors.read')} /></React.Suspense></div>}
      {visited.has('updates') && canManagePlatform && <div hidden={tab !== 'updates'}><PlatformUpdates /></div>}
      {canManageGames && !data && <Spinner />}
      {canManageGames && data && <>
        <div hidden={tab !== 'game-updates'}><GameUpdatesPanel sources={sources} games={data.games} check={sourceCheck} onChanged={load} onCheck={checkSources}
          onPreview={(items) => void previewSequence(items)}
          onImport={(items) => { setImportSelections(items); setImportIds(items.map((item) => item.repositoryId)); setImporting(true); }}
          onManualImport={(ids) => { setImportSelections(undefined); setImportIds(ids); setImporting(true); }} /></div>
        {visited.has('games') && <div hidden={tab !== 'games'}><AdminGames games={data.games} repositories={data.repositories} onImport={openImport}
          onPreview={(game, version) => void showPreview(game, version)}
          onRevokeReview={(game, version) => setConfirm({ title: '撤銷預覽確認', text: '撤銷 ' + game.versions[0].manifest.name + ' v' + version + ' 的驗收確認。', action: () => mutate('/admin/games/' + game.id + '/review', { version, approved: false }, '預覽確認已撤銷') })}
          onPublish={(game, version) => setConfirm({ title: game.versions.find((v) => v.version === version)?.publishedAt ? '切換發布版本' : '發布遊戲', text: '將 ' + game.versions[0].manifest.name + ' 的 v' + version + ' 設為目前上架版本。', action: () => mutate('/admin/games/' + game.id + '/publish', { version }, '遊戲已發布') })}
          onUnpublish={(game) => setConfirm({ title: '下架遊戲', text: '下架後，玩家將無法開啟這款遊戲。所有版本會保留。', action: () => mutate('/admin/games/' + game.id + '/unpublish', {}, '遊戲已下架') })} /></div>}
        {visited.has('imports') && <div hidden={tab !== 'imports'}><ImportBatches onChanged={() => void load()} onPreview={(id, version) => void previewImported(id, version)} /><ImportHistory jobs={data.jobs} repositories={data.repositories} /></div>}
      </>}
      </div>
      {navigationOpen && <Dialog title="後台導覽" drawer onClose={() => setNavigationOpen(false)}>{navigation}</Dialog>}
      {importing && (
        <Dialog title="從 GitHub 匯入" wide onClose={() => {
          setImporting(false);
          setImportSelections(undefined);
          void load();
        }}>
          <ImportWorkspace
            initialIds={importIds}
            initialSelections={importSelections}
            onChanged={() => {
              if (tab !== 'game-updates') selectTab('imports');
              void load();
            }}
            onPreview={(id, version) => void previewImported(id, version)}
          />
        </Dialog>
      )}
      {preview && (
        <Dialog title="遊戲預覽" wide closeDisabled={reviewing} onClose={() => { if (!reviewing) { setPreview(null); setPreviewQueue([]); } }}>
          <GameFrame key={`${preview.gameId}:${preview.version}`} {...preview} />
          <p className="preview-note">
            <Clock3 size={14} />
            預覽授權有效 15 分鐘
          </p>
          <div className="preview-review-actions"><p>確認代表你已實際驗收開始、主要玩法、結束及重新開始，並檢查資源與錯誤。確認將保存並供其他管理者共用。</p>
            <button className="button primary" disabled={reviewing || Date.now() >= preview.expiresAt} onClick={() => void approvePreview()}>{reviewing ? '保存確認…' : previewQueue.length ? '確認通過並看下一款' : '確認通過'}</button></div>
        </Dialog>
      )}
      {confirm && (
        <Dialog
          title={confirm.title}
          closeDisabled={busy}
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <p className="confirm-text">{confirm.text}</p>
          <div className="dialog-actions">
            <button className="button" disabled={busy} onClick={() => setConfirm(null)}>
              取消
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await confirm.action();
                  setConfirm(null);
                } catch (e) {
                  notice((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}確認
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}

const updatePhases: Record<string, string> = {
  queued: '準備更新',
  building: '建置與測試',
  'backing-up': '暫停服務並備份',
  deploying: '啟動新版',
  verifying: '健康檢查',
  completed: '更新完成',
  failed: '更新失敗',
  'rolling-back': '還原舊版',
  'rolled-back': '已回復舊版',
  'recovery-failed': '需人工回復',
};

function PlatformUpdates() {
  const [data, setData] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const notice = useNotice();
  const load = useCallback(async () => {
    try {
      setData(await api<UpdateStatus>('/admin/updates'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [load]);
  const running = data?.jobs?.find((job) => job.status === 'running');
  const available = data?.latest && data.latest.commit !== data.current;
  return (
    <section className="platform-updates" aria-label="平台更新">
      <div className="update-heading">
        <div>
          <h2>平台版本</h2>
          <span className="muted">{data?.branch || 'main'}</span>
        </div>
        <button
          className="button"
          disabled={busy || !!running || !data?.enabled}
          onClick={async () => {
            setBusy(true);
            try {
              setData(await api<UpdateStatus>('/admin/updates/check', {}));
              setError('');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw size={16} className={busy ? 'spin' : ''} />
          檢查更新
        </button>
      </div>
      {error && <ErrorMessage message={error} retry={() => void load()} />}
      {!data ? (
        <Spinner />
      ) : !data.enabled ? (
        <div className="update-unavailable">
          <CircleAlert size={20} />
          <span>此部署尚未啟用 OTA 更新服務</span>
        </div>
      ) : (
        <>
          <div className="update-versions">
            <div>
              <span>目前提交</span>
              <code title={data.current}>{data.current.slice(0, 12)}</code>
            </div>
            <div>
              <span>最新提交</span>
              <code title={data.latest?.commit}>
                {data.latest?.commit.slice(0, 12) || '尚未檢查'}
              </code>
            </div>
            <div>
              <span>最後檢查</span>
              <strong>
                {data.checkedAt
                  ? new Intl.DateTimeFormat('zh-HK', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(new Date(data.checkedAt))
                  : '—'}
              </strong>
            </div>
          </div>
          <div className="update-release">
            <div>
              <span className={`status-badge ${available ? 'draft' : 'published'}`}>
                {available ? '有新版本' : data.latest ? '已是最新版本' : '等待檢查'}
              </span>
              <h3>{data.latest?.subject || 'GitHub 更新來源'}</h3>
              <a href={data.repository} target="_blank" rel="noreferrer">
                {data.repository?.replace('https://github.com/', '')}
                <ExternalLink size={13} />
              </a>
            </div>
            <button
              className="button primary"
              disabled={busy || !!running || !available}
              onClick={() => setConfirm(true)}
            >
              <Download size={16} />
              更新平台
            </button>
          </div>
          {data.checkError && <ErrorMessage message={data.checkError} />}
          {running && (
            <div className="update-progress" role="status">
              <LoaderCircle size={18} className="spin" />
              <strong>{updatePhases[running.phase] || running.phase}</strong>
              <code>{running.commit.slice(0, 12)}</code>
            </div>
          )}
          <h3 className="update-history-title">更新紀錄</h3>
          {!data.jobs?.length ? (
            <p className="muted">尚無更新紀錄</p>
          ) : (
            <div className="update-history">
              {data.jobs.map((job) => (
                <div className="update-job" key={job.id}>
                  <div>
                    <span
                      className={`status-badge ${job.status === 'completed' ? 'published' : job.status === 'failed' ? 'failed' : 'draft'}`}
                    >
                      {updatePhases[job.phase] || job.phase}
                    </span>
                    <code title={job.commit}>{job.commit.slice(0, 12)}</code>
                    <span className="muted">{date(job.startedAt)}</span>
                  </div>
                  {job.backup && (
                    <p>
                      備份：<code>{job.backup}</code>
                    </p>
                  )}
                  {job.error && (
                    <details>
                      <summary>錯誤詳情</summary>
                      <pre>{job.error}</pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {confirm && data?.latest && (
        <Dialog title="更新平台" onClose={() => setConfirm(false)}>
          <p className="update-confirm-copy">
            將部署提交 <code>{data.latest.commit.slice(0, 12)}</code>
            。切換版本時網站會短暫離線；帳號與遊戲資料會備份，啟動失敗時回復舊版。回復後需重新登入。
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setConfirm(false)}>
              取消
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('/admin/updates', { commit: data.latest!.commit });
                  setConfirm(false);
                  await load();
                  notice('平台更新已開始');
                } catch (e) {
                  notice((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Download size={16} />
              確認更新
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function ImportHistory({ jobs, repositories }: { jobs: ImportJob[]; repositories: Repository[] }) {
  if (!jobs.length)
    return <Empty title="還沒有匯入紀錄" text="匯入遊戲後，可以在這裡查看處理狀態。" />;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>來源</th>
            <th>狀態</th>
            <th>遊戲版本</th>
            <th>時間</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>
                <strong>{repositories.find((r) => r.id === job.repositoryId)?.fullName}</strong>
                <small>Release #{job.releaseId}</small>
              </td>
              <td>
                <span
                  className={`badge ${job.status === 'completed' ? 'green' : job.status === 'failed' ? 'red' : 'amber'}`}
                >
                  {job.status === 'running' && <LoaderCircle className="spin" size={12} />}{' '}
                  {phaseNames[job.phase] || job.phase}
                </span>
                {job.error && <p className="job-error">{job.error}</p>}
              </td>
              <td>{job.gameId ? `${job.gameId} · ${job.version}` : '—'}</td>
              <td>{date(job.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
