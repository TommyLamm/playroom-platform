import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import yazl from 'yazl';
import { GAME_TOOLS_VERSION, SDK_VERSION, PROTOCOL_VERSION, MANIFEST_SCHEMA_VERSION } from '../shared/versions.js';

process.env.TZ = 'UTC';

// Vite provides the build-time bundler. Emitted tools have no npm runtime dependencies.
const require = createRequire(import.meta.url);
const { build } = require('esbuild') as typeof import('esbuild');
const root = path.resolve(`artifacts/game-tools/${GAME_TOOLS_VERSION}`);
await fs.mkdir(root, { recursive: true });
for (const name of ['pack-game', 'validate-game']) {
  await build({ entryPoints: [`scripts/${name}.ts`], outfile: path.join(root, `${name}.mjs`), bundle: true, platform: 'node', target: 'node24', format: 'esm', banner: { js: "import { createRequire as toolCreateRequire } from 'node:module'; const require = toolCreateRequire(import.meta.url);" } });
}
for (const name of ['playroom-sdk.js', 'playroom-sdk.d.ts']) await fs.copyFile(`examples/starter/${name}`, path.join(root, name));
await fs.copyFile('templates/game.schema.json', path.join(root, 'game.schema.json'));
const metadata = { toolsVersion: GAME_TOOLS_VERSION, sdkVersion: SDK_VERSION, protocolVersion: PROTOCOL_VERSION, manifestSchemaVersions: [1, MANIFEST_SCHEMA_VERSION], nodeVersion: '24', sourceInputs: {} as Record<string, string>, files: {} as Record<string, string> };
for (const input of ['package-lock.json', 'scripts/build-game-tools.ts', 'scripts/pack-game.ts', 'scripts/validate-game.ts', 'server/archive.ts', 'server/errors.ts', 'shared/errors.ts', 'shared/manifest.ts', 'shared/versions.ts']) metadata.sourceInputs[input] = createHash('sha256').update(await fs.readFile(input)).digest('hex');
const filenames = ['game.schema.json', 'pack-game.mjs', 'playroom-sdk.d.ts', 'playroom-sdk.js', 'validate-game.mjs'];
for (const name of filenames) metadata.files[name] = createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex');
await fs.writeFile(path.join(root, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
const archive = path.resolve(`artifacts/playroom-game-tools-${GAME_TOOLS_VERSION}.zip`);
const zip = new yazl.ZipFile();
for (const name of [...filenames, 'metadata.json'].sort()) zip.addFile(path.join(root, name), name, { mtime: new Date('2000-01-01T00:00:00Z'), mode: 0o100644 });
zip.end();
await pipeline(zip.outputStream, createWriteStream(archive));
const sha256 = createHash('sha256').update(await fs.readFile(archive)).digest('hex');
await fs.writeFile(`${archive}.sha256`, `${sha256}  ${path.basename(archive)}\n`);
await fs.writeFile('templates/game-tools.lock.json', JSON.stringify({ toolsVersion: GAME_TOOLS_VERSION, archive: `.playroom/tools/${path.basename(archive)}`, sha256 }, null, 2) + '\n');
console.info(`Game tools ${GAME_TOOLS_VERSION}: ${archive}\nSHA-256: ${sha256}`);
