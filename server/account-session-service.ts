import { eq, lt } from 'drizzle-orm';
import { users, sessions, type Store } from './db.js';
import { hashToken, passwordHash, token, verifyPassword } from './auth.js';
import { AppError } from './errors.js';

export type StoredSession = typeof sessions.$inferSelect;
export type StoredAccount = typeof users.$inferSelect;

export function readAccount(store: Store, id: number) {
  return store.db.select().from(users).where(eq(users.id, id)).get();
}

/** Anonymous audience tracking only needs identity and role, never credentials. */
export function audienceAccount(store: Store, raw: string | undefined, now: number) {
  return raw ? store.sqlite.prepare(`SELECT u.id,u.role FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(hashToken(raw), now) as Pick<StoredAccount, 'id' | 'role'> | undefined : undefined;
}

/** Account/session persistence has no HTTP or cookie dependency. */
export class AccountSessions {
  constructor(private store: Store, private dummyPassword: string) {}

  requireSession(raw?: string): StoredSession {
    if (!raw) throw new AppError(401, '請先登入');
    const session = this.store.db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(raw))).get();
    if (!session || session.expiresAt <= Date.now()) throw new AppError(401, '登入已過期，請重新登入');
    return session;
  }

  start(user: StoredAccount, old?: string) {
    const raw = token(), csrf = token();
    this.store.db.transaction((tx) => {
      tx.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
      if (old) tx.delete(sessions).where(eq(sessions.tokenHash, hashToken(old))).run();
      tx.insert(sessions).values({ tokenHash: hashToken(raw), userId: user.id, csrf,
        expiresAt: Date.now() + 8 * 60 * 60 * 1000 }).run();
    });
    return { raw, csrf };
  }

  async register(username: string, password: string) {
    if (this.store.db.select({ id: users.id }).from(users).where(eq(users.username, username)).get())
      throw new AppError(409, '這個帳號已被使用');
    const hashed = await passwordHash(password);
    // ON CONFLICT also handles simultaneous registration of the same username.
    const user = this.store.db.insert(users)
      .values({ username, password: hashed, role: 'player', createdAt: new Date().toISOString() })
      .onConflictDoNothing().returning().get();
    if (!user) throw new AppError(409, '這個帳號已被使用');
    return user;
  }

  async login(username: string, password: string) {
    const user = this.store.db.select().from(users).where(eq(users.username, username.trim())).get();
    const valid = await verifyPassword(password, user?.password || this.dummyPassword);
    if (!user || !valid) throw new AppError(401, '帳號或密碼不正確');
    const current = readAccount(this.store, user.id);
    if (!current || current.password !== user.password) throw new AppError(401, '帳號或密碼不正確');
    return current;
  }

  logout(session: StoredSession) {
    this.store.db.delete(sessions).where(eq(sessions.tokenHash, session.tokenHash)).run();
  }
}
