import { test, expect, type Page } from '@playwright/test';
import { selectAdminPage } from './helpers/admin';

type Scenario = 'missing-keyboard' | 'missing-fullscreen' | 'request-rejected' | 'lock-rejected' | 'lock-pending';

// These doubles exercise failure/race paths only. The native-key test below uses
// the browser's actual Fullscreen and Keyboard Lock APIs in a cross-origin frame.
async function displayScenario(page: Page, scenario: Scenario) {
  await page.addInitScript((scenario) => {
    if (window.top !== window) return;
    const probe = { requests: 0, exits: 0, unlocks: 0, keys: [] as string[], finishLock: () => {} };
    Object.assign(window, { displayProbe: probe });
    let fullscreen: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { get: () => fullscreen });
    Object.defineProperty(document, 'fullscreenEnabled', { value: true });
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: scenario === 'missing-fullscreen' ? undefined : async function (this: HTMLElement) {
        probe.requests++;
        if (scenario === 'request-rejected') throw new Error('Fullscreen denied');
        fullscreen = this;
        document.dispatchEvent(new Event('fullscreenchange'));
      },
    });
    document.exitFullscreen = async () => {
      probe.exits++;
      fullscreen = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
    Object.defineProperty(navigator, 'keyboard', {
      configurable: true,
      value: scenario === 'missing-keyboard' ? undefined : {
        lock: async (keys: string[]) => {
          probe.keys = keys;
          if (scenario === 'lock-rejected') throw new Error('Keyboard lock denied');
          if (scenario === 'lock-pending') await new Promise<void>((resolve) => { probe.finishLock = resolve; });
        },
        unlock: () => { probe.unlocks++; },
      },
    });
  }, scenario);
}

async function openGame(page: Page) {
  await page.goto('/play/signal-tap');
  await expect(page.frameLocator('iframe').locator('#start')).toBeVisible();
  // Model an in-game Esc menu without altering the bundled demo or its SDK.
  await page.frameLocator('iframe').locator('body').evaluate((body) => {
    body.dataset.displayMarker = String(Math.random());
    const menu = document.createElement('div');
    menu.id = 'display-test-menu';
    menu.textContent = '遊戲內選單';
    body.append(menu);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') menu.hidden = true;
    });
  });
  return page.frameLocator('iframe');
}

async function expectViewportFilled(page: Page) {
  const bounds = await page.locator('iframe').boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(bounds!.x).toBeCloseTo(0, 0);
  expect(bounds!.y).toBeCloseTo(0, 0);
  expect(bounds!.width).toBeCloseTo(viewport.width, 0);
  expect(bounds!.height).toBeCloseTo(viewport.height, 0);
  await expect(page.locator('.player-toolbar')).toBeHidden();
  await expect(page.locator('.record-status')).toBeHidden();
  const exit = page.getByRole('button', { name: '退出全螢幕', exact: true });
  const control = await exit.boundingBox();
  expect(control!.width).toBeGreaterThanOrEqual(44);
  expect(control!.height).toBeGreaterThanOrEqual(44);
}

