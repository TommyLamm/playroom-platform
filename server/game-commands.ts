import { and, eq } from 'drizzle-orm';
import { games, versions, type Store } from './db.js';
import { commandActor } from './command-context.js';
import type { CommandInput, CommandResponses, ExpectedGameState, PublishSelection, PublishStatus } from '../shared/commands.js';
import { compareVersions } from '../shared/game-updates.js';
import { AppError } from './errors.js';
import { publish } from './library.js';

function assertState(game: typeof games.$inferSelect, expected: ExpectedGameState) {
  if (game.activeVersion !== expected.expectedActiveVersion || game.published !== expected.expectedPublished)
    throw new AppError(409, '上架狀態已由其他管理者修改，請刷新並重新確認', 'STATE_CONFLICT',
      { activeVersion: game.activeVersion, published: game.published });
}

export function publishGame(store: Store, actorId: number, item: PublishSelection, mode: 'single' | 'batch'): PublishStatus {
  return store.sqlite.transaction((): PublishStatus => {
    commandActor(store, actorId, 'games.manage');
    const game = store.db.select().from(games).where(eq(games.id, item.gameId)).get();
    const stored = store.db.select().from(versions).where(and(eq(versions.gameId, item.gameId), eq(versions.version, item.version))).get();
    if (!game || !stored) throw new AppError(404, '找不到此遊戲版本');
    if (game.published && game.activeVersion === item.version) return 'skipped';
    assertState(game, item);
    if (game.activeVersion && compareVersions(item.version, game.activeVersion) <= 0 &&
        (!stored.publishedAt || mode === 'batch' && item.version !== game.activeVersion))
      throw new AppError(409, '更新版本必須高於目前版本；歷史版本回退請使用「遊戲與版本」', 'VERSION_NOT_NEWER');
    if (!stored.publishedAt && !stored.reviewedAt)
      throw new AppError(409, '請先預覽並確認此版本通過驗收', 'REVIEW_REQUIRED');
    publish(store, item.gameId, item.version);
    return 'published';
  }).immediate();
}

export function unpublishGame(store: Store, actorId: number, id: string, expected: ExpectedGameState): CommandResponses['unpublish'] {
  return store.sqlite.transaction((): CommandResponses['unpublish'] => {
    commandActor(store, actorId, 'games.manage');
    const game = store.db.select().from(games).where(eq(games.id, id)).get();
    if (!game) throw new AppError(404, '找不到遊戲');
    // A changed active version is still a conflict even if someone already hid it.
    if (!game.published && game.activeVersion === expected.expectedActiveVersion) return { ok: true, status: 'skipped' };
    assertState(game, expected);
    store.db.update(games).set({ published: false }).where(eq(games.id, id)).run();
    return { ok: true, status: 'unpublished' };
  }).immediate();
}

export function reviewGame(store: Store, actorId: number, id: string, input: CommandInput<'review'>): CommandResponses['review'] {
  return store.sqlite.transaction(() => {
    const actor = commandActor(store, actorId, 'games.manage');
    const stored = store.db.select().from(versions).where(and(eq(versions.gameId, id), eq(versions.version, input.version))).get();
    if (!stored) throw new AppError(404, '找不到此遊戲版本');
    if (!!stored.reviewedAt === input.approved) return { version: stored };
    const record = store.db.update(versions).set({ reviewedBy: input.approved ? actor.username : null,
      reviewedAt: input.approved ? new Date().toISOString() : null }).where(eq(versions.id, stored.id)).returning().get()!;
    return { version: record };
  }).immediate();
}
