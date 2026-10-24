import { useRef } from 'react';
import { ChevronDown, Grid2X2 } from 'lucide-react';
import { useDismissableDetails } from '../../ui/dismissable-details';
import { splitCatalogTags, type CatalogTag } from './catalog-tags';

/** Popular tags stay on the bar; the rest live in a "more" menu that takes over the label once picked. */
export function CatalogFilters({ tags, selected, onSelect }: {
  tags: CatalogTag[]; selected: string; onSelect: (key: string) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useDismissableDetails(menu);
  const { popular, more } = splitCatalogTags(tags);
  const picked = more.find((tag) => tag.key === selected);
  const chip = (tag: CatalogTag) => (
    <button key={tag.key} className={selected === tag.key ? 'active' : ''} aria-pressed={selected === tag.key}
      onClick={() => { onSelect(tag.key); if (menu.current) menu.current.open = false; }}>
      {tag.label} <span className="tag-count">{tag.count}</span>
    </button>
  );
  return (
    <div className="filter-tabs" role="group" aria-label="遊戲分類">
      <button className={selected ? '' : 'active'} aria-pressed={!selected} onClick={() => onSelect('')}>
        <Grid2X2 size={15} /> 全部遊戲
      </button>
      {popular.map(chip)}
      {more.length > 0 && (
        <details className="catalog-more" ref={menu}>
          <summary className={picked ? 'active' : ''}>
            {picked ? <>{picked.label} <span className="tag-count">{picked.count}</span></> : '更多分類'}
            <ChevronDown size={14} />
          </summary>
          <div className="catalog-more-panel" role="group" aria-label="更多分類">{more.map(chip)}</div>
        </details>
      )}
    </div>
  );
}
