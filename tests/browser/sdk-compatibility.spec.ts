import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const legacy = readFileSync('tests/fixtures-sdk-v1.js', 'utf8');
test('frozen v1 SDK remains playable and submits account scores through the current bridge', async ({ page }, info) => {
  await page.route('**/playroom-sdk.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: legacy }));
  await page.goto('/play/signal-tap');
  await expect(page.frameLocator('iframe').locator('#start')).toBeEnabled();
  const guest = page.frames().find((frame) => frame.url().includes('/games/'))!;
  expect(await guest.evaluate(async () => { const { Playroom } = await import('./playroom-sdk.js'); return Playroom.startRun(); })).toBeNull();
  await page.route('**/api/v1/login', (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': info.project.name === 'mobile' ? '192.0.2.92' : '192.0.2.91' } }));
  await page.goto('/login');
  await page.getByLabel('帳號', { exact: true }).fill('admin');
  await page.getByLabel('密碼', { exact: true }).fill('e2e-only-password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.locator('.account-name')).toHaveText('admin');
  await page.goto('/play/signal-tap');
  await expect(page.frameLocator('iframe').locator('#start')).toBeEnabled();
  const frame = page.frames().find((candidate) => candidate.url().includes('/games/'))!;
  const result = await frame.evaluate(async () => {
    const { Playroom } = await import('./playroom-sdk.js');
    const ready = await Playroom.ready();
    const run = await Playroom.startRun();
    const saved = await Playroom.finishRun({ runId: run.runId, score: 3 });
    return { ready, saved };
  });
  expect(result.ready.available).toBe(true);
  expect(result.saved).toMatchObject({ saved: true, score: 3 });
});
