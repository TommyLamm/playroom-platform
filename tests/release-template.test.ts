import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { makeZip } from './helpers.js';

const run = promisify(execFile);

test('release version check uses environment values and rejects mismatched tags', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-release-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const directory = path.join(temporary, 'built game');
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'game.json'), JSON.stringify({ version: '1.2.3' }));
  const workflow = await fs.readFile('templates/game-release.yml', 'utf8');
  const code = workflow.match(/node --input-type=module <<'JS'\r?\n([\s\S]*?)\r?\n\s+JS/)?.[1];
  assert.ok(code, 'workflow must contain its version check');
  const envFile = path.join(temporary, 'github-env');
  const env = {
    ...process.env,
    GITHUB_WORKSPACE: temporary,
    GITHUB_ENV: envFile,
    GAME_DIR: 'built game',
    RELEASE_TAG: 'v1.2.3',
  };
  await run(process.execPath, ['--input-type=module', '--eval', code], { env });
  assert.equal(await fs.readFile(envFile, 'utf8'), `GAME_PATH=${directory}\n`);
  await assert.rejects(
    run(process.execPath, ['--input-type=module', '--eval', code], {
      env: { ...env, RELEASE_TAG: 'v1.2.4' },
    }),
    /Tag and manifest version differ/,
  );
  await assert.rejects(
    run(process.execPath, ['--input-type=module', '--eval', code], {
      env: { ...env, RELEASE_TAG: 'v1.2.3$(echo unsafe)' },
    }),
    /Tag and manifest version differ/,
  );
  await assert.rejects(
    run(process.execPath, ['--input-type=module', '--eval', code], {
      env: { ...env, GAME_DIR: '../outside' },
    }),
    /GAME_DIR must be a directory inside/,
  );
});

test('release CLI accepts a complete artifact and rejects invalid ZIP contents', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-release-cli-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const directory = path.join(temporary, 'build output');
  await fs.cp('examples/starter', directory, { recursive: true });
  const zip = path.join(temporary, 'game.zip');
  const packed = await run(process.execPath, ['--import', 'tsx', 'scripts/pack-game.ts', directory, zip]);
  assert.match(packed.stdout, /Packed signal-tap/);
  const validated = await run(process.execPath, ['--import', 'tsx', 'scripts/validate-game.ts', zip]);
  assert.match(validated.stdout, /Valid: signal-tap/);
  const invalid = await makeZip(path.join(temporary, 'invalid.zip'), undefined, [
    { name: 'INDEX.html', contents: 'case collision' },
  ]);
  await assert.rejects(
    run(process.execPath, ['--import', 'tsx', 'scripts/validate-game.ts', invalid]),
    /重複/,
  );
  await fs.rm(path.join(directory, 'index.html'));
  await assert.rejects(
    run(process.execPath, ['--import', 'tsx', 'scripts/pack-game.ts', directory, zip]),
    /index.html/,
  );
});
