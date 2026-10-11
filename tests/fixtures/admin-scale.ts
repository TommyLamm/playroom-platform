import type { Store } from '../../server/db.js';
import { testManifest } from '../helpers.js';

export function seedAdminScale(store: Store, count = 1000, versionCount = 20) {
  const repo = store.sqlite.prepare('INSERT INTO repositories (id,full_name,created_at,checked_at,cached_releases) VALUES (?,?,?,?,?)');
  const game = store.sqlite.prepare('INSERT INTO games (id,repository_id,active_version,published) VALUES (?,?,?,?)');
  const version = store.sqlite.prepare('INSERT INTO versions (game_id,version,manifest,sha256,imported_at,published_at,reviewed_at,reviewed_by,release_id) VALUES (?,?,?,?,?,?,?,?,?)');
  store.sqlite.transaction(() => {
    for (let i = 0; i < count; i++) {
      const id = `scale-${String(i).padStart(4, '0')}`;
      repo.run(i + 1, `scale/game-${String(i).padStart(4, '0')}`, '2026-10-11', '2026-10-11', '[]');
      game.run(id, i + 1, '1.0.0', i % 2 === 0 ? 1 : 0);
      for (let v = 0; v < versionCount; v++) {
        const number = `${v + 1}.0.0`;
        const manifest = { ...testManifest, id, name: `Scale ${String(i).padStart(4, '0')}`, version: number };
        version.run(id, number, JSON.stringify(manifest), 'a'.repeat(64), new Date(Date.UTC(2026, 0, 1, 0, 0, v)).toISOString(), v === 0 ? '2026-01-01' : null, v === versionCount - 1 ? '2026-10-11' : null, v === versionCount - 1 ? 'admin' : null, v + 1);
      }
    }
  })();
}
