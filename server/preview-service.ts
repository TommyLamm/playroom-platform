import { eq, lt } from 'drizzle-orm';
import { previews, type Store } from './db.js';
import type { Config } from './config.js';
import { hashToken, token } from './auth.js';
import { readVersion } from './game-catalog.js';
import { AppError } from './errors.js';
import type { CommandResponses } from '../shared/commands.js';

export function createPreview(store: Store, config: Config, id: string, version: string): CommandResponses['preview'] {
  const record = readVersion(store, id, version);
  if (!record) throw new AppError(404, '找不到遊戲版本');
  store.db.delete(previews).where(lt(previews.expiresAt, Date.now())).run();
  const raw = token(), expiresAt = Date.now() + 15 * 60 * 1000;
  store.db.insert(previews).values({ tokenHash: hashToken(raw), gameId: id, version, expiresAt }).run();
  return { url: `${config.gamesOrigin}/preview/${raw}/${id}/${version}/${record.manifest.entry}`, expiresAt };
}

export function requirePreview(store: Store, raw: string, id: string, version: string) {
  const grant = store.db.select().from(previews).where(eq(previews.tokenHash, hashToken(raw))).get();
  if (!grant || grant.gameId !== id || grant.version !== version || grant.expiresAt <= Date.now())
    throw new AppError(403, '預覽連結已失效，請回到後台重新預覽');
}
