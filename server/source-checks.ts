import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { repositories, type Store } from './db.js';
import { AppError } from './errors.js';
import { GitHubRateLimitError, type GitHubSource } from './github.js';
import type { SourceCheck } from '../shared/game-updates.js';

export class SourceChecks {
  private tasks = new Map<number, Promise<boolean>>();
  private waiting: { id: number; resolve: (success: boolean) => void }[] = [];
  private active = 0;
  private closing = false;
  private retryAt = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  private round?: Promise<void>;
  private progress: SourceCheck | null = null;

  constructor(private store: Store, private github: GitHubSource) {}
  start(seconds: number) {
    clearInterval(this.interval);
    this.interval = setInterval(() => this.checkAll(), seconds * 1000);
    this.interval.unref();
  }
  current(): SourceCheck | null {
    return this.progress ? { ...this.progress, retryAt: this.retryAt > Date.now() ? this.retryAt : null } : null;
  }
  check(id: number): Promise<boolean> {
    if (this.closing) return Promise.resolve(false);
    const existing = this.tasks.get(id);
    if (existing) return existing;
    const task = new Promise<boolean>((resolve) => this.waiting.push({ id, resolve }));
    this.tasks.set(id, task);
    void task.then(() => { this.tasks.delete(id); });
    this.pump();
    return task;
  }
  checkAll() {
    if (this.closing) throw new AppError(503, '平台正在關閉');
    if (this.round) return this.current()!;
    const ids = this.store.db.select().from(repositories).all().filter((r) => !r.archived).map((r) => r.id);
    const progress: SourceCheck = { id: randomUUID(), status: 'running', total: ids.length, completed: 0, failed: 0,
      startedAt: new Date().toISOString(), finishedAt: null, retryAt: null };
    this.progress = progress;
    this.round = Promise.all(ids.map(async (id) => {
      const success = await this.check(id);
      progress.completed++;
      if (!success) progress.failed++;
    })).then(() => {
      progress.status = this.closing ? 'cancelled' : 'completed';
      progress.finishedAt = new Date().toISOString();
      this.round = undefined;
    });
    return this.current()!;
  }
  private pump() {
    if (this.closing) return;
    if (this.retryAt > Date.now()) {
      if (!this.retryTimer) {
        this.retryTimer = setTimeout(() => { this.retryTimer = undefined; this.pump(); }, Math.min(this.retryAt - Date.now(), 2147483647));
        this.retryTimer.unref();
      }
      return;
    }
    while (this.active < 3 && this.waiting.length) {
      const task = this.waiting.shift()!;
      this.active++;
      void this.run(task.id).then(task.resolve, () => task.resolve(false)).finally(() => { this.active--; this.pump(); });
    }
  }
  private async run(id: number) {
    const repo = this.store.db.select().from(repositories).where(eq(repositories.id, id)).get();
    if (!repo || repo.archived) return true;
    const checkedAt = new Date().toISOString();
    try {
      const cachedReleases = await this.github.releases(repo.fullName);
      this.store.db.update(repositories).set({ cachedReleases, checkedAt, checkError: null }).where(eq(repositories.id, id)).run();
      return true;
    } catch (error) {
      if (error instanceof GitHubRateLimitError) this.retryAt = Math.max(this.retryAt, error.retryAt);
      this.store.db.update(repositories).set({ checkedAt,
        checkError: error instanceof AppError ? error.message : '無法取得 GitHub Release，請重試',
      }).where(eq(repositories.id, id)).run();
      return false;
    }
  }
  async close() {
    this.closing = true;
    clearInterval(this.interval);
    clearTimeout(this.retryTimer);
    for (const task of this.waiting.splice(0)) task.resolve(false);
    await Promise.all(this.tasks.values());
    await this.round;
  }
}
