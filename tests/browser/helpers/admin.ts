import { expect, type Page } from '@playwright/test';

export async function selectAdminPage(page: Page, name: string | RegExp) {
  await expect(page.locator('.admin-intro')).toBeVisible();
  const opener = page.getByRole('button', { name: '開啟後台導覽', exact: true });
  if (await opener.isVisible()) {
    await opener.click();
    await page.getByRole('dialog', { name: '後台導覽', exact: true }).getByRole('button', { name }).click();
    await expect(page.getByRole('dialog', { name: '後台導覽', exact: true })).toHaveCount(0);
  } else await page.getByRole('navigation', { name: '後台導覽', exact: true }).getByRole('button', { name }).click();
}
