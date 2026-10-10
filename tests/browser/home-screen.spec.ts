import { test, expect } from '@playwright/test';

test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1', hasTouch: true });

test('home-screen metadata and icons are served at the platform origin', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  const response = await page.request.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await response.json();
  expect(manifest).toMatchObject({ id: '/', scope: '/', start_url: '/', display: 'standalone', short_name: 'Playroom' });
  for (const [path, size] of [['/icons/apple-touch-icon.png', 180], ...manifest.icons.map((icon: any) => [icon.src, Number(icon.sizes.split('x')[0])])]) {
    const icon = await page.request.get(path);
    expect(icon.status()).toBe(200);
    expect(icon.headers()['content-type']).toContain('image/png');
    const png = await icon.body();
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
  }
});

test('iPhone browser shows actionable installation steps without interrupting the game', async ({ page }, testInfo) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'keyboard', { value: undefined }); });
  await page.goto('/play/signal-tap');
  const game = page.frameLocator('iframe');
  await expect(game.locator('#start')).toBeVisible();
  await game.locator('body').evaluate(body => { body.dataset.installMarker = 'retained'; });
  await page.getByRole('button', { name: '加入主畫面', exact: true }).click();
  const guide = page.getByRole('dialog', { name: '從主畫面開啟 Playroom', exact: true });
  await expect(guide).toContainText('分享');
  await expect(guide).toContainText('作為 Web App 開啟');
  await expect(guide).toContainText('本機存檔不一定與瀏覽器共用');
  await page.screenshot({ path: `output/playwright/home-screen-guide-${testInfo.project.name}.png` });
  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);
  await expect(page.getByRole('button', { name: '加入主畫面', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '全螢幕', exact: true }).click();
  await expect(page.locator('.game-display-hint')).toContainText('加入主畫面');
  await expect(page.getByRole('button', { name: '加入主畫面', exact: true })).toBeHidden();
  await page.getByRole('button', { name: '退出全螢幕', exact: true }).click();
  expect(await game.locator('body').getAttribute('data-install-marker')).toBe('retained');
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});

test('installed iOS mode hides the guide and restores player theme on exit/navigation', async ({ page }) => {
  // Detection only: this does not emulate Safari's Home Screen installation.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
    Object.defineProperty(navigator, 'keyboard', { value: undefined });
  });
  await page.goto('/play/signal-tap');
  await expect(page.frameLocator('iframe').locator('#start')).toBeVisible();
  await expect(page.getByRole('button', { name: '加入主畫面', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '全螢幕', exact: true }).click();
  await expect(page.locator('.game-display-hint')).toHaveText('已使用沉浸模式，按右上角退出');
  await expect(page.locator('html')).toHaveClass(/game-expanded/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#172b29');
  await page.getByRole('button', { name: '退出全螢幕', exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/game-expanded/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f5f7f8');
  await page.getByRole('button', { name: '全螢幕', exact: true }).click();
  await page.evaluate(() => { history.pushState(null, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('.game-shell')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveClass(/game-expanded/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f5f7f8');
});

test('safe areas keep the iframe and exit control clear of notch and gesture regions', async ({ page }, testInfo) => {
  const cdp = await page.context().newCDPSession(page);
  await page.addInitScript(() => { Object.defineProperty(navigator, 'keyboard', { value: undefined }); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/play/signal-tap');
  await expect(page.frameLocator('iframe').locator('#start')).toBeVisible();
  // Chrome's safe-area override validates CSS geometry, not iOS browser chrome.
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: 34, left: 0, right: 0 } });
  await page.getByRole('button', { name: '全螢幕', exact: true }).click();
  await expect.poll(async () => (await page.locator('iframe').boundingBox())?.y).toBe(47);
  let bounds = (await page.locator('iframe').boundingBox())!;
  expect(bounds.height).toBe(844 - 47 - 34);
  let exit = (await page.getByRole('button', { name: '退出全螢幕', exact: true }).boundingBox())!;
  expect(exit.y).toBe(47 + 12);
  await page.screenshot({ path: `output/playwright/home-screen-safe-area-${testInfo.project.name}.png` });
  await page.setViewportSize({ width: 844, height: 390 });
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 21, left: 47, right: 47 } });
  await expect.poll(async () => (await page.locator('iframe').boundingBox())?.x).toBe(47);
  bounds = (await page.locator('iframe').boundingBox())!;
  expect(bounds.width).toBe(844 - 94);
  expect(bounds.height).toBe(390 - 21);
  exit = (await page.getByRole('button', { name: '退出全螢幕', exact: true }).boundingBox())!;
  expect(exit.x + exit.width).toBe(844 - 47 - 12);
  await page.getByRole('button', { name: '退出全螢幕', exact: true }).click();
  await expect(page.getByRole('button', { name: '全螢幕', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
