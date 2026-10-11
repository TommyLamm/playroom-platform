import { and, eq, inArray } from 'drizzle-orm';
import { repositories, githubOwners, jobs, type Store } from './db.js';
import { normalizeRepository, type GitHubSource } from './github.js';
import type { SourceChecks } from './source-checks.js';
import { readSource } from './admin-data-service.js';
import { AppError } from './errors.js';

export function createSourceService(store: Store, github: GitHubSource, checks: SourceChecks) {
  function repository(id: number) {
    const repo = store.db.select().from(repositories).where(eq(repositories.id, id)).get();
    if (!repo) throw new AppError(404, '找不到 repository');
    return repo;
  }
  return {
    owners: () => store.db.select().from(githubOwners).orderBy(githubOwners.login).all(),
    async addOwner(login: string) {
      const owner = await github.owner(login);
      store.db.insert(githubOwners).values({ ...owner, createdAt: new Date().toISOString() }).onConflictDoNothing().run();
      return store.db.select().from(githubOwners).where(eq(githubOwners.login, owner.login)).get()!;
    },
    removeOwner(login: string) {
      store.db.delete(githubOwners).where(eq(githubOwners.login, login.toLowerCase())).run();
      return { ok: true };
    },
    async discover(login: string, page: number) {
      const owner = store.db.select().from(githubOwners).where(eq(githubOwners.login, login.toLowerCase())).get();
      if (!owner) throw new AppError(404, '請先加入 GitHub 帳號');
      const result = await github.discover(owner.login, owner.kind, page);
      const known = new Set(store.db.select().from(repositories).all().map((r) => r.fullName));
      return { ...result, repositories: result.repositories.map((r) => ({ ...r, added: known.has(r.fullName.toLowerCase()) })) };
    },
    async addRepository(input: string) {
      const fullName = await github.checkRepository(normalizeRepository(input));
      const found = store.db.select().from(repositories).where(eq(repositories.fullName, fullName)).get();
      if (found) return { repository: found, created: false };
      const created = store.db.insert(repositories).values({ fullName, createdAt: new Date().toISOString() }).returning().get();
      return { repository: created, created: true };
    },
    archive(id: number, archived: boolean) {
      repository(id);
      if (archived && store.db.select().from(jobs).where(and(eq(jobs.repositoryId, id), inArray(jobs.status, ['queued', 'running']))).get())
        throw new AppError(409, '匯入中的來源請等待完成後再封存');
      store.db.update(repositories).set({ archived }).where(eq(repositories.id, id)).run();
      return { ok: true };
    },
    async check(id: number) {
      if (repository(id).archived) throw new AppError(409, '請先恢復已封存來源');
      await checks.checkForRequest(id);
      return readSource(store, id);
    },
    async releases(id: number) {
      repository(id);
      await checks.checkForRequest(id);
      const checked = repository(id);
      if (checked.checkError) throw new AppError(502, checked.checkError);
      return checked.cachedReleases;
    },
  };
}
