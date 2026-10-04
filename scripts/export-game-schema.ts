import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { manifestSchema } from '../shared/manifest.js';

const schema = z.toJSONSchema(manifestSchema, { target: 'draft-7' });
schema.title = 'PLAYROOM Game Manifest v1';
schema.description =
  'Manifest structure. Run game:validate for archive, portable path and referenced-file checks.';
const output = path.resolve('templates/game.schema.json');
await fs.writeFile(output, JSON.stringify(schema, null, 2) + '\n');
console.info(`Game schema exported: ${output}`);
