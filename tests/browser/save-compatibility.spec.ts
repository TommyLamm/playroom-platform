import { test, expect, type Page } from '@playwright/test';
import { selectAdminPage } from './helpers/admin';

async function sdk(page: Page, method: 'loadProgress' | 'saveProgress', input?: object) {
  const frame = page.frames().find((item) => item.url().includes('/games/'))!;
  return frame.evaluate(async ({ method, input }) => {
    const { Playroom } = await import('./playroom-sdk.js');
    try { return { result: await Playroom[method](input) }; }
    catch (error) { const failure = error as Error & { code: number; machineCode: string }; return { error: failure.message, code: failure.code, machineCode: failure.machineCode }; }
  }, { method, input });
}

test('old cross-origin tab cannot overwrite migrated progress; recovery and rollback protect the owner', async ({ page, context }, info) => {
  const id = `save-formats-${info.project.name}`, route = `/api/v1/games/${id}/save`;
  await page.route('**/api/v1/login', (request) => request.continue({ headers: { ...request.request().headers(), 'x-forwarded-for': info.project.name === 'mobile' ? '192.0.2.96' : '192.0.2.95' } }));
  await page.goto('/login');
  await page.getByLabel('帳號', { exact: true }).fill('admin');
  await page.getByLabel('密碼', { exact: true }).fill('e2e-only-password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.locator('.account-name')).toHaveText('admin');
  const session = await (await page.request.get('/api/v1/session')).json();
  const headers = { Origin: 'http://localhost:3070', 'X-CSRF-Token': session.csrf };
  const state = async () => {
    const { game } = await (await page.request.get(`/api/v1/admin/games/${id}`)).json();
    return { expectedActiveVersion: game.activeVersion, expectedPublished: game.published };
  };
  const publish = async (version: string) => page.request.post(`/api/v1/admin/games/${id}/publish`, { headers, data: { version, ...await state() } });
  expect((await publish('1.0.0')).status()).toBe(200);
  try {
    await page.goto(`/play/${id}`);
    await expect(page.frameLocator('iframe').locator('#start')).toBeEnabled();
    expect((await sdk(page, 'saveProgress', { data: { best: 42 }, revision: 0, formatVersion: 1 })).result).toMatchObject({ saved: true, revision: 1 });
    expect((await publish('2.0.0')).status()).toBe(200);
    const modern = await context.newPage();
    await modern.goto(`/play/${id}`);
    await expect(modern.frameLocator('iframe').locator('#start')).toBeEnabled();
    expect((await sdk(modern, 'loadProgress')).result).toMatchObject({ revision: 1, formatVersion: 1 });
    expect((await sdk(modern, 'saveProgress', { data: { best: 43 }, revision: 1, formatVersion: 2 })).result).toMatchObject({ revision: 2 });
    expect(await sdk(page, 'loadProgress')).toMatchObject({ code: 409, machineCode: 'SAVE_FORMAT_INCOMPATIBLE' });
    expect(await sdk(page, 'saveProgress', { data: { best: 0 }, revision: 2, formatVersion: 1 })).toMatchObject({ code: 409, machineCode: 'SAVE_FORMAT_INCOMPATIBLE' });
    expect(await (await page.request.get(route)).json()).toMatchObject({ data: { best: 43 }, revision: 2 });
    expect((await publish('1.0.0')).status()).toBe(409);
    const admin = await context.newPage();
    await admin.goto('/admin');
    await selectAdminPage(admin, '遊戲與版本');
    await admin.getByLabel('搜尋管理遊戲').fill(id);
    await admin.getByRole('button', { name: `管理版本 存檔格式 ${info.project.name}`, exact: true }).click();
    await admin.getByRole('radio', { name: 'v1.0.0', exact: true }).click();
    await expect(admin.locator('.selected-version')).toContainText('1 份無法讀取，禁止發布或回退');
    await expect(admin.getByRole('radio', { name: 'v1.0.0', exact: true })).toBeChecked();
    expect((await publish('3.0.0')).status()).toBe(200);
    const snapshots = await (await page.request.get(route + '/snapshots')).json();
    const restoreInput = { snapshotId: snapshots.snapshots[0].id, revision: 2, requestId: crypto.randomUUID() };
    const restore = () => page.request.post(route + '/restore', { headers, data: restoreInput });
    expect((await restore()).status()).toBe(409); // Active format 2-only release cannot read the snapshot.
    expect((await publish('2.0.0')).status()).toBe(200);
    expect(await (await restore()).json()).toMatchObject({ saved: true, revision: 3, formatVersion: 1, data: { best: 42 } });
    expect(await (await restore()).json()).toMatchObject({ revision: 3 });
    expect((await sdk(modern, 'saveProgress', { data: { best: 99 }, revision: 2, formatVersion: 2 })).machineCode).toBe('SAVE_REVISION_CONFLICT');
    await modern.close(); await admin.close();
  } finally {
    await page.request.post(`/api/v1/admin/games/${id}/unpublish`, { headers, data: await state() });
  }
});
