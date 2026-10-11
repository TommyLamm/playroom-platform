import { test, expect } from '@playwright/test';
import type { AdminGame } from '../../shared/types';
import { testManifest } from '../helpers';
import { mockAdminData } from './helpers/admin-fixtures';
import { selectAdminPage } from './helpers/admin';

test('late reads, status polling, page visibility and revoked roles preserve the current admin data scope', async ({ page }) => {
  const games: AdminGame[] = ['Old game', 'Latest game'].map((name, i) => ({ id: `read-${i}`, repositoryId: null, activeVersion: '1.0.0', published: true,
    versions: [{ id: i + 1, gameId: `read-${i}`, version: '1.0.0', manifest: { ...testManifest, id: `read-${i}`, name }, sha256: 'fixture', releaseId: null, assetId: null, releaseTag: null, importedAt: '2026-10-11', publishedAt: '2026-10-11', reviewedAt: null, reviewedBy: null }] }));
  await mockAdminData(page, () => games);
  let gameReads = 0, taskReads = 0, revoked = false;
  page.on('request', (request) => { const path = new URL(request.url()).pathname; if (path === '/api/v1/admin/games') gameReads++; if (path === '/api/v1/admin/tasks') taskReads++; });
  await page.route(/\/api\/v1\/admin\/games\?/, async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') === 'Old') {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ json: { items: [{ id: 'old-late', name: 'Late old response', repositoryId: null, repositoryName: null, published: true, activeVersion: '1.0.0', latestVersion: '1.0.0', latestImportedAt: null, pendingCount: 0, versionCount: 1, defaultDraft: null }], total: 1, page: 1, size: 20 } }).catch(() => {});
    } else await route.fallback();
  });
  await page.route('**/api/v1/session', async (route) => {
    const response = await route.fetch(), session = await response.json();
    await route.fulfill({ json: revoked && session.authenticated ? { ...session, role: 'player' } : session });
  });
  await page.route('**/api/v1/login', (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': '192.0.2.181' } }));
  await page.goto('/admin');
  await page.getByLabel('帳號', { exact: true }).fill('admin');
  await page.getByLabel('密碼', { exact: true }).fill('e2e-only-password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await selectAdminPage(page, '遊戲與版本');
  await expect(page.locator('.admin-games-table tbody tr')).toHaveCount(2);
  const search = page.getByLabel('搜尋管理遊戲');
  await search.fill('Old');
  await search.fill('Latest');
  await expect(page.locator('.admin-games-table')).toContainText('Latest game');
  await page.waitForTimeout(1700);
  await expect(page.locator('.admin-games-table')).not.toContainText('Late old response');
  const settledReads = gameReads;
  await page.waitForResponse((response) => response.url().endsWith('/api/v1/admin/tasks'));
  expect(gameReads).toBe(settledReads, 'status polling does not reload a list');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenTasks = taskReads;
  await page.waitForTimeout(3300);
  expect(taskReads).toBe(hiddenTasks, 'hidden pages pause task polling');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => taskReads).toBeGreaterThan(hiddenTasks);
  revoked = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '這裡是管理員工作區', exact: true })).toBeVisible();
  await expect(page.locator('.admin-games-table')).toHaveCount(0);
  const stoppedReads = gameReads, stoppedTasks = taskReads;
  await page.waitForTimeout(3300);
  expect(gameReads).toBe(stoppedReads); expect(taskReads).toBe(stoppedTasks);
});
