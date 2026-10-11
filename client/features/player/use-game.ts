import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PublicGame } from '../../../shared/types';
import { api } from '../../api';


export function useGame() {
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
