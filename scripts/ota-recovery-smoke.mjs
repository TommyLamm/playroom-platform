import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { UpdateEngine, command, settings } from '../updater/engine.mjs';

// Run only in an isolated Docker test project. Never target the live deployment.
const config = settings();
if (config.project !== 'playroom-ota-smoke')
  throw new Error('Requires isolated playroom-ota-smoke project');
const commit = 'f'.repeat(40);
const engine = new UpdateEngine(config, async (binary, args, options) => {
  if (binary === 'git') return '';
  if (binary === 'docker' && args[0] === 'build') {
    const context = path.join(config.stateDir, 'fault-image');
    await fs.mkdir(context, { recursive: true });
    await fs.writeFile(
      path.join(context, 'Dockerfile'),
      `FROM playroom-app:initial\nLABEL org.opencontainers.image.revision=${commit}\nCOPY fault.mjs /app/fault.mjs\nCMD ["node", "fault.mjs"]\n`,
    );
    await fs.writeFile(
      path.join(context, 'fault.mjs'),
      "import Database from 'better-sqlite3'; const db = new Database('/data/platform.sqlite'); db.pragma('user_version=99'); db.close(); process.exit(1);\n",
    );
    return command('docker', ['build', '-t', `playroom-app:${commit}`, context], options);
  }
  return command(binary, args, options);
});
await engine.init();
engine.state.latest = {
  commit,
  date: new Date().toISOString(),
  subject: 'Isolated rollback fault injection',
};
await engine.save();
const old = await engine.running();
await engine.start(commit);
await engine.task;
const status = await engine.status();
assert.equal(status.jobs[0].status, 'failed');
assert.equal(status.jobs[0].phase, 'rolled-back');
assert.equal(status.current, old.commit);
const restored = await engine.running();
assert.notEqual(restored.data.Name, old.data.Name);
const result = await command('docker', [
  'exec',
  restored.id,
  'node',
  '--input-type=module',
  '-e',
  "import Database from 'better-sqlite3'; const db=new Database('/data/platform.sqlite'); console.log(JSON.stringify({schema:db.pragma('user_version',{simple:true}),integrity:db.pragma('integrity_check',{simple:true}),admins:db.prepare(\"SELECT count(*) n FROM users WHERE role='admin'\").get().n,games:db.prepare('SELECT count(*) n FROM games WHERE published=1').get().n}));",
]);
const data = JSON.parse(result);
assert.equal(data.schema, 2);
assert.equal(data.integrity, 'ok');
assert.equal(data.admins, 1);
assert.equal(data.games, 2);
console.log(JSON.stringify({ status: 'passed', rollback: status.jobs[0].phase, data }, null, 2));
