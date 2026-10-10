import { test, expect } from '@playwright/test';

test('account scores persist, public summaries stay separate from private results, and retry is idempotent', async ({ page, browser }, info) => {
  test.setTimeout(70000);
  const username = `career_${info.project.name}`;
  await page.route('**/api/v1/register', (route) => route.continue({ headers: {
    ...route.request().headers(), 'x-forwarded-for': info.project.name === 'mobile' ? '192.0.2.22' : '192.0.2.21',
  } }));
  await page.goto('/register');
  await page.getByLabel('帳號', { exact: true }).fill(username);
  await page.getByLabel('密碼', { exact: true }).fill('career-browser-password');
  await page.getByLabel('確認密碼', { exact: true }).fill('career-browser-password');
  await page.getByRole('button', { name: '建立帳號', exact: true }).click();
  await expect(page.locator('.account-name')).toHaveText(username);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.locator('.account-menu summary').click();
  await page.getByRole('link', { name: '我的遊戲生涯', exact: true }).click();
  await expect(page.getByRole('heading', { name: `${username} 的遊戲生涯` })).toBeVisible();
  await expect(page.getByText('還沒有遊戲記錄。登入後開始遊玩，就能累積你的生涯。')).toBeVisible();
  const progress = page.getByRole('region', { name: '我的進步', exact: true });
  await expect(progress).toContainText('尚未保存成績');
  await expect(progress.getByRole('button', { name: '重新整理進步' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: '我的逐局成績' })).toBeVisible();
  await page.reload();
  await expect(progress).toContainText('尚未保存成績');
  expect(pageErrors).toEqual([]);
  await page.goto('/play/signal-tap');
  await expect(page.locator('.record-status')).toContainText('遊戲記錄已連線');
  // Opening a game without finishing a run also leaves the progress selection empty.
  await page.goto(`/players/${username}`);
  await expect(page.getByRole('heading', { name: '光點反應', exact: true })).toBeVisible();
  await expect(progress).toContainText('尚未保存成績');
  await expect(page.getByText('還沒有完成的局次。成績需要遊戲支援回報。')).toBeVisible();
  expect(pageErrors).toEqual([]);
  await page.goto('/play/signal-tap');
  await expect(page.locator('.record-status')).toContainText('遊戲記錄已連線');
  const game = page.frameLocator('iframe');
  // Finish API fails once, preserving this page's result for an explicit retry.
  let failOnce = true;
  await page.route('**/api/v1/runs/*/finish', async (route) => {
    if (failOnce) { failOnce = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '測試連線中斷' }) }); }
    else await route.continue();
  });
  await game.locator('#start').click();
  await game.locator('.tile.lit').click();
  await expect(game.locator('#score')).toHaveText('01');
  await expect(page.locator('.record-status')).toContainText('尚未保存', { timeout: 30000 });
  await page.getByRole('button', { name: '重試保存' }).click();
  await expect(page.locator('.record-status')).toContainText('成績已保存');
  const results = await (await page.request.get('/api/v1/me/results')).json();
  expect(results.total).toBe(1);
  expect(results.results[0]).toMatchObject({ score: 1, version: '1.2.0', boardId: 'classic' });
  const session = await (await page.request.get('/api/v1/session')).json();
  const duplicate = await page.request.post(`/api/v1/runs/${results.results[0].id}/finish`, { headers: { Origin: 'http://localhost:3070', 'X-CSRF-Token': session.csrf }, data: { score: 1 } });
  expect(duplicate.status()).toBe(200);
  expect((await (await page.request.get('/api/v1/me/results')).json()).total).toBe(1);
  await page.getByRole('link', { name: '查看排行榜' }).click();
  await expect(page.locator('#leaderboard')).toContainText('你的最佳成績：1 分');
  await page.locator('#leaderboard').getByRole('link', { name: username }).click();
  await expect(page.getByRole('heading', { name: `${username} 的遊戲生涯` })).toBeVisible();
  await expect(page.getByRole('heading', { name: '我的逐局成績' })).toBeVisible();
  await expect(page.locator('.career-stats')).toContainText('完成局數');
  await expect(page.locator('.career-table:not(.progress-table)')).toContainText('1 分');
  await expect(progress.getByRole('img', { name: '近期成績趨勢' })).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/career-${info.project.name}.png`, fullPage: true });
  const guest = await browser.newContext({ viewport: info.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
  try {
    const publicPage = await guest.newPage();
    await publicPage.goto(`http://localhost:3070/players/${username}`);
    await expect(publicPage.getByText('榜單 classic：最佳 1 分', { exact: false })).toBeVisible();
    await expect(publicPage.getByRole('heading', { name: '我的逐局成績' })).toHaveCount(0);
    expect((await publicPage.request.get('/api/v1/me/results')).status()).toBe(401);
    await publicPage.goto('http://localhost:3070/play/signal-tap');
    await expect(publicPage.locator('.record-status')).toContainText('登入後可保存');
    await publicPage.frameLocator('iframe').locator('#start').click();
    await publicPage.frameLocator('iframe').locator('.tile.lit').click();
    await expect(publicPage.frameLocator('iframe').locator('#score')).toHaveText('01');
  } finally { await guest.close(); }
  // A fresh authenticated browser sees the same stored result.
  const another = await browser.newContext();
  try {
    const device = await another.newPage();
    await device.goto('http://localhost:3070/login');
    await device.getByLabel('帳號', { exact: true }).fill(username);
    await device.getByLabel('密碼', { exact: true }).fill('career-browser-password');
    await device.getByRole('button', { name: '登入', exact: true }).click();
    await expect(device.locator('.account-name')).toHaveText(username);
    await device.goto(`http://localhost:3070/players/${username}`);
    await expect(device.locator('.career-table:not(.progress-table)')).toContainText('1 分');
  } finally { await another.close(); }
});

