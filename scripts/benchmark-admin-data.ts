import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { openStore } from '../server/db.js';
import { legacyAdminOverview } from '../tests/fixtures/legacy-admin-library.js';
import { seedAdminScale } from '../tests/fixtures/admin-scale.js';
import { readGamePage, readVersionPage, readAdminTasks, readUpdatePage } from '../server/admin-data.js';

const directory = mkdtempSync(path.join(os.tmpdir(), 'playroom-admin-scale-'));
const store = openStore(directory);
try {
  seedAdminScale(store);
  let queries = 0;
  const prepare = store.sqlite.prepare.bind(store.sqlite);
  store.sqlite.prepare = ((sql: string) => { queries++; return prepare(sql); }) as typeof store.sqlite.prepare;
  function measure(run: () => unknown) {
    const runs = Array.from({ length: 5 }, () => {
      queries = 0;
      const start = performance.now();
      const response = run();
      const queryAndProcessingMs = performance.now() - start;
      const jsonStart = performance.now();
      const bytes = Buffer.byteLength(JSON.stringify(response));
      return { bytes, queries, queryAndProcessingMs, serializationMs: performance.now() - jsonStart };
    });
    return { runs, medianMs: runs.map((r) => r.queryAndProcessingMs).sort((a, b) => a - b)[2] };
  }
  const result = {
    command: 'npx tsx scripts/benchmark-admin-data.ts', node: process.version, platform: `${process.platform}/${process.arch}`,
    fixture: { games: 1000, versionsPerGame: 20, totalVersions: 20000, store: 'temporary SQLite WAL' },
    legacyOverview: measure(() => legacyAdminOverview(store)),
    gamePage25: measure(() => readGamePage(store, { page: 1, size: 25 })),
    versionPage10: measure(() => readVersionPage(store, 'scale-0000', { page: 1, size: 10 })),
    updatePage25: measure(() => readUpdatePage(store, { page: 1, size: 25, status: 'pending' })),
    taskStatus: measure(() => readAdminTasks(store)),
  };
  mkdirSync('output/benchmarks', { recursive: true });
  writeFileSync('output/benchmarks/admin-data.json', JSON.stringify(result, null, 2) + '\n');
  mkdirSync('docs/benchmarks', { recursive: true });
  writeFileSync('docs/benchmarks/admin-data.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  store.sqlite.close();
  rmSync(directory, { recursive: true, force: true });
}
