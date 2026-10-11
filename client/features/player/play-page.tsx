import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useGame } from './use-game';
import { GameFrame } from './game-frame';
import { Spinner, Empty, ErrorMessage } from '../../ui/status';

export function PlayPage() {
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
