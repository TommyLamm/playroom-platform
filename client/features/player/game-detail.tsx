import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Monitor, Play, Smartphone } from 'lucide-react';
import { LeaderboardPanel } from '../../career';
import { FavoriteButton, LibraryError } from '../../player-library';
import { useGame } from './use-game';
import { Spinner, Empty, ErrorMessage } from '../../ui/status';
import { date } from '../../ui/date';

export function GameDetail() {
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
