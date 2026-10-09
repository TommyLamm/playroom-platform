import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { manifestSchema } from '../shared/manifest.js';

// Describe game.json input; defaulted leaderboard fields are optional on input.
const schema = z.toJSONSchema(manifestSchema, { target: 'draft-7', io: 'input' });
schema.title = 'PLAYROOM Game Manifest v1';
schema.description =
  'Manifest input structure; defaults are applied by the platform validator. Run game:validate for score-range, archive, portable path and referenced-file checks.';
const output = path.resolve('templates/game.schema.json');
await fs.writeFile(output, JSON.stringify(schema, null, 2) + '\n');
console.info(`Game schema exported: ${output}`);
