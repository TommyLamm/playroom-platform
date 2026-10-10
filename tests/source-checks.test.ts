import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { eq } from 'drizzle-orm';
import { openStore, repositories } from '../server/db.js';
import { SourceChecks } from '../server/source-checks.js';
import { GitHubRateLimitError } from '../server/github.js';
import { fakeGitHub } from './helpers.js';
import type { Release } from '../shared/types.js';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
async function fixture(t: TestContext, count: number, releases: (name: string) => Promise<Release[]>, unblock: () => void = () => {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-checks-'));
  const store = openStore(path.join(root, 'data'));
  const repos = Array.from({ length: count }, (_, i) => store.db.insert(repositories).values({ fullName: `owner/game-${i}`, createdAt: '2026-10-10' }).returning().get()!);
  const checks = new SourceChecks(store, { ...await fakeGitHub(root), releases });
  t.after(async () => { unblock(); await checks.close(); store.sqlite.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { store, checks, repos };
}
test('whole and per-source checks share requests, cap concurrency at three and skip archived sources', async (t) => {
  let active = 0, maximum = 0;
  const calls: string[] = [], gates: (() => void)[] = [];
  const { checks, store, repos } = await fixture(t, 8, async (name) => {
    calls.push(name); maximum = Math.max(maximum, ++active);
    await new Promise<void>((resolve) => gates.push(resolve)); active--; return [];
  }, () => gates.forEach((resolve) => resolve()));
  store.db.update(repositories).set({ archived: true }).where(eq(repositories.id, repos[7].id)).run();
  const first = checks.checkAll();
  assert.equal(first.id, checks.checkAll().id);
  const manual = checks.check(repos[0].id);
  assert.equal(checks.check(repos[0].id), manual);
  assert.equal(calls.length, 3);
  gates.slice(0, 3).forEach((resolve) => resolve()); await flush();
  assert.equal(calls.length, 6);
  gates.slice(3).forEach((resolve) => resolve()); await flush();
  gates.slice(6).forEach((resolve) => resolve()); await flush();
  assert.equal(await manual, true);
  assert.equal(maximum, 3); assert.equal(calls.length, 7); assert.ok(!calls.includes('owner/game-7'));
  assert.equal(checks.current()?.status, 'completed'); assert.equal(checks.current()?.completed, 7);
  assert.equal(store.db.select().from(repositories).all().filter((r) => r.checkedAt).length, 7);
});
test('rate limit preserves cache, pauses remaining requests until retryAt and recovers errors', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-10T00:00:00Z') });
  let calls = 0, limited = true;
  const { checks, store, repos } = await fixture(t, 5, async (name) => {
    calls++;
    if (name.endsWith('-0') && limited) throw new GitHubRateLimitError(Date.now() + 5000);
    return [];
  });
  const previous: Release[] = [{ id: 1, tag: 'v1.0.0', name: 'Previous', publishedAt: '2026-10-01', prerelease: false, asset: { id: 2, name: 'game.zip', size: 100 } }];
  store.db.update(repositories).set({ cachedReleases: previous }).where(eq(repositories.id, repos[0].id)).run();
  checks.checkAll(); await flush();
  assert.equal(calls, 3); assert.equal(checks.current()?.retryAt, Date.now() + 5000);
  const failed = store.db.select().from(repositories).where(eq(repositories.id, repos[0].id)).get()!;
  assert.deepEqual(failed.cachedReleases, previous); assert.match(failed.checkError!, /額度/);
  t.mock.timers.tick(4999); await flush(); assert.equal(calls, 3);
  limited = false;
  t.mock.timers.tick(1); await flush(); assert.equal(calls, 6); assert.equal(checks.current()?.status, 'completed');
  assert.equal(checks.current()?.completed, 5); assert.equal(checks.current()?.failed, 0);
  assert.equal(store.db.select().from(repositories).where(eq(repositories.id, repos[0].id)).get()!.checkError, null);
});

test('a quota-paused source retries even with no remaining sources, and repeated limits delay the same task', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-10T00:00:00Z') });
  let calls = 0;
  const { checks, repos, store } = await fixture(t, 1, async () => {
    if (++calls < 3) throw new GitHubRateLimitError(Date.now() + 5000);
    return [];
  });
  checks.checkAll();
  const task = checks.check(repos[0].id);
  await flush();
  assert.equal(checks.current()?.completed, 0);
  t.mock.timers.tick(5000); await flush();
  assert.equal(calls, 2); assert.equal(checks.current()?.status, 'running');
  assert.equal(checks.check(repos[0].id), task);
  t.mock.timers.tick(4999); await flush(); assert.equal(calls, 2);
  t.mock.timers.tick(1); await flush();
  assert.equal(await task, true);
  assert.equal(calls, 3); assert.equal(checks.current()?.status, 'completed');
  assert.equal(store.db.select().from(repositories).get()!.checkError, null);
});

test('automatic entry checks reuse recent successes but retry failures, stale and unchecked sources', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T00:00:00Z') });
  const calls: string[] = [];
  const { checks, store, repos } = await fixture(t, 4, async (name) => { calls.push(name); return []; });
  store.db.update(repositories).set({ checkedAt: new Date().toISOString() }).where(eq(repositories.id, repos[0].id)).run();
  store.db.update(repositories).set({ checkedAt: new Date().toISOString(), checkError: 'connection failed' }).where(eq(repositories.id, repos[1].id)).run();
  store.db.update(repositories).set({ checkedAt: new Date(Date.now() - 300000).toISOString() }).where(eq(repositories.id, repos[2].id)).run();
  assert.equal(checks.checkAll(false).total, 3); await flush();
  assert.deepEqual(calls.sort(), repos.slice(1).map((repo) => repo.fullName));
  assert.equal(checks.checkAll(false).total, 0); await flush(); assert.equal(calls.length, 3);
  assert.equal(checks.checkAll().total, 4); await flush(); assert.equal(calls.length, 7);
});