test('the bridge rejects forged sources, stops background activity and respects expired sessions', async ({ page }, info) => {
  const username = `bridge_${info.project.name}`;
  await page.route('**/api/v1/register', (route) => route.continue({ headers: {
    ...route.request().headers(), 'x-forwarded-for': info.project.name === 'mobile' ? '192.0.2.32' : '192.0.2.31',
  } }));
  await page.goto('/register');
  await page.getByLabel('帳號', { exact: true }).fill(username);
  await page.getByLabel('密碼', { exact: true }).fill('bridge-browser-password');
  await page.getByLabel('確認密碼', { exact: true }).fill('bridge-browser-password');
  await page.getByRole('button', { name: '建立帳號', exact: true }).click();
  await expect(page.locator('.account-name')).toHaveText(username);
  await page.goto('/play/color-hunt');
  await expect(page.locator('.record-status')).toContainText('遊戲記錄已連線');
  const before = await (await page.request.get(`/api/v1/players/${username}/career`)).json();
  expect(before.totals.opens).toBe(1);
  await page.evaluate(() => {
    const frame = document.querySelector('iframe')!;
    const data = { protocol: 'playroom', version: 1, type: 'request', connection: crypto.randomUUID(), requestId: crypto.randomUUID(), method: 'finishRun', payload: { runId: crypto.randomUUID(), score: 999 } };
    window.dispatchEvent(new MessageEvent('message', { source: window, origin: 'http://127.0.0.1:3071', data }));
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'http://evil.example', data }));
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'http://127.0.0.1:3071', data }));
  });
  expect((await (await page.request.get('/api/v1/me/results')).json()).total).toBe(0);
  // Browser clock advances heartbeat scheduling while real server time stays bounded.
  await page.clock.install();
  const hidden = await page.context().newPage();
  await hidden.goto('about:blank');
  await hidden.bringToFront();
  const heartbeatBefore = await (await page.request.get(`/api/v1/players/${username}/career`)).json();
  let backgroundHeartbeats = 0;
  page.on('request', (request) => { if (request.url().endsWith('/heartbeat')) backgroundHeartbeats++; });
  await page.clock.fastForward(45000);
  expect(backgroundHeartbeats).toBe(0);
  const heartbeatAfter = await (await page.request.get(`/api/v1/players/${username}/career`)).json();
  expect(heartbeatAfter.totals.activeMs - heartbeatBefore.totals.activeMs).toBeLessThan(2000);
  await hidden.close();
  await page.bringToFront();
  const session = await (await page.request.get('/api/v1/session')).json();
  expect((await page.request.post('/api/v1/logout', { headers: { Origin: 'http://localhost:3070', 'X-CSRF-Token': session.csrf }, data: {} })).status()).toBe(200);
  await page.frameLocator('iframe').locator('#start').click();
  await expect(page.locator('.record-status')).toContainText('登入已失效');
  await page.goto('/login');
  await page.reload();
  await page.getByLabel('帳號', { exact: true }).fill(username);
  await page.getByLabel('密碼', { exact: true }).fill('bridge-browser-password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.locator('.account-name')).toHaveText(username);
  await page.goto('/play/color-hunt');
  await expect(page.locator('.record-status')).toContainText('遊戲記錄已連線');
  expect((await (await page.request.get(`/api/v1/players/${username}/career`)).json()).totals.opens).toBe(2);
  // Switch this browser to a different account and create a fresh frame/visit.
  await page.locator('.account-menu summary').click();
  await page.getByRole('button', { name: '登出帳號' }).click();
  const secondUser = `${username}_next`;
  await page.goto('/register');
  await page.getByLabel('帳號', { exact: true }).fill(secondUser);
  await page.getByLabel('密碼', { exact: true }).fill('bridge-browser-password');
  await page.getByLabel('確認密碼', { exact: true }).fill('bridge-browser-password');
  await page.getByRole('button', { name: '建立帳號', exact: true }).click();
  await expect(page.locator('.account-name')).toHaveText(secondUser);
  await page.goto('/play/color-hunt');
  await expect(page.locator('.record-status')).toContainText('遊戲記錄已連線');
  expect((await (await page.request.get(`/api/v1/players/${secondUser}/career`)).json()).totals.opens).toBe(1);
  expect((await (await page.request.get(`/api/v1/players/${username}/career`)).json()).totals.opens).toBe(2);
  await page.goto(`/players/${username}`);
  await expect(page.getByRole('heading', { name: '我的逐局成績' })).toHaveCount(0);
});
