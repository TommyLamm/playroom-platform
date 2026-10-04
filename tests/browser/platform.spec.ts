import { test, expect } from '@playwright/test';

test('players register, sign in and stay outside the admin workspace', async ({
  page,
}, testInfo) => {
  const username = `player_${testInfo.project.name}_abcdefghijkl`;
  const password = 'browser-player-password';
  await page.goto('/');
  await expect(
    page.locator('.site-header nav').getByRole('link', { name: '管理後台' }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: '註冊', exact: true }).click();
  await expect(page.getByRole('heading', { name: '建立玩家帳號' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('帳號', { exact: true }).fill(username);
  await page.getByLabel('密碼', { exact: true }).fill(password);
  await page.getByLabel('確認密碼', { exact: true }).fill('different-password');
  await page.getByRole('button', { name: '建立帳號', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('兩次輸入的密碼不一致');
  await page.getByLabel('確認密碼', { exact: true }).fill(password);
  await page.getByRole('button', { name: '顯示密碼', exact: true }).click();
  await expect(page.getByLabel('密碼', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '隱藏密碼', exact: true }).click();
  await page.screenshot({
    path: `artifacts/register-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '建立帳號', exact: true }).click();
  await expect(page.locator('.account-name')).toHaveText(username);
  await page.reload();
  await expect(page.locator('.account-name')).toHaveText(username);
  await expect(
    page.locator('.site-header nav').getByRole('link', { name: '管理後台' }),
  ).toHaveCount(0);
  const session = await (await page.request.get('/api/v1/session')).json();
  expect(session.role).toBe('player');
  expect((await page.request.get('/api/v1/admin/overview')).status()).toBe(403);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '這裡是管理員工作區' })).toBeVisible();
  await expect(page.getByRole('button', { name: '匯入遊戲', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '返回遊戲大廳', exact: true }).click();
  await page.locator('.account-menu summary').click();
  await expect(page.getByText('普通玩家', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.account-dropdown')).not.toBeVisible();
  await page.locator('.account-menu summary').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/player-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: '登出帳號', exact: true }).click();
  await expect(page.locator('.account-name')).toHaveCount(0);
  await page.getByRole('link', { name: '登入', exact: true }).click();
  await page.getByLabel('帳號', { exact: true }).fill(username.toUpperCase());
  await page.getByLabel('密碼', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.locator('.account-name')).toHaveText(username);
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await page.locator('.game-card').filter({ hasText: '光點反應' }).click();
  await page.getByRole('link', { name: '開始遊戲' }).click();
  await expect(page.frameLocator('iframe').locator('#start')).toBeVisible();
});

test('browse, filter, play and return on desktop and mobile', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天，玩點什麼？' })).toBeVisible();
  await expect(page.locator('.game-card')).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .locator('.game-art img')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  await expect(page.locator('body')).not.toHaveJSProperty('scrollWidth', 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/lobby-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('textbox', { name: '搜尋遊戲' }).fill('不存在');
  await expect(page.getByRole('heading', { name: '還沒有找到這款遊戲' })).toBeVisible();
  await page.getByRole('button', { name: '清除搜尋' }).click();
  await page.getByRole('button', { name: '觀察', exact: true }).click();
  await expect(page.locator('.game-card')).toHaveCount(1);
  await page.getByRole('button', { name: '全部遊戲', exact: true }).click();
  await page.locator('.game-card').filter({ hasText: '光點反應' }).click();
  await expect(page.getByRole('heading', { name: '玩法與操作' })).toBeVisible();
  await page.getByRole('link', { name: '開始遊戲' }).click();
  const game = page.frameLocator('iframe');
  await expect(game.locator('#start')).toBeVisible();
  await game.locator('#start').click();
  await game.locator('.tile.lit').click();
  await expect(game.locator('#score')).toHaveText('01');
  expect(await game.locator('body').evaluate(() => window.scrollY)).toBe(0);
  if (testInfo.project.name === 'mobile') {
    expect((await game.locator('.tile').first().boundingBox())!.width).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: `artifacts/play-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: '重新開始' }).click();
  await expect(game.locator('#score')).toHaveText('00');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('link', { name: '返回遊戲大廳' }).click();
  await expect(page.locator('.game-card')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('admin imports releases, previews, publishes, rolls back and unpublishes', async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'Single mutation workflow; mobile admin layout is checked separately',
  );
  await page.goto('/admin');
  await page.getByLabel('帳號', { exact: true }).fill('admin');
  await page.getByLabel('密碼', { exact: true }).fill('e2e-only-password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '遊戲管理', exact: true })).toBeVisible();
  await expect(
    page.locator('.site-header nav').getByRole('link', { name: '管理後台' }),
  ).toBeVisible();
  const cookies = await context.cookies('http://127.0.0.1:3071');
  expect(cookies.find((c) => c.name.includes('playroom'))).toBeUndefined();
  await page.getByRole('button', { name: '匯入遊戲', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Repository', exact: true }).fill('example/game');
  await page.getByRole('button', { name: '加入來源' }).click();
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: '匯入此版本' }).click();
  await expect(page.getByText('已匯入', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '遊戲與版本' }).click();
  let row = page.locator('.admin-game').filter({ hasText: '測試光點' });
  await row.getByRole('button', { name: '預覽', exact: true }).click();
  await expect(page.frameLocator('iframe').locator('#start')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '關閉', exact: true }).click();
  await row.getByRole('button', { name: '發布', exact: true }).click();
  await page.getByRole('button', { name: '確認', exact: true }).click();
  await expect(row.getByText('已上架', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '匯入遊戲', exact: true }).click();
  await page.getByRole('radio').nth(1).check();
  await page.getByRole('button', { name: '匯入此版本' }).click();
  await expect(page.getByText('已匯入', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: '遊戲與版本' }).click();
  row = page.locator('.admin-game').filter({ hasText: '測試光點' });
  await row.getByRole('combobox').selectOption('2.0.0');
  await row.getByRole('button', { name: '發布', exact: true }).click();
  await page.getByRole('button', { name: '確認', exact: true }).click();
  await expect(row.getByRole('button', { name: '下架', exact: true })).toBeVisible();
  await row.getByRole('combobox').selectOption('1.0.0');
  await row.getByRole('button', { name: '回退到此版本' }).click();
  await page.getByRole('button', { name: '確認', exact: true }).click();
  await expect(row.getByRole('button', { name: '下架', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/admin-desktop.png', fullPage: true });
  await row.getByRole('button', { name: '下架', exact: true }).click();
  await page.getByRole('button', { name: '確認', exact: true }).click();
  await expect(row.getByText('未上架', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await expect(page.getByRole('heading', { name: '歡迎回來' })).toBeVisible();
});

test('admin remains usable at narrow widths', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await page.goto('/admin');
  await page.getByLabel('帳號', { exact: true }).fill('admin');
  await page.getByLabel('密碼', { exact: true }).fill('e2e-only-password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.locator('.admin-game').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/admin-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '匯入遊戲', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const bounds = await page.getByRole('dialog').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
});
