import { test, expect, type Page } from '@playwright/test';
import type { AdminGame } from '../../shared/types';
import type { Source } from '../../shared/sources';
import { testManifest } from '../helpers';
import { selectAdminPage } from './helpers/admin';

async function login(page: Page, username = 'admin') {
  await page.route(/\/api\/v1\/login$/, (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': '192.0.2.155' } }));
  await page.goto('/admin');
  await page.getByLabel('帳號', { exact: true }).fill(username);
  await page.getByLabel('密碼', { exact: true }).fill('e2e-only-password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.locator('.account-name')).toHaveText(username);
}

const fixtureGames = (): AdminGame[] => Array.from({ length: 120 }, (_, i) => ({
  id: `catalog-${String(i).padStart(3, '0')}`, repositoryId: i + 20000, activeVersion: i % 2 === 0 ? '1.0.0' : null, published: i % 2 === 0,
  versions: Array.from({ length: i === 0 ? 24 : 1 }, (_, v) => ({ id: i * 100 + v + 1, gameId: `catalog-${String(i).padStart(3, '0')}`, version: v === 23 || i !== 0 ? '1.0.0' : `2.${23 - v}.0`,
    manifest: { ...testManifest, id: `catalog-${String(i).padStart(3, '0')}`, name: `遊戲 ${String(i).padStart(3, '0')}` },
    sha256: 'a'.repeat(64), releaseId: null, assetId: null, releaseTag: null,
    importedAt: new Date(Date.UTC(2026, 0, 1 + i, 0, 0, 24 - v)).toISOString(), publishedAt: i % 2 === 0 ? '2026-01-01T00:00:00Z' : null,
    reviewedBy: null, reviewedAt: null,
  })),
}));

test('120-game catalog stays compact, preserves filters and manages paginated versions with keyboard focus', async ({ page }, info) => {
  const games = fixtureGames();
  const repositories = games.map((g) => ({ id: g.repositoryId!, fullName: `catalog/repo-${g.id}`, createdAt: '2026-01-01' }));
  await page.route('**/api/v1/admin/overview', (route) => route.fulfill({ json: { games, repositories, jobs: [] } }));
  await page.route('**/api/v1/admin/sources', (route) => route.fulfill({ json: { sources: [] } }));
  await login(page);
  await expect(page.getByRole('heading', { name: '遊戲更新', level: 1, exact: true })).toBeVisible();
  await selectAdminPage(page, '遊戲與版本');
  const table = page.locator('.admin-games-table');
  await expect(table.locator('tbody tr')).toHaveCount(20);
  await expect(page.locator('.admin-pagination').first()).toContainText('120 款 · 第 1 / 6 頁');
  await page.getByRole('button', { name: '下一頁', exact: true }).click();
  await expect(table).toContainText('遊戲 020');
  await page.waitForResponse((r) => r.url().endsWith('/api/v1/admin/overview'));
  await expect(page.locator('.admin-pagination').first()).toContainText('第 2 / 6 頁');
  await selectAdminPage(page, /^遊戲更新/);
  await selectAdminPage(page, '遊戲與版本');
  await expect(table).toContainText('遊戲 020');
  await page.getByLabel('每頁遊戲數量').selectOption('50');
  await expect(table.locator('tbody tr')).toHaveCount(50);
  await page.getByLabel('每頁遊戲數量').selectOption('100');
  await expect(table.locator('tbody tr')).toHaveCount(100);
  await page.getByLabel('遊戲狀態', { exact: true }).selectOption('unpublished');
  await expect(table.locator('tbody tr')).toHaveCount(60);
  await page.getByLabel('遊戲狀態', { exact: true }).selectOption('pending');
  await expect(table.locator('tbody tr')).toHaveCount(60);
  await page.getByLabel('遊戲狀態', { exact: true }).selectOption('all');
  await page.getByLabel('遊戲排序').selectOption('recent');
  await expect(table.locator('tbody tr').first()).toContainText('遊戲 119');
  await page.getByLabel('搜尋管理遊戲').fill('repo-catalog-000');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  const opener = page.getByRole('button', { name: '管理版本 遊戲 000', exact: true });
  await opener.click();
  const drawer = page.getByRole('dialog', { name: '管理版本 · 遊戲 000', exact: true });
  await expect(drawer.getByRole('radio')).toHaveCount(10);
  await expect(drawer.locator('.selected-version')).toContainText('v1.0.0');
  await drawer.getByRole('button', { name: '下一頁版本' }).click();
  await drawer.getByRole('button', { name: '下一頁版本' }).click();
  await expect(drawer.getByRole('radio')).toHaveCount(4);
  await drawer.getByLabel('搜尋版本', { exact: true }).fill('2.23');
  await drawer.getByRole('radio', { name: 'v2.23.0', exact: true }).check();
  await expect(drawer.locator('.selected-version')).toContainText('v2.23.0');
  await drawer.getByText('版本來源與校驗', { exact: true }).click();
  await expect(drawer).toContainText('a'.repeat(64));
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.getByLabel('搜尋管理遊戲')).toHaveValue('repo-catalog-000');
  await page.getByLabel('搜尋管理遊戲').fill('');
  await page.getByLabel('每頁遊戲數量').selectOption('20');
  await page.getByLabel('遊戲排序').selectOption('name');
  if (info.project.name === 'desktop') {
    const scroll = page.locator('.admin-games-panel .admin-list-scroll');
    const before = await table.locator('thead th').first().boundingBox();
    await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const after = await table.locator('thead th').first().boundingBox();
    expect(Math.abs(before!.y - after!.y)).toBeLessThan(2);
    const pagination = await page.locator('.admin-games-panel .admin-pagination').boundingBox();
    expect(pagination!.y + pagination!.height).toBeLessThanOrEqual(1000);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `output/playwright/admin-catalog-${width}.png`, fullPage: true });
      await opener.click();
      const bounds = await drawer.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(await drawer.locator('.version-picker table').evaluate((table) => table.getBoundingClientRect().width <= table.parentElement!.clientWidth)).toBe(true);
      await page.screenshot({ path: `output/playwright/admin-version-drawer-${width}.png` });
      await page.keyboard.press('Escape');
    }
  } else expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('integrated source management discovers, pastes, checks, archives and restores while retaining cross-filter selection', async ({ page }) => {
  let sources: Source[] = [];
  const checked: number[] = [];
  let nextId = 30000;
  const add = (fullName: string) => {
    const source: Source = { id: nextId++, fullName, createdAt: '2026-01-01', archived: false, checkedAt: null, checkError: null, releases: [], importedReleaseIds: [], gameId: null, gameName: null, importedVersion: null, status: 'unchecked' };
    sources = [...sources, source]; return source;
  };
  await page.route('**/api/v1/admin/sources', (route) => route.fulfill({ json: { sources } }));
  await page.route('**/api/v1/admin/repositories', (route) => route.fulfill({ status: 201, json: { repository: add(route.request().postDataJSON().fullName) } }));
  await page.route('**/api/v1/admin/github-owners', (route) => route.fulfill({ json: route.request().method() === 'POST' ? { owner: { login: 'catalog', kind: 'Organization', createdAt: '2026-01-01' } } : { owners: [] } }));
  await page.route('**/api/v1/admin/github-owners/catalog/repositories?*', (route) => route.fulfill({ json: { repositories: [{ fullName: 'catalog/discovered', description: 'Discovered game', archived: false, fork: false, added: false }], hasMore: false } }));
  await page.route(/\/api\/v1\/admin\/repositories\/\d+\/(state|check)$/, (route) => {
    const id = Number(route.request().url().split('/').at(-2));
    sources = sources.map((s) => s.id !== id ? s : route.request().url().endsWith('/state') ? { ...s, archived: route.request().postDataJSON().archived } : { ...s, checkedAt: '2026-10-10T00:00:00Z' });
    if (route.request().url().endsWith('/check')) checked.push(id);
    return route.fulfill({ json: { source: sources.find((s) => s.id === id) } });
  });
  await login(page);
  await expect(page.getByRole('button', { name: '遊戲來源', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '加入來源', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '加入遊戲來源', exact: true });
  await dialog.getByLabel('GitHub 帳號或組織').fill('catalog');
  await dialog.getByRole('button', { name: '保存並探索' }).click();
  await dialog.getByRole('checkbox', { name: '加入 catalog/discovered', exact: true }).check();
  await dialog.getByRole('button', { name: '加入 1 個來源', exact: true }).click();
  await expect(dialog).toContainText('已加入');
  await dialog.getByRole('button', { name: '貼上多個來源', exact: true }).click();
  await dialog.getByLabel('Repository', { exact: true }).fill('other/pasted\ncatalog/pasted');
  await dialog.getByRole('button', { name: '加入來源', exact: true }).click();
  await expect(dialog.getByText('已加入', { exact: true })).toHaveCount(2);
  await dialog.getByRole('button', { name: '關閉', exact: true }).click();
  await page.getByRole('checkbox', { name: '更新 catalog/discovered', exact: true }).check();
  await page.getByLabel('開發者篩選').selectOption('other');
  await page.getByRole('checkbox', { name: '更新 other/pasted', exact: true }).check();
  await expect(page.getByRole('button', { name: '檢查所選來源（2）', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '檢查所選來源（2）', exact: true }).click();
  await expect.poll(() => checked.length).toBe(2);
  await expect(page.getByRole('button', { name: '封存所選來源（2）', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '封存所選來源（2）', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '封存遊戲來源', exact: true });
  await expect(confirmation.locator('li')).toHaveCount(2);
  await expect(confirmation).toContainText('上架狀態會保留');
  await confirmation.getByRole('button', { name: '確認', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByLabel('開發者篩選')).toHaveValue('other');
  await page.getByLabel('來源範圍').selectOption('archived');
  await page.getByRole('checkbox', { name: '更新 other/pasted', exact: true }).check();
  await expect(page.getByRole('button', { name: '匯入所選更新（0）', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '選其他 Release', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '恢復所選來源（1）', exact: true }).click();
  await page.getByRole('dialog', { name: '恢復遊戲來源', exact: true }).getByRole('button', { name: '確認', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('來源範圍').selectOption('active');
  await page.getByLabel('更新狀態').selectOption('all');
  await expect(page.getByRole('checkbox', { name: '更新 other/pasted', exact: true })).toBeVisible();
});

test('admin navigation follows manager and analyst permissions and closes mobile drawers', async ({ page }) => {
  for (const role of ['game_manager', 'analyst']) {
    await login(page, `ui-${role}`);
    await expect(page.getByRole('heading', { name: role === 'game_manager' ? '遊戲更新' : '營運概況', level: 1, exact: true })).toBeVisible();
    const opener = page.getByRole('button', { name: '開啟後台導覽', exact: true });
    if (await opener.isVisible()) await opener.click();
    const nav = page.getByRole('navigation', { name: '後台導覽', exact: true });
    await expect(nav.getByRole('button')).toHaveCount(role === 'game_manager' ? 3 : 1);
    await expect(nav.getByRole('button', { name: '帳號權限' })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: '平台更新' })).toHaveCount(0);
    if (await opener.isVisible()) {
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
    }
    if (role === 'game_manager') await selectAdminPage(page, '遊戲與版本');
    await page.getByRole('button', { name: '登出', exact: true }).click();
    await expect(page.getByRole('heading', { name: '歡迎回來' })).toBeVisible();
  }
});
