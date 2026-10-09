import { selectAdminPage } from './helpers/admin';
import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  // Keep this suite's logins out of other suites' per-IP rate-limit budget.
  await page.route(/\/api\/v1\/login$/, (route) => route.continue({ headers: {
    ...route.request().headers(), 'x-forwarded-for': '192.0.2.121',
  } }));
  await page.goto('/admin');
  await page.getByLabel('帳號', { exact: true }).fill('admin');
  await page.getByLabel('密碼', { exact: true }).fill('e2e-only-password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '遊戲更新', level: 1, exact: true })).toBeVisible();
}
test('entering admin discovers releases, batch imports, sequentially reviews and publishes two games', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let checks = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/admin/source-checks')) checks++; });
  await login(page);
  const session = await (await page.request.get('/api/v1/session')).json();
  const headers = { Origin: 'http://localhost:3070', 'X-CSRF-Token': session.csrf };
  const names = [`${testInfo.project.name}-a`, `${testInfo.project.name}-b`];
  const repositoryIds: number[] = [];
  for (const name of names) {
    const response = await page.request.post('/api/v1/admin/repositories', { headers, data: { fullName: `updates/${name}` } });
    expect(response.status()).toBe(201); repositoryIds.push((await response.json()).repository.id);
  }
  try {
    await page.goto('/');
    const beforeEntry = checks;
    await page.goto('/admin');
    await selectAdminPage(page, /^遊戲更新/);
    await expect.poll(() => checks).toBe(beforeEntry + 1);
    for (const name of names) await expect(page.getByRole('checkbox', { name: `更新 updates/${name}`, exact: true })).toBeEnabled();
    for (const name of names) await page.getByRole('checkbox', { name: `更新 updates/${name}`, exact: true }).check();
    await page.getByRole('button', { name: '匯入所選更新（2）', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('radio', { checked: true })).toHaveCount(2);
    await page.getByRole('button', { name: '匯入 2 款遊戲', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('已匯入', { exact: true })).toHaveCount(2);
    await page.getByRole('dialog').getByRole('button', { name: '關閉', exact: true }).click();
    await expect(page.getByRole('button', { name: '發布所選版本（0）', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '預覽所選版本（2）', exact: true }).click();
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('#start')).toBeVisible();
    await frame.locator('#start').click(); await frame.locator('.tile.lit').click();
    await expect(frame.locator('#score')).toHaveText('01');
    await page.getByRole('button', { name: '確認通過並看下一款', exact: true }).click();
    await expect(frame.locator('#start')).toBeVisible();
    await frame.locator('#start').click(); await frame.locator('.tile.lit').click();
    await page.getByRole('button', { name: '確認通過', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.game-update-table .badge').filter({ hasText: '已確認待發布' })).toHaveCount(2);
    await page.reload();
    await selectAdminPage(page, /^遊戲更新/);
    await expect(page.locator('.game-update-table .badge').filter({ hasText: '已確認待發布' })).toHaveCount(2);
    const row = page.locator('.game-update-table tbody tr').filter({ hasText: `更新測試 ${names[0]}` });
    await row.getByRole('button', { name: '撤銷確認', exact: true }).click();
    await expect(row.getByText('待預覽確認', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: '預覽', exact: true }).click();
    await expect(frame.locator('#start')).toBeVisible();
    await page.getByRole('button', { name: '確認通過', exact: true }).click();
    await page.getByRole('button', { name: '選取全部已確認版本', exact: true }).click();
    if (testInfo.project.name === 'mobile') {
      expect(await page.locator('.game-update-table').evaluate((table) => table.getBoundingClientRect().width <= table.parentElement!.clientWidth)).toBe(true);
    }
    await page.screenshot({ path: `output/playwright/game-updates-ready-${testInfo.project.name}.png`, fullPage: true });
    await page.getByRole('button', { name: '發布所選版本（2）', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '確認批量發布 2 款遊戲', exact: true });
    for (const name of names) await expect(confirmation).toContainText(`更新測試 ${name}`);
    await expect(confirmation.locator('li')).toHaveCount(2);
    await page.getByRole('button', { name: '確認發布', exact: true }).click();
    await expect(page.locator('.update-results')).toContainText('已發布');
    const publicGames = await (await page.request.get('/api/v1/games')).json();
    for (const name of names) expect(publicGames.games.some((g: { id: string }) => g.id === `updates-${name}`)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const afterOperations = checks;
    await page.waitForResponse((response) => response.url().endsWith('/api/v1/admin/overview'));
    expect(checks).toBe(afterOperations, 'polling overview does not start a GitHub check');
    await page.screenshot({ path: `output/playwright/game-updates-${testInfo.project.name}.png`, fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    for (const name of names) await page.request.post(`/api/v1/admin/games/updates-${name}/unpublish`, { headers, data: {} });
    for (const id of repositoryIds) await page.request.post(`/api/v1/admin/repositories/${id}/state`, { headers, data: { archived: true } });
  }
});
test('update selection survives pagination and filtering without resetting other pages', async ({ page }) => {
  const sources = Array.from({ length: 27 }, (_, i) => ({ id: 10000 + i, fullName: `pagination/game-${String(i).padStart(2, '0')}`,
    createdAt: '2026-10-10', archived: false, checkedAt: '2026-10-10', checkError: null, importedReleaseIds: [],
    gameId: null, gameName: null, importedVersion: null, status: 'available',
    releases: [{ id: i + 5000, tag: 'v1.0.0', name: 'Stable', publishedAt: '2026-10-10', prerelease: false, asset: { id: i + 6000, name: 'game.zip', size: 100 } }],
  }));
  await page.route('**/api/v1/admin/sources', (route) => route.fulfill({ json: { sources } }));
  await login(page);
  await selectAdminPage(page, /^遊戲更新/);
  await page.getByRole('checkbox', { name: '更新 pagination/game-00', exact: true }).check();
  await page.getByRole('button', { name: '下一頁', exact: true }).click();
  await page.getByRole('checkbox', { name: '更新 pagination/game-26', exact: true }).check();
  await expect(page.getByRole('button', { name: '匯入所選更新（2）', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: '搜尋遊戲更新', exact: true }).fill('game-00');
  await expect(page.getByRole('checkbox', { name: '更新 pagination/game-00', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: '匯入所選更新（2）', exact: true })).toBeEnabled();
});
