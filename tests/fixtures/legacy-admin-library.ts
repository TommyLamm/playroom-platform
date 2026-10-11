import { desc } from 'drizzle-orm';
import { games, versions, repositories, jobs, type Store } from '../../server/db.js';

// Frozen pre-pagination algorithm, retained only for repeatable measurement and fixtures.
export function legacyAdminLibrary(store: Store) {
  const allVersions = store.db.select().from(versions).orderBy(desc(versions.id)).all();
  return store.db.select().from(games).all().map((game) => ({ ...game, versions: allVersions.filter((version) => version.gameId === game.id) }));
}
export function legacyAdminOverview(store: Store) {
  return { games: legacyAdminLibrary(store), repositories: store.db.select().from(repositories).all(), jobs: store.db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(50).all() };
}
