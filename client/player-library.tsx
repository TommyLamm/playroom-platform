import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Heart, LoaderCircle, Play, RefreshCw } from 'lucide-react';
import type { Session } from '../shared/account';
import type { PublicGame } from '../shared/types';
import type { PlayerLibrary } from '../shared/player-library';
import { api, ApiError } from './api';

const LibraryContext = createContext<{
  authenticated: boolean;
  library: PlayerLibrary | null;
  loading: boolean;
  error: string;
  writeError: string;
  busy: Set<string>;
  refresh: () => Promise<void>;
  toggle: (gameId: string) => Promise<void>;
} | null>(null);

// App keys this provider by account and session, so no response can cross accounts.
export function PlayerLibraryProvider({ session, children }: { session: Session | null; children: ReactNode }) {
  const authenticated = session?.authenticated === true;
  const [library, setLibrary] = useState<PlayerLibrary | null>(null);
  const [loading, setLoading] = useState(authenticated);
  const [error, setError] = useState('');
  const [writeError, setWriteError] = useState('');
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(new Set<string>());
  const alive = useRef(true);
  const revision = useRef(0);
  const pending = useRef<Promise<void> | null>(null);
  const busyRef = useRef(new Set<string>());
  const libraryRef = useRef(library);
  libraryRef.current = library;
  useEffect(() => () => { alive.current = false; }, []);
  const refresh = useCallback(() => {
    if (!authenticated || !alive.current) return Promise.resolve();
    if (pending.current) return pending.current;
    const atRevision = revision.current;
    setLoading(true);
    setError('');
    const request = api<PlayerLibrary>('/me/library', undefined, { signal: AbortSignal.timeout(12000) })
      .then((data) => {
        if (alive.current && revision.current === atRevision) setLibrary(data);
      })
      .catch((cause) => {
        if (!alive.current) return;
        if (cause instanceof ApiError && cause.status === 401) {
          setLibrary(null);
          setExpired(true);
        }
        setError(cause.message || '無法讀取遊戲收藏');
      })
      .finally(() => {
        pending.current = null;
        if (alive.current) setLoading(false);
        if (alive.current && revision.current !== atRevision) void refresh();
      });
    pending.current = request;
    return request;
  }, [authenticated]);
  useEffect(() => { void refresh(); }, [refresh]);
  const toggle = useCallback(async (gameId: string) => {
    if (!authenticated || !alive.current || !libraryRef.current || busyRef.current.has(gameId)) return;
    const favorite = !libraryRef.current.favorites.some((item) => item.gameId === gameId);
    busyRef.current.add(gameId);
    setBusy(new Set(busyRef.current));
    setWriteError('');
    revision.current += 1;
    try {
      const result = await api<{ favorite: boolean }>(`/me/favorites/${encodeURIComponent(gameId)}`, { favorite }, { signal: AbortSignal.timeout(12000) });
      if (!alive.current) return;
      revision.current += 1;
      setLibrary((previous) => previous && ({
        ...previous,
        favorites: result.favorite
          ? [{ gameId, createdAt: new Date().toISOString() }, ...previous.favorites.filter((item) => item.gameId !== gameId)]
          : previous.favorites.filter((item) => item.gameId !== gameId),
      }));
    } catch (cause) {
      if (alive.current && cause instanceof ApiError && cause.status === 401) {
        setLibrary(null);
        setExpired(true);
      }
      if (alive.current) setWriteError(cause instanceof Error ? cause.message : '收藏未保存，請重試');
    } finally {
      busyRef.current.delete(gameId);
      if (alive.current) setBusy(new Set(busyRef.current));
    }
  }, [authenticated]);
  return <LibraryContext.Provider value={{ authenticated: authenticated && !expired, library, loading, error, writeError, busy, refresh, toggle }}>{children}</LibraryContext.Provider>;
}

export function usePlayerLibrary() {
  const context = useContext(LibraryContext);
  if (!context) throw new Error('Missing player library provider');
  return context;
}

export function FavoriteButton({ game, compact = false }: { game: PublicGame; compact?: boolean }) {
  const { authenticated, library, busy, toggle } = usePlayerLibrary();
  const favorite = library?.favorites.some((item) => item.gameId === game.id) === true;
  const label = `${favorite ? '取消收藏' : '收藏'}${game.name}`;
  const className = `button favorite-button${compact ? ' compact' : ''}${favorite ? ' selected' : ''}`;
  if (!authenticated) return <Link className={className} to="/login" aria-label={label} title="登入後收藏遊戲"><Heart size={17} /><span>登入收藏</span></Link>;
  return <button className={className} aria-label={label} aria-pressed={favorite}
    disabled={!library || busy.has(game.id)} onClick={() => void toggle(game.id)}>
    {busy.has(game.id) ? <LoaderCircle size={17} className="spin" /> : <Heart size={17} fill={favorite ? 'currentColor' : 'none'} />}
    <span>{favorite ? '已收藏' : '收藏'}</span>
  </button>;
}

export function LibraryError({ includeRead = true }: { includeRead?: boolean }) {
  const { error, writeError, refresh } = usePlayerLibrary();
  const message = writeError || (includeRead ? error : '');
  if (!message) return null;
  return <div className="error-banner" role="alert"><span>{message}</span>
    {!writeError && <button className="button small" onClick={() => void refresh()}><RefreshCw size={14} />重試</button>}
    {writeError && <span>請再次按收藏按鈕重試。</span>}
  </div>;
}

export function PlayerLibrarySections({ games }: { games: PublicGame[] | null }) {
  const { authenticated, library, loading, refresh } = usePlayerLibrary();
  useEffect(() => { void refresh(); }, [refresh]);
  if (!authenticated) return <div className="library-login"><Heart size={18} /><p><Link to="/login">登入</Link>後可跨裝置收藏遊戲，快速找到最近玩過的遊戲。</p></div>;
  const byId = new Map(games?.map((game) => [game.id, game]));
  return <div className="player-library">
    <LibraryError />
    {(['recent', 'favorites'] as const).map((kind) => {
      const title = kind === 'recent' ? '最近遊玩' : '我的收藏';
      const items = (library?.[kind] || []).flatMap((item) => {
        const game = byId.get(item.gameId);
        return game ? [game] : [];
      });
      return <section key={kind} aria-label={title} className="library-section">
        <div className="section-heading"><h2>{title}</h2><span className="muted">{kind === 'recent' ? '接著上次的樂趣' : '好玩的遊戲，隨時再來一局'}</span></div>
        {!library || !games ? <p className="library-empty" role={loading ? 'status' : undefined}>{loading || !games ? '正在讀取遊戲…' : '目前無法讀取，請重試。'}</p>
          : items.length ? <div className="library-grid">{items.map((game) => <article className="library-card" key={game.id}>
            <Link to={`/games/${game.id}`} className="library-game"><img src={game.coverUrl} alt="" loading="lazy" /><h3>{game.name}</h3></Link>
            <div className="library-actions"><Link className="button primary small" to={`/play/${game.id}`} aria-label={`${kind === 'recent' ? '繼續遊玩' : '開始遊戲'}${game.name}`}><Play size={14} />{kind === 'recent' ? '繼續遊玩' : '開始遊戲'}</Link><FavoriteButton game={game} compact /></div>
          </article>)}</div>
            : <p className="library-empty">{kind === 'recent' ? '還沒有遊玩記錄，從下方挑一款遊戲開始吧。' : '還沒有收藏，按遊戲旁的愛心就能加入。'}</p>}
      </section>;
    })}
  </div>;
}