for (const scenario of ['missing-keyboard', 'missing-fullscreen', 'request-rejected', 'lock-rejected'] as const) {
  test(`${scenario}: immersive fallback fills the viewport and preserves the iframe`, async ({ page }, testInfo) => {
    await displayScenario(page, scenario);
    const game = await openGame(page);
    const marker = await game.locator('body').getAttribute('data-display-marker');
    const source = await page.locator('iframe').getAttribute('src');
    const previousOverflow = await page.evaluate(() => [document.body.style.overflow, document.documentElement.style.overflow]);
    await game.locator('#start').click();
    await game.locator('.tile.lit').click();
    await expect(game.locator('#score')).toHaveText('01');
    await page.getByRole('button', { name: '全螢幕', exact: true }).click();
    await expect(page.locator('.game-shell')).toHaveAttribute('data-display-mode', 'immersive');
    await expectViewportFilled(page);
    await expect(page.locator('.game-display-hint')).toHaveText(testInfo.project.name === 'mobile'
      ? '要隱藏網址列，請退出後按「加入主畫面」' : '已使用沉浸模式，按右上角退出');
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');
    expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    expect(await page.evaluate(() => [document.body.style.overflow, document.documentElement.style.overflow])).toEqual(['hidden', 'hidden']);
    await page.keyboard.press('Escape');
    await expect(game.locator('#display-test-menu')).toBeHidden();
    await expect(page.locator('.game-shell')).toHaveAttribute('data-display-mode', 'immersive');
    if (testInfo.project.name === 'mobile') {
      await page.setViewportSize({ width: 844, height: 390 });
      await expectViewportFilled(page);
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await page.getByRole('button', { name: '退出全螢幕', exact: true }).click();
    await expect(page.locator('.game-shell')).toHaveAttribute('data-display-mode', 'normal');
    await expect(page.getByRole('button', { name: '全螢幕', exact: true })).toBeFocused();
    await expect(page.locator('.record-status')).toBeVisible();
    await expect(game.locator('#score')).toHaveText('01');
    expect(await game.locator('body').getAttribute('data-display-marker')).toBe(marker);
    expect(await page.locator('iframe').getAttribute('src')).toBe(source);
    expect(await page.evaluate(() => [document.body.style.overflow, document.documentElement.style.overflow])).toEqual(previousOverflow);
    const probe = await page.evaluate(() => (window as any).displayProbe);
    expect(probe.requests).toBe(scenario.startsWith('missing-') ? 0 : 1);
    if (scenario === 'lock-rejected') {
      expect(probe.keys).toEqual(['Escape']);
      expect(probe.exits).toBe(1);
      expect(probe.unlocks).toBeGreaterThanOrEqual(1);
    }
  });
}

test('an exit during a pending keyboard lock cancels late completion and repeated entry', async ({ page }) => {
  await displayScenario(page, 'lock-pending');
  await openGame(page);
  await page.getByRole('button', { name: '全螢幕', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.locator('.game-shell')).toHaveAttribute('data-display-mode', 'native');
  await expect.poll(() => page.evaluate(() => (window as any).displayProbe.keys)).toEqual(['Escape']);
  // Simulate a browser-initiated exit, rather than a lock error.
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator('.game-shell')).toHaveAttribute('data-display-mode', 'normal');
  await page.evaluate(() => (window as any).displayProbe.finishLock());
  await expect(page.getByRole('button', { name: '全螢幕', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '全螢幕', exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as any).displayProbe.requests)).toBe(1);
  expect(await page.evaluate(() => (window as any).displayProbe.unlocks)).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.game-display-hint')).toHaveCount(0);
});

test('leaving the player during pending lock cleans up fullscreen and late lock', async ({ page }) => {
  await displayScenario(page, 'lock-pending');
  await openGame(page);
  await page.getByRole('button', { name: '全螢幕', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).displayProbe.keys)).toEqual(['Escape']);
  await page.evaluate(() => { history.pushState(null, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('.game-shell')).toHaveCount(0);
  await page.evaluate(() => (window as any).displayProbe.finishLock());
  await expect.poll(() => page.evaluate(() => (window as any).displayProbe.unlocks)).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => document.fullscreenElement)).toBe(null);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});

