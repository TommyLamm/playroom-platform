import { test, expect, type Page } from '@playwright/test';
import { selectAdminPage } from './helpers/admin';

const password = 'cloud-browser-password';
async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('帳號', { exact: true }).fill(username);
  await page.getByLabel('密碼', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.locator('.account-name')).toHaveText(username);
}
async function sdk(page: Page, method: 'loadProgress' | 'saveProgress', input?: object) {
  const frame = page.frames().find((f) => f.url().includes('/games/') || f.url().includes('/preview/'))!;
  return frame.evaluate(async ({ method, input }) => {
    // Import the actual game SDK in the cross-origin frame, never use the platform credentials.
    const { Playroom } = await import('./playroom-sdk.js');
    try { return { result: await Playroom[method](input) }; }
    catch (error) { return { error: (error as Error).message, code: (error as Error & { code: number }).code }; }
  }, { method, input });
}

test('cross-origin SDK saves resume on a fresh device and reject stale, forged and logged-out writes', async ({ page, browser }, info) => {
  test.setTimeout(90000);
  const username = `cloud_${info.project.name}`;
  await page.route('**/api/v1/register', (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': info.project.name === 'mobile' ? '192.0.2.82' : '192.0.2.81' } }));
  await page.goto('/register');
  await page.getByLabel('帳號', { exact: true }).fill(username);
  await page.getByLabel('密碼', { exact: true }).fill(password);
  await page.getByLabel('確認密碼', { exact: true }).fill(password);
  await page.getByRole('button', { name: '建立帳號', exact: true }).click();
  await expect(page.locator('.account-name')).toHaveText(username);
  await page.goto('/play/signal-tap');
  await expect(page.frameLocator('iframe').locator('#start')).toBeEnabled();
  expect((await sdk(page, 'loadProgress')).result).toBeNull();
  const input = { data: { stage: 7, best: 42, inventory: ['key'] }, revision: 0, formatVersion: 1, requestId: crypto.randomUUID() };
  // Lose the first successful response. Retrying the same snapshot must not increment revision.
  let loseOnce = true;
  await page.route('**/api/v1/games/signal-tap/save', async (route) => {
    if (route.request().method() === 'POST' && loseOnce) {
      loseOnce = false;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
    } else await route.continue();
  });
  expect((await sdk(page, 'saveProgress', input)).error).toBeTruthy();
  expect((await sdk(page, 'saveProgress', input)).result).toMatchObject({ saved: true, revision: 1 });
  const device = await browser.newContext({ baseURL: 'http://localhost:3070' });
  const other = await browser.newContext({ baseURL: 'http://localhost:3070' });
  try {
    const second = await device.newPage();
    await login(second, username);
    await second.goto('/play/signal-tap');
    await expect(second.frameLocator('iframe').locator('#best')).toHaveText('42');
    expect((await sdk(second, 'loadProgress')).result).toMatchObject({ data: input.data, revision: 1 });
    expect((await sdk(second, 'saveProgress', { data: { best: 43, stage: 8 }, revision: 1, formatVersion: 1 })).result).toMatchObject({ revision: 2 });
    expect((await sdk(page, 'saveProgress', { data: { best: 1 }, revision: 1, formatVersion: 1 })).code).toBe(409);
    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', { source: window, origin: 'http://127.0.0.1:3071', data: {
        protocol: 'playroom', version: 1, type: 'request', method: 'saveProgress', connection: crypto.randomUUID(), requestId: crypto.randomUUID(), payload: { data: { best: 999 }, revision: 2, formatVersion: 1 },
      } }));
    });
    expect((await sdk(second, 'loadProgress')).result).toMatchObject({ revision: 2, data: { best: 43 } });
    const guest = await other.newPage();
    await guest.goto('/play/signal-tap');
    await expect(guest.frameLocator('iframe').locator('#start')).toBeEnabled();
    expect((await sdk(guest, 'loadProgress')).result).toBeNull();
    expect((await sdk(guest, 'saveProgress', { data: { best: 99 }, revision: 0, formatVersion: 1 })).result).toBeNull();
    expect((await guest.request.get('/api/v1/games/signal-tap/save')).status()).toBe(401);
    const session = await (await second.request.get('/api/v1/session')).json();
    await second.request.post('/api/v1/logout', { headers: { Origin: 'http://localhost:3070', 'X-CSRF-Token': session.csrf }, data: {} });
    expect((await sdk(second, 'saveProgress', { data: { best: 0 }, revision: 2, formatVersion: 1 })).code).toBe(401);
  } finally { await device.close(); await other.close(); }
});

test('failed initial loading cannot overwrite existing progress, and previews use temporary saves only', async ({ page }, info) => {
  await page.route('**/api/v1/login', (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': info.project.name === 'mobile' ? '192.0.2.84' : '192.0.2.83' } }));
  await page.goto('/login');
  await page.getByLabel('帳號', { exact: true }).fill('admin');
  await page.getByLabel('密碼', { exact: true }).fill('e2e-only-password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.locator('.account-name')).toHaveText('admin');
  await page.goto('/play/color-hunt');
  await expect(page.frameLocator('iframe').locator('#start')).toBeEnabled();
  const previous = (await sdk(page, 'loadProgress')).result as { revision: number } | null;
  expect((await sdk(page, 'saveProgress', { data: { best: 71 }, revision: previous?.revision ?? 0, formatVersion: 1 })).result).toMatchObject({ saved: true });
  await page.route('**/api/v1/games/color-hunt/save', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '暫時無法讀取' }) });
    else await route.continue();
  });
  await page.reload();
  const game = page.frameLocator('iframe');
  await expect(game.locator('#start')).toBeEnabled();
  await page.clock.install();
  let writes = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && request.url().endsWith('/color-hunt/save')) writes++; });
  await game.locator('#start').click();
  await page.clock.fastForward(21000);
  await expect(game.locator('#start')).toBeEnabled();
  expect(writes).toBe(0);
  expect((await (await page.request.get('/api/v1/games/color-hunt/save')).json()).data.best).toBe(71);
  await page.unroute('**/api/v1/games/color-hunt/save');
  await page.goto('/admin');
  await selectAdminPage(page, '遊戲與版本');
  await page.getByRole('button', { name: '管理版本 色彩尋蹤', exact: true }).click();
  await page.locator('.game-version-panel').getByRole('button', { name: '預覽', exact: true }).click();
  await expect(page.getByRole('region', { name: 'SDK 診斷面板', exact: true })).toContainText('SDK 已連線');
  expect((await sdk(page, 'loadProgress')).result).toBeNull();
  expect((await sdk(page, 'saveProgress', { data: { stage: 9 }, revision: 0, formatVersion: 1 })).result).toBeNull();
  expect((await sdk(page, 'loadProgress')).result).toMatchObject({ data: { stage: 9 }, revision: 1 });
  expect((await (await page.request.get('/api/v1/games/color-hunt/save')).json()).data.best).toBe(71);
});
