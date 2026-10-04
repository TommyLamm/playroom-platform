import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { validateDirectory } from '../server/archive.js';
import { isSafePath } from '../shared/manifest.js';

const root = path.resolve(process.argv[2] || 'examples/starter');
const output = path.resolve(process.argv[3] || 'artifacts/game.zip');
if (output === root || output.startsWith(root + path.sep))
  throw new Error('Output ZIP must be outside the game directory');
const manifest = await validateDirectory(root);
const zip = new yazl.ZipFile();
async function walk(directory: string, prefix = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (!isSafePath(relative) || entry.isSymbolicLink())
      throw new Error(`Unsupported path: ${relative}`);
    if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
    else if (entry.isFile()) zip.addFile(path.join(directory, entry.name), relative);
    else throw new Error(`Unsupported file: ${relative}`);
  }
}
await walk(root);
await fs.mkdir(path.dirname(output), { recursive: true });
zip.end();
await pipeline(zip.outputStream, createWriteStream(output));
console.info(`Packed ${manifest.id} v${manifest.version}: ${output}`);
