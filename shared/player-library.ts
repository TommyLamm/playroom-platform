export type PlayerLibrary = {
  recent: { gameId: string; lastPlayedAt: string }[];
  favorites: { gameId: string; createdAt: string }[];
};
