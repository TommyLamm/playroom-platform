import type { Store } from './db.js';
import { readAccount } from './account-session-service.js';
import { hasPermission, type Permission } from '../shared/account.js';
import { AppError } from './errors.js';

// Re-read permissions inside the write transaction, including for target-state retries.
export function commandActor(store: Store, actorId: number, permission: Permission) {
  const actor = readAccount(store, actorId);
  if (!actor) throw new AppError(401, '登入已失效，請重新登入');
  if (!hasPermission(actor.role, permission)) throw new AppError(403, '你的帳號沒有使用此功能的權限');
  return actor;
}
