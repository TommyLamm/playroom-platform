export type CatalogTag = { key: string; label: string; count: number };

/** Tags are free text from each manifest, so spelling variants such as `Roguelike` share one filter. */
export const tagKey = (tag: string) => tag.normalize('NFKC').trim().toLocaleLowerCase();

/** Groups catalog tags by normalized key, most used first; the label is the most common spelling. */
export function catalogTags(games: readonly { tags: readonly string[] }[]): CatalogTag[] {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const game of games) {
    const seen = new Set<string>();
    for (const tag of game.tags) {
      const key = tagKey(tag);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const group = groups.get(key) ?? { count: 0, spellings: new Map<string, number>() };
      group.count++;
      group.spellings.set(tag.trim(), (group.spellings.get(tag.trim()) ?? 0) + 1);
      groups.set(key, group);
    }
  }
  return [...groups].map(([key, { count, spellings }]) => ({
    key, count,
    // Map order is first-seen order, so ties keep the earliest spelling.
    label: [...spellings].reduce((best, next) => (next[1] > best[1] ? next : best))[0],
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hant'));
}

/** Keeps the bar to a few shared tags; the long tail of single-game tags goes to the "more" menu. */
export function splitCatalogTags(tags: readonly CatalogTag[], limit = 6) {
  // A menu holding only one or two leftovers costs more than showing them.
  if (tags.length <= limit + 2) return { popular: [...tags], more: [] };
  const shared = tags.filter((tag) => tag.count > 1);
  const popular = (shared.length ? shared : tags).slice(0, limit);
  return { popular, more: tags.filter((tag) => !popular.includes(tag)) };
}
