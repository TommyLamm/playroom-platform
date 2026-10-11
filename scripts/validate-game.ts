import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractArchive } from '../server/archive.js';
import { GAME_TOOLS_VERSION } from '../shared/versions.js';

const input = process.argv[2];
if (!input) throw new Error('Usage: npm run game:validate -- path/to/game.zip');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-validate-'));
try {
  const manifest = await extractArchive(path.resolve(input), temporary, {
    maxZipBytes: 64 * 1024 * 1024,
    maxExpandedBytes: 256 * 1024 * 1024,
    maxFiles: 10000,
  });
  console.info(`Valid: ${manifest.id} v${manifest.version} (tools ${GAME_TOOLS_VERSION})`);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
