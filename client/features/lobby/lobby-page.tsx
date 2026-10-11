import { useCallback, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, Gamepad2, Grid2X2, Monitor, Play, Plus, Search, Smartphone, Sparkles, X } from 'lucide-react';
import type { PublicGame } from '../../../shared/types';
import { canAccessAdmin } from '../../../shared/account';
import { api } from '../../api';
import { FavoriteButton, PlayerLibrarySections } from '../../player-library';
import { SessionContext } from '../../environment/session';
import { Spinner, Empty, ErrorMessage } from '../../ui/status';
import { date } from '../../ui/date';

export function Lobby() {
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
