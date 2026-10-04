import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mime from 'mime-types';

const root = path.resolve('examples/starter');
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url || '/', 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html', 'style.css', 'game.js', 'config.json'].includes(name)) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', mime.lookup(name) || 'application/octet-stream');
    res.end(await readFile(path.join(root, name)));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
try {
  const page = await browser.newPage({
    viewport: { width: 800, height: 500 },
    deviceScaleFactor: 1,
  });
  for (const mode of ['signal', 'colors']) {
    await page.goto(`http://127.0.0.1:${port}/?mode=${mode}`);
    await page.locator('.tile').first().waitFor();
    await page.addStyleTag({
      content:
        '.game{min-height:500px;padding:24px 72px}.heading{margin:10px 0 16px}.heading h1{font-size:32px}.board{max-width:390px;gap:9px;aspect-ratio:5/3}.scorebar{max-width:390px}.bottom{display:none}',
    });
    await page.screenshot({
      path: path.join(root, mode === 'signal' ? 'cover.png' : 'cover-colors.png'),
    });
  }
} finally {
  await browser.close();
  server.close();
}