test('shutdown cancels a source that is itself waiting to retry after a rate limit', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-10T00:00:00Z') });
  let calls = 0;
  const { checks } = await fixture(t, 1, async () => { calls++; throw new GitHubRateLimitError(Date.now() + 5000); });
  checks.checkAll(); await flush();
  await checks.close();
  t.mock.timers.tick(5000); await flush();
  assert.equal(calls, 1); assert.equal(checks.current()?.status, 'cancelled');
});

test('HTTP checks return promptly on quota pauses while the shared background task retries', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-10T00:00:00Z') });
  let limited = true, calls = 0;
  const { checks, repos, store } = await fixture(t, 2, async () => {
    calls++;
    if (limited) throw new GitHubRateLimitError(Date.now() + 5000);
    return [];
  });
  const request = checks.checkForRequest(repos[0].id);
  assert.equal(checks.checkForRequest(repos[0].id), request);
  assert.equal(await request, false);
  assert.equal(await checks.checkForRequest(repos[1].id), false);
  assert.match(store.db.select().from(repositories).where(eq(repositories.id, repos[1].id)).get()!.checkError!, /額度/);
  assert.equal(calls, 1);
  const completion = checks.check(repos[0].id);
  await flush(); limited = false;
  t.mock.timers.tick(5000); await flush();
  assert.equal(await completion, true); assert.equal(calls, 3);
  assert.ok(store.db.select().from(repositories).all().every((repo) => repo.checkedAt && !repo.checkError));
});
test('hourly scheduling checks without an open page and close cancels the timer', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: new Date('2026-10-10T00:00:00Z') });
  let calls = 0;
  const { checks } = await fixture(t, 1, async () => { calls++; return []; });
  checks.start(3600);
  t.mock.timers.tick(3599999); await flush(); assert.equal(calls, 0);
  t.mock.timers.tick(1); await flush(); assert.equal(calls, 1);
  t.mock.timers.tick(3600000); await flush(); assert.equal(calls, 2);
  await checks.close(); t.mock.timers.tick(3600000); await flush(); assert.equal(calls, 2);
});
test('shutdown stops queued work and waits for requests already in flight', async (t) => {
  const gates: (() => void)[] = [];
  let calls = 0;
  const { checks } = await fixture(t, 6, async () => { calls++; await new Promise<void>((resolve) => gates.push(resolve)); return []; }, () => gates.forEach((resolve) => resolve()));
  checks.checkAll(); let closed = false;
  const close = checks.close().then(() => { closed = true; });
  await flush(); assert.equal(closed, false); assert.equal(calls, 3);
  gates.forEach((resolve) => resolve()); await close;
  assert.equal(closed, true); assert.equal(calls, 3); assert.equal(checks.current()?.status, 'cancelled');
});
