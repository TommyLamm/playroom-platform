import { test, expect } from '@playwright/test';

test('private career trends mark breakthroughs and show the next leaderboard target', async ({ page, browser }, info) => {
  const username = `progress_${info.project.name}`;
  const password = 'progress-browser-password';
  const address = info.project.name === 'mobile' ? '192.0.2.82' : '192.0.2.81';
  await page.route('**/api/v1/register', (route) => route.continue({ headers: {
    ...route.request().headers(), 'x-forwarded-for': address,
  } }));
  await page.goto('/register');
  await page.getByLabel('帳號', { exact: true }).fill(username);
  await page.getByLabel('密碼', { exact: true }).fill(password);
  await page.getByLabel('確認密碼', { exact: true }).fill(password);
  await page.getByRole('button', { name: '建立帳號', exact: true }).click();
  await expect(page.locator('.account-name')).toHaveText(username);
  const session = await (await page.request.get('/api/v1/session')).json();
  const headers = { Origin: 'http://localhost:3070', 'X-CSRF-Token': session.csrf };
  async function results(gameId: string, scores: number[]) {
    const { game } = await (await page.request.get(`/api/v1/games/${gameId}`)).json();
    const play = await page.request.post(`/api/v1/games/${gameId}/plays`, {
      headers, data: { version: game.version, requestId: crypto.randomUUID() },
    });
    expect(play.status()).toBe(201);
    const { playId } = await play.json();
    for (const score of scores) {
      const start = await page.request.post(`/api/v1/plays/${playId}/runs`, { headers, data: { requestId: crypto.randomUUID() } });
      expect(start.status()).toBe(201);
      const { runId } = await start.json();
      const finish = await page.request.post(`/api/v1/runs/${runId}/finish`, { headers, data: { score } });
      expect(finish.status()).toBe(200);
    }
  }
  await results('signal-tap', [0, 2, 1, 3]);
  await results('color-hunt', [1]);
  const rivalContext = await browser.newContext();
  try {
    const rival = await rivalContext.newPage();
    const registered = await rival.request.post('http://localhost:3070/api/v1/register', {
      headers: { Origin: 'http://localhost:3070', 'X-Forwarded-For': address },
      data: { username: `${username}_rival`, password },
    });
    expect(registered.status()).toBe(201);
    const rivalHeaders = { Origin: 'http://localhost:3070', 'X-CSRF-Token': (await registered.json()).csrf };
    const { game } = await (await rival.request.get('http://localhost:3070/api/v1/games/signal-tap')).json();
    const { playId } = await (await rival.request.post('http://localhost:3070/api/v1/games/signal-tap/plays', {
      headers: rivalHeaders, data: { version: game.version, requestId: crypto.randomUUID() },
    })).json();
    const { runId } = await (await rival.request.post(`http://localhost:3070/api/v1/plays/${playId}/runs`, {
      headers: rivalHeaders, data: { requestId: crypto.randomUUID() },
    })).json();
    expect((await rival.request.post(`http://localhost:3070/api/v1/runs/${runId}/finish`, { headers: rivalHeaders, data: { score: 4 } })).status()).toBe(200);

    let failOnce = true;
    await page.route('**/api/v1/me/progress?*', async (route) => {
      if (failOnce) {
        failOnce = false;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '進步測試連線中斷' }) });
      } else await route.continue();
    });
    await page.goto(`/players/${username}`);
    const progress = page.getByRole('region', { name: '我的進步', exact: true });
    await expect(progress.getByRole('alert')).toContainText('進步測試連線中斷');
    await progress.getByRole('button', { name: '重試載入進步' }).click();
    await expect(progress.getByRole('img', { name: '近期成績趨勢' })).toBeVisible();
    await progress.getByLabel('選擇進步遊戲').selectOption('signal-tap');
    await expect(progress.locator('.progress-stats')).toContainText('4 局');
    await expect(progress.locator('.progress-stats')).toContainText('2 次');
    await expect(progress.locator('.progress-stats')).toContainText('3 分');
    await expect(progress.locator('.progress-table tbody tr')).toHaveCount(4);
    await expect(progress.locator('.progress-badge')).toHaveCount(2);
    await expect(progress.locator('.progress-table')).toContainText('首次成績');
    if (info.project.name === 'mobile') expect(await progress.locator('.career-table-wrap').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(progress.getByRole('img', { name: '近期成績趨勢' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/progress-${info.project.name}.png`, fullPage: true });
    await page.goto('/games/signal-tap');
    await expect(page.locator('.rank-next-target')).toContainText('還差 1 分');
    await expect(page.locator('.rank-next-target')).toContainText('提高至 4 分');
    // Another logged-in player can see the public summary, but never this player's series.
    let privateRequests = 0;
    rival.on('request', (request) => { if (request.url().includes('/api/v1/me/progress')) privateRequests++; });
    await rival.goto(`http://localhost:3070/players/${username}`);
    await expect(rival.getByRole('heading', { name: `${username} 的遊戲生涯` })).toBeVisible();
    await expect(rival.getByRole('region', { name: '我的進步', exact: true })).toHaveCount(0);
    expect(privateRequests).toBe(0);
    const own = await (await rival.request.get('http://localhost:3070/api/v1/me/progress?gameId=signal-tap&boardId=classic')).json();
    expect(own.totalRuns).toBe(1);
    expect(own.points[0].score).toBe(4);
  } finally { await rivalContext.close(); }
});

test('admin preview diagnoses SDK runs and errors without saving account records', async ({ page }, info) => {
  await page.route('**/api/v1/login', (route) => route.continue({ headers: {
    ...route.request().headers(), 'x-forwarded-for': info.project.name === 'mobile' ? '192.0.2.92' : '192.0.2.91',
  } }));
  await page.goto('/admin');
  await page.getByLabel('帳號', { exact: true }).fill('admin');
  await page.getByLabel('密碼', { exact: true }).fill('e2e-only-password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  const row = page.locator('.admin-game').filter({ hasText: '光點反應' });
  await expect(row).toBeVisible();
  const before = await (await page.request.get('/api/v1/players/admin/career')).json();
  let recordWrites = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/v1\/(games\/[^/]+\/plays|plays\/|runs\/)/.test(request.url())) recordWrites++;
  });
  await row.getByRole('button', { name: '預覽', exact: true }).click();
  const panel = page.getByRole('region', { name: 'SDK 診斷面板', exact: true });
  await expect(panel).toContainText('SDK 已連線');
  await expect(panel).toContainText('classic');
  await expect(panel).toContainText('1.2.0');
  await page.clock.install();
  const game = page.frameLocator('iframe');
  await game.locator('#start').click();
  await expect(panel).toContainText('startRun：已建立模擬局次');
  await game.locator('.tile.lit').click();
  await page.clock.fastForward(21000);
  await expect(panel).toContainText('finishRun：1 分');
  await expect(panel).toContainText('驗證通過');
  const iframe = page.frames().find((frame) => frame.url().includes('/preview/'))!;
  await iframe.evaluate(async () => {
    // @ts-expect-error module path is resolved within the game's iframe at runtime.
    const { Playroom } = await import('./playroom-sdk.js');
    const run = await Playroom.startRun();
    await Playroom.finishRun({ runId: run.runId, score: 10001 }).catch(() => {});
  });
  await expect(panel).toContainText('分數超出');
  await page.evaluate(() => {
    const target = document.querySelector('iframe')!;
    const data = { protocol: 'playroom', version: 1, type: 'request', connection: crypto.randomUUID(), requestId: crypto.randomUUID(), method: 'finishRun', payload: { runId: crypto.randomUUID(), score: 9999 } };
    window.dispatchEvent(new MessageEvent('message', { source: window, origin: 'http://127.0.0.1:3071', data }));
    window.dispatchEvent(new MessageEvent('message', { source: target.contentWindow, origin: 'https://forged.example', data }));
  });
  await expect(panel).not.toContainText('9999 分');
  const after = await (await page.request.get('/api/v1/players/admin/career')).json();
  expect(after).toEqual(before);
  expect(recordWrites).toBe(0);
  await panel.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/sdk-preview-${info.project.name}.png`, fullPage: true });
  await panel.getByRole('button', { name: '清除事件', exact: true }).click();
  await expect(panel).not.toContainText('finishRun：1 分');
  await page.getByRole('dialog').getByRole('button', { name: '重新開始', exact: true }).click();
  await expect(panel).toContainText('SDK 已連線');
  await expect(panel).not.toContainText('分數超出');
  expect(recordWrites).toBe(0);
});
