import { useCallback, useState } from 'react';
import { type Source } from '../../../shared/sources';
import type { Page } from '../../../shared/admin-data';
import { queryString, useAdminRead } from '../admin/admin-data';


export function useSources(query: string, page: number, selected: number[]) {
  const list = useAdminRead<Page<Source>>('/admin/source-list?' + queryString({ q: query, page, size: 25, scope: 'active' }));
  const chosen = useAdminRead<{ items: Source[] }>('/admin/source-selection', selected.length > 0, 0, { ids: selected });
  const [overrides, setOverrides] = useState<Record<number, Source>>({});
  const reload = useCallback(async () => { setOverrides({}); list.reload(); chosen.reload(); }, [list.reload, chosen.reload]);
  const rows = [...(list.data?.items || []), ...(chosen.data?.items || [])];
  const sources = [...new Map(rows.map((row) => [row.id, overrides[row.id] || row])).values()];
  const update = useCallback(
    (source: Source) => setOverrides((rows) => ({ ...rows, [source.id]: source })),
    [],
  );
  return { sources, visible: list.data?.items.map((row) => overrides[row.id] || row) || [], total: list.data?.total || 0, page: list.data?.page || page, loaded: !!list.data && (!selected.length || !!chosen.data), error: list.error || chosen.error, reload, update };
}
export async function limited<T>(items: T[], run: (item: T) => Promise<void>, signal?: AbortSignal) {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, items.length) }, async () => {
      while (index < items.length && !signal?.aborted) {
        const item = items[index++];
        await run(item);
      }
    }),
  );
}
