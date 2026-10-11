import type { Migration } from '../migration.js';
import { migration1 } from './001.js';
import { migration2 } from './002.js';
import { migration3 } from './003.js';
import { migration4 } from './004.js';
import { migration5 } from './005.js';
import { migration6 } from './006.js';
import { migration7 } from './007.js';
import { migration8 } from './008.js';
import { migration9 } from './009.js';
import { migration10 } from './010.js';
import { migration11 } from './011.js';
import { migration12 } from './012.js';

export const migrations: readonly Migration[] = [
  migration1, migration2, migration3, migration4, migration5,
  migration6, migration7, migration8, migration9, migration10, migration11, migration12,
];
