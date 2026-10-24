import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogTags, splitCatalogTags, tagKey } from '../client/features/lobby/catalog-tags.js';

test('catalog tags merge case and width variants and count each game once', () => {
  assert.equal(tagKey(' Ｒｏｇｕｅｌｉｋｅ '), 'roguelike');
  const tags = catalogTags([
    { tags: ['roguelike', '射擊', 'Roguelike'] },
    { tags: ['Roguelike', '卡牌'] },
    { tags: ['Roguelike', '射擊'] },
  ]);
  assert.deepEqual(tags, [
    { key: 'roguelike', label: 'Roguelike', count: 3 },
    { key: '射擊', label: '射擊', count: 2 },
    { key: '卡牌', label: '卡牌', count: 1 },
  ]);
});

test('small tag sets stay inline while long tails move to the more menu', () => {
  const tag = (label: string, count: number) => ({ key: label, label, count });
  const few = [tag('a', 1), tag('b', 1), tag('c', 1)];
  assert.deepEqual(splitCatalogTags(few, 2), { popular: few, more: [] });

  const many = [tag('a', 3), tag('b', 2), tag('c', 2), tag('d', 1), tag('e', 1), tag('f', 1)];
  const split = splitCatalogTags(many, 2);
  assert.deepEqual(split.popular.map((t) => t.key), ['a', 'b']);
  assert.deepEqual(split.more.map((t) => t.key), ['c', 'd', 'e', 'f']);

  // Only shared tags earn a chip; with none, the most common ones still fill the bar.
  assert.deepEqual(splitCatalogTags([tag('a', 2), ...many.slice(3), tag('g', 1), tag('h', 1)], 3).popular.map((t) => t.key), ['a']);
  const singles = ['a', 'b', 'c', 'd', 'e', 'f'].map((label) => tag(label, 1));
  assert.deepEqual(splitCatalogTags(singles, 2).popular.map((t) => t.key), ['a', 'b']);
});
