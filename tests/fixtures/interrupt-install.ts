import { getConfig } from '../../server/config.js';
import { openStore } from '../../server/db.js';
import { installVersion } from '../../server/installation-service.js';
import { testManifest } from '../helpers.js';
import path from 'node:path';

const [dataDir, jobId, phase] = process.argv.slice(2);
const config = getConfig({ dataDir, production: false });
const store = openStore(dataDir);
await installVersion(store, config, path.join(dataDir, 'staging', jobId, 'extracted'), { ...testManifest, version: '2.0.0' }, {
  repositoryId: 1, releaseId: 102, assetId: 1102, releaseTag: 'v2.0.0', sha256: 'b'.repeat(64),
}, { jobId, checkpoint: async (checkpoint) => {
  if (checkpoint !== phase) return;
  process.stdout.write(`checkpoint:${checkpoint}\n`);
  await new Promise(() => { setInterval(() => {}, 1000); });
} });
store.sqlite.close();
