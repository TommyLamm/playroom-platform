import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { manifestSchema } from '../shared/manifest.js';
import { testManifest } from './helpers.js';

test('published manifest schema describes defaulted leaderboard input', async () => {
  const schema = JSON.parse(await fs.readFile('templates/game.schema.json', 'utf8'));
  const generated = z.toJSONSchema(manifestSchema, { target: 'draft-7', io: 'input' });
  const { title: _title, description: _description, ...structure } = schema;
  assert.deepEqual(structure, generated, 'regenerate the published schema after changing the manifest');

  const input = { ...testManifest, leaderboard: { id: 'classic' } };
  assert.deepEqual(schema.properties.leaderboard.required, ['id']);
  const board = manifestSchema.parse(input).leaderboard!;
  assert.deepEqual(board, {
    id: 'classic', order: 'desc', unit: '分', minScore: 0, maxScore: Number.MAX_SAFE_INTEGER,
  });
  for (const field of ['order', 'unit', 'minScore', 'maxScore'] as const) {
    assert.equal(schema.properties.leaderboard.properties[field].default, board[field]);
  }
  assert.equal(manifestSchema.safeParse({ ...testManifest, leaderboard: {} }).success, false);
  assert.equal(manifestSchema.safeParse({ ...input, leaderboard: { ...input.leaderboard, minScore: 9, maxScore: 8 } }).success, false);
});
