import { and, eq } from 'drizzle-orm';
import { games, versions, type Store } from './db.js';
import { AppError } from './errors.js';
import { assertPublishSaveCompatibility } from './save-compatibility.js';

export { fileHash } from './version-files.js';
export { installVersion } from './installation-service.js';

export function publish(store: Store, id: string, version: string) {
  const stored = store.db
    .select()
    .from(versions)
    .where(and(eq(versions.gameId, id), eq(versions.version, version)))
    .get();
  if (!stored) throw new AppError(404, '找不到此遊戲版本');
  store.db.transaction((tx) => {
    assertPublishSaveCompatibility(store, stored.manifest);
    tx.update(versions)
      .set({ publishedAt: stored.publishedAt || new Date().toISOString() })
      .where(eq(versions.id, stored.id))
      .run();
    tx.update(games).set({ activeVersion: version, published: true }).where(eq(games.id, id)).run();
  });
}
