import { test, expect } from '@playwright/test';
import type { AdminGame } from '../../shared/types';
import { testManifest } from '../helpers';
import { mockAdminData } from './helpers/admin-fixtures';
import { selectAdminPage } from './helpers/admin';

for (const operation of ['publish', 'unpublish'] as const) {
  test(`${operation} conflict refreshes state by code and requires another confirmation`, async ({ page }) => {
    const game: AdminGame = { id: 'command-fixture', repositoryId: null, activeVersion: '1.0.0', published: true,
      versions: ['3.0.0', '2.0.0', '1.0.0'].map((version, i) => ({ id: i + 1, gameId: 'command-fixture', version,
        manifest: { ...testManifest, id: 'command-fixture', version, name: '操作競爭測試' }, sha256: 'fixture', releaseId: null,
        assetId: null, releaseTag: null, importedAt: '2026-10-11', publishedAt: '2026-10-11', reviewedBy: null, reviewedAt: null })) };
    await mockAdminData(page, () => [game]);
    const submissions: object[] = [];
    await page.route(`**/api/v1/admin/games/${game.id}/${operation}`, async (route) => {
      submissions.push(route.request().postDataJSON());
      if (submissions.length === 1) {
        game.activeVersion = '3.0.0';
        return route.fulfill({ status: 409, json: { error: 'Edited elsewhere', code: 'STATE_CONFLICT', details: { activeVersion: '3.0.0', published: true } } });
      }
      if (operation === 'publish') game.activeVersion = '2.0.0';
      else game.published = false;
      return route.fulfill({ json: { ok: true, status: operation === 'publish' ? 'published' : 'unpublished' } });
    });
    await page.route('**/api/v1/login', (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': '192.0.2.156' } }));
    await page.goto('/admin');
    await page.getByLabel('帳號', { exact: true }).fill('admin');
    await page.getByLabel('密碼', { exact: true }).fill('e2e-only-password');
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await selectAdminPage(page, '遊戲與版本');
    await page.getByRole('button', { name: '管理版本 操作競爭測試' }).click();
    const drawer = page.getByRole('dialog', { name: '管理版本 · 操作競爭測試' });
    if (operation === 'publish') {
      await drawer.getByRole('radio', { name: 'v2.0.0', exact: true }).click();
      await expect(drawer.locator('.selected-version')).toContainText('v2.0.0');
    }
    const open = () => drawer.getByRole('button', { name: operation === 'publish' ? '回退到此版本' : '下架', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: operation === 'publish' ? '切換發布版本' : '下架遊戲', exact: true });
    await open();
    await confirmation.getByRole('button', { name: '確認', exact: true }).click();
    await expect(page.getByText('Edited elsewhere', { exact: true })).toBeVisible();
    await expect(confirmation).toHaveCount(0);
    await expect(page.locator('.admin-games-table')).toContainText('v3.0.0');
    expect(submissions).toEqual([{ ...(operation === 'publish' ? { version: '2.0.0' } : {}), expectedActiveVersion: '1.0.0', expectedPublished: true }]);
    if (operation === 'unpublish') {
      await drawer.getByRole('radio', { name: 'v3.0.0', exact: true }).click();
      await expect(drawer.locator('.selected-version')).toContainText('v3.0.0');
      await expect(drawer.getByRole('radio', { name: 'v3.0.0', exact: true })).toBeChecked();
    }
    await open();
    await expect(confirmation).toBeVisible();
    expect(submissions).toHaveLength(1, 'refresh does not silently retry');
    await confirmation.getByRole('button', { name: '確認', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    expect(submissions[1]).toEqual({ ...(operation === 'publish' ? { version: '2.0.0' } : {}), expectedActiveVersion: '3.0.0', expectedPublished: true });
  });
}
