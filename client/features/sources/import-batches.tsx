import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { api } from '../../api';
import { type ImportBatch, type BatchSummary } from '../../../shared/sources';
import { labels, date, ErrorNote, Busy, Pager, SearchInput, RepoName } from './source-ui';
import { BatchProgress } from './batch-progress';
import { useAdminRead } from '../admin/admin-data';

export function ImportBatches({
  active = true,
  onChanged,
  onPreview,
}: {
  active?: boolean;
  onChanged: () => void;
  onPreview: (id: string, version: string) => void;
}) {
  const [opened, setOpened] = useState<ImportBatch | null>(null);
  const list = useAdminRead<{ batches: BatchSummary[] }>('/admin/import-batches', active);
  const [actionError, setError] = useState('');
  const batches = list.data?.batches || [];
  const error = actionError || list.error;
  const reload = list.reload;
  return (
    <section className="import-batch-history">
      <div className="source-heading">
        <div>
          <h2>批次匯入</h2>
          <p>重新開啟批次可查看全部項目及重試失敗項目。</p>
        </div>
      </div>
      <ErrorNote error={error} retry={() => void reload()} />
      {opened ? (
        <>
          <button className="button small" onClick={() => setOpened(null)}>
            <ArrowLeft size={14} />
            返回批次列表
          </button>
          <BatchProgress
            key={opened.id}
            initialBatch={opened}
            active={active}
            onChanged={onChanged}
            onPreview={onPreview}
          />
        </>
      ) : (
        <div className="batch-history-list">
          {batches.map((batch) => (
            <button
              key={batch.id}
              className="batch-history-row"
              onClick={async () => {
                try {
                  setOpened(
                    (await api<{ batch: ImportBatch }>(`/admin/import-batches/${batch.id}`)).batch,
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <span>
                <strong>{batch.total} 款遊戲</strong>
                <small>{date(batch.createdAt)}</small>
              </span>
              <span>
                {batch.completed} 已匯入 / 跳過 · {batch.failed} 失敗
                {batch.pending ? ` · ${batch.pending} 處理中` : ''}
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
          {!batches.length && <p className="muted">尚無批次匯入紀錄。</p>}
        </div>
      )}
    </section>
  );
}