test('preview immersive mode keeps Esc inside the game and restores diagnostics and dialog dismissal', async ({ page }, testInfo) => {
  await displayScenario(page, 'missing-keyboard');
  await page.request.post('/api/v1/login', {
    headers: { Origin: 'http://localhost:3070' }, data: { username: 'admin', password: 'e2e-only-password' },
  });
  await page.goto('/admin');
  await selectAdminPage(page, '遊戲與版本');
  await page.getByRole('button', { name: '管理版本 光點反應', exact: true }).click();
  await page.locator('.game-version-panel').getByRole('button', { name: '預覽', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '遊戲預覽', exact: true });
  const game = page.frameLocator('iframe');
  await expect(game.locator('#start')).toBeVisible();
  await expect(preview.getByLabel('SDK 診斷面板')).toBeVisible();
  const source = await page.locator('iframe').getAttribute('src');
  await preview.getByRole('button', { name: '全螢幕', exact: true }).click();
  await expectViewportFilled(page);
  await expect(preview.getByLabel('SDK 診斷面板')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(preview).toBeVisible();
  await expect(page.locator('.game-shell')).toHaveAttribute('data-display-mode', 'immersive');
  // Also exercise dialog cancellation with focus on the platform exit control.
  await preview.getByRole('button', { name: '退出全螢幕', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(preview).toBeVisible();
  await page.screenshot({ path: `output/playwright/immersive-preview-${testInfo.project.name}.png` });
  await preview.getByRole('button', { name: '退出全螢幕', exact: true }).click();
  await expect(preview.getByLabel('SDK 診斷面板')).toBeVisible();
  expect(await page.locator('iframe').getAttribute('src')).toBe(source);
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  // The version dialog still owns the body's scroll lock until it closes too.
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  // Navigation can unmount both the expanded player and its owning dialog.
  await page.getByRole('button', { name: '管理版本 光點反應', exact: true }).click();
  await page.locator('.game-version-panel').getByRole('button', { name: '預覽', exact: true }).click();
  await expect(game.locator('#start')).toBeVisible();
  await preview.getByRole('button', { name: '全螢幕', exact: true }).click();
  await expect(page.locator('.game-shell')).toHaveAttribute('data-display-mode', 'immersive');
  await page.evaluate(() => { history.pushState(null, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('.game-shell')).toHaveCount(0);
  expect(await page.evaluate(() => [document.body.style.overflow, document.documentElement.style.overflow])).toEqual(['', '']);
});

test('native fullscreen: real keyboard lock delivers short Esc to a cross-origin game and handles exits', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Physical keyboard behavior requires the desktop browser.');
  const game = await openGame(page);
  const supported = await page.evaluate(() => document.fullscreenEnabled && !!(navigator as any).keyboard?.lock);
  test.skip(!supported, 'This browser has no native Keyboard Lock API.');
  const marker = await game.locator('body').getAttribute('data-display-marker');
  await page.getByRole('button', { name: '全螢幕', exact: true }).click();
  await expect(page.locator('.game-shell')).toHaveAttribute('data-display-mode', 'native');
  await expect(page.locator('.game-display-hint')).toContainText('短按 Esc');
  await expectViewportFilled(page);
  expect(await page.evaluate(() => document.fullscreenElement?.className)).toBe('game-shell');
  await page.keyboard.press('Escape');
  await expect(game.locator('#display-test-menu')).toBeHidden();
  await expect(page.locator('.game-shell')).toHaveAttribute('data-display-mode', 'native');
  await page.screenshot({ path: 'output/playwright/native-fullscreen.png' });
  await page.getByRole('button', { name: '退出全螢幕', exact: true }).click();
  await expect(page.locator('.game-shell')).toHaveAttribute('data-display-mode', 'normal');
  await page.getByRole('button', { name: '全螢幕', exact: true }).click();
  await expect(page.locator('.game-display-hint')).toContainText('短按 Esc');
  // Browser exit synchronization uses the real Fullscreen API. Playwright's
  // repeated keydown did not reproduce physical long-Esc in this setup.
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator('.game-shell')).toHaveAttribute('data-display-mode', 'normal');
  expect(await page.evaluate(() => document.fullscreenElement)).toBe(null);
  await expect(page.getByRole('button', { name: '全螢幕', exact: true })).toBeFocused();
  expect(await game.locator('body').getAttribute('data-display-marker')).toBe(marker);
});

test('real fullscreen exits to immersive mode when keyboard lock is rejected', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await page.addInitScript(() => {
    if (window.top !== window) return;
    Object.defineProperty(navigator, 'keyboard', { value: {
      lock: async () => { throw new Error('Keyboard lock rejected'); }, unlock: () => {},
    } });
  });
  await openGame(page);
  await page.getByRole('button', { name: '全螢幕', exact: true }).click();
  await expect(page.locator('.game-shell')).toHaveAttribute('data-display-mode', 'immersive');
  expect(await page.evaluate(() => document.fullscreenElement)).toBe(null);
  await expectViewportFilled(page);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');
  await page.getByRole('button', { name: '退出全螢幕', exact: true }).click();
  await expect(page.locator('.game-shell')).toHaveAttribute('data-display-mode', 'normal');
});
