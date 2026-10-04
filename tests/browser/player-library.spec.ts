import { test, expect, type Page } from '@playwright/test';

test('recent games and favorites persist across devices and stay isolated between accounts', async ({ page, browser }, info) => {
  const username = `library_${info.project.name}`;
  const password = 'library-browser-password';
  const address = info.project.name === 'mobile' ? '192.0.2.62' : '192.0.2.61';
  async function scopeAuth(target: Page) {
    await target.route(/\/api\/v1\/(register|login)$/, (route) => route.continue({
      headers: { ...route.request().headers(), 'x-forwarded-for': address },
    }));
  }
  async function register(name: string) {
    await page.goto('/register');
    await page.getByLabel('帳號', { exact: true }).fill(name);
    await page.getByLabel('密碼', { exact: true }).fill(password);
    await page.getByLabel('確認密碼', { exact: true }).fill(password);
    await page.getByRole('button', { name: '建立帳號', exact: true }).click();
    await expect(page.locator('.account-name')).toHaveText(name);
  }
  await scopeAuth(page);
  let failReadOnce = true;
  await page.route('**/api/v1/me/library', async (route) => {
    if (failReadOnce) {
      failReadOnce = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '清單測試連線中斷' }) });
    } else await route.continue();
  });
  await register(username);
  const recent = page.locator('section[aria-label="最近遊玩"]');
  const favorites = page.locator('section[aria-label="我的收藏"]');
  await expect(recent).toBeVisible();
  await expect(favorites).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '清單測試連線中斷' }).first()).toBeVisible();
  await page.getByRole('alert').filter({ hasText: '清單測試連線中斷' }).first().getByRole('button', { name: '重試', exact: true }).click();
  await expect(favorites.getByRole('link', { name: '開始遊戲光點反應', exact: true })).toHaveCount(0);

  let failOnce = true;
  await page.route('**/api/v1/me/favorites/signal-tap', async (route) => {
    if (failOnce) {
      failOnce = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '收藏測試連線中斷' }) });
    } else await route.continue();
  });
  const catalog = page.locator('section[aria-label="遊戲目錄"]');
  await catalog.getByRole('button', { name: '收藏光點反應', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '收藏測試連線中斷' }).first()).toBeVisible();
  await catalog.getByRole('button', { name: '收藏光點反應', exact: true }).click();
  await expect(favorites.getByRole('link', { name: '開始遊戲光點反應', exact: true })).toBeVisible();
  await favorites.getByRole('link', { name: '開始遊戲光點反應', exact: true }).click();
  await expect(page.locator('.record-status')).toContainText('遊戲記錄已連線');
  await page.locator('.site-header nav').getByRole('link', { name: '遊戲大廳' }).click();
  await expect(recent.getByRole('link', { name: '繼續遊玩光點反應', exact: true })).toBeVisible();
  await recent.getByRole('link', { name: '繼續遊玩光點反應', exact: true }).click();
  await expect(page.locator('.record-status')).toContainText('遊戲記錄已連線');
  await page.locator('.site-header nav').getByRole('link', { name: '遊戲大廳' }).click();
  await expect(recent.getByRole('link', { name: '繼續遊玩光點反應', exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/library-${info.project.name}.png`, fullPage: true });

  const deviceContext = await browser.newContext();
  try {
    const device = await deviceContext.newPage();
    await scopeAuth(device);
    await device.goto('http://localhost:3070/login');
    await device.getByLabel('帳號', { exact: true }).fill(username);
    await device.getByLabel('密碼', { exact: true }).fill(password);
    await device.getByRole('button', { name: '登入', exact: true }).click();
    await expect(device.locator('.account-name')).toHaveText(username);
    await expect(device.locator('section[aria-label="我的收藏"]').getByRole('link', { name: '開始遊戲光點反應', exact: true })).toBeVisible();
    await expect(device.locator('section[aria-label="最近遊玩"]').getByRole('link', { name: '繼續遊玩光點反應', exact: true })).toBeVisible();
    await device.goto('http://localhost:3070/games/signal-tap');
    await device.getByRole('button', { name: '取消收藏光點反應', exact: true }).click();
    await expect(device.getByRole('button', { name: '收藏光點反應', exact: true })).toBeVisible();
    await page.reload();
    await expect(favorites.getByRole('link', { name: '開始遊戲光點反應', exact: true })).toHaveCount(0);
    await expect(catalog.getByRole('button', { name: '收藏光點反應', exact: true })).toBeEnabled();
    await catalog.getByRole('button', { name: '收藏光點反應', exact: true }).click();
    await expect(favorites.getByRole('link', { name: '開始遊戲光點反應', exact: true })).toBeVisible();
  } finally { await deviceContext.close(); }

  await page.locator('.account-menu summary').click();
  await page.getByRole('button', { name: '登出帳號', exact: true }).click();
  await expect(page.locator('.account-name')).toHaveCount(0);
  await expect(recent).toHaveCount(0);
  await expect(favorites).toHaveCount(0);
  await register(`${username}_other`);
  await expect(favorites).toBeVisible();
  await expect(catalog.getByRole('button', { name: '收藏光點反應', exact: true })).toBeEnabled();
  const ownLibrary = await (await page.request.get('/api/v1/me/library')).json();
  expect(ownLibrary).toEqual({ recent: [], favorites: [] });
  await expect(favorites.getByRole('link', { name: '開始遊戲光點反應', exact: true })).toHaveCount(0);
  await expect(recent.getByRole('link', { name: '繼續遊玩光點反應', exact: true })).toHaveCount(0);
});
