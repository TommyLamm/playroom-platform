import { test, expect, type Page } from '@playwright/test';

const target = '色彩尋蹤';

// The fixture games support every device and keep a leaderboard, so reshape one of them in flight.
async function desktopOnlyWithoutBoards(page: Page) {
  const reshape = (game: { name: string }) =>
    game.name === target ? { ...game, devices: ['desktop'], leaderboard: undefined } : game;
  await page.route(/\/api\/v1\/games(\/[^/]+)?$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: body.games ? { ...body, games: body.games.map(reshape) } : { ...body, game: reshape(body.game) } });
  });
  await page.route(/\/api\/v1\/games\/[^/]+\/leaderboards$/, (route) =>
    route.fulfill({ json: { boards: [], activeBoardId: null } }));
}

test('touch devices flag desktop-only games and empty leaderboards stay hidden', async ({ page }, info) => {
  const touch = info.project.name === 'mobile';
  await desktopOnlyWithoutBoards(page);
  await page.goto('/');
  const card = page.locator('.game-card').filter({ hasText: target });
  await expect(card.getByText('僅支援電腦')).toHaveCount(touch ? 1 : 0);
  // Playable games come first on touch devices.
  if (touch) await expect(page.locator('.game-card').last()).toContainText(target);

  await card.getByRole('link', { name: target, exact: true }).click();
  await expect(page.getByRole('heading', { name: target })).toBeVisible();
  await expect(page.getByRole('note')).toHaveCount(touch ? 1 : 0);
  await expect(page.locator('#leaderboard')).toHaveCount(0);

  await page.getByRole('link', { name: '開始遊戲' }).click();
  await expect(page.locator('.play-caption')).toBeVisible();
  await expect(page.getByRole('note')).toHaveCount(touch ? 1 : 0);
  await expect(page.getByRole('link', { name: '查看排行榜' })).toHaveCount(0);
  // Meta items stay on one line instead of wrapping character by character.
  const height = await page.locator('.play-caption-meta').evaluate((meta) => meta.getBoundingClientRect().height);
  expect(height).toBeLessThan(30);
});
