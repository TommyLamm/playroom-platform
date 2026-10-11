import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { api } from '../../api';
import { pendingJob, type ImportBatch } from '../../../shared/sources';
import { labels, date, ErrorNote, Busy, Pager, SearchInput, RepoName } from './source-ui';
import { useAdminRead } from '../admin/admin-data';

export function BatchProgress({
  initialBatch,
  active = true,
  onChanged,
  onPreview,
}: {
  initialBatch: ImportBatch;
  active?: boolean;
  onChanged: () => void;
  onPreview: (id: string, version: string) => void;
}) {
  const [batch, setBatch] = useState(initialBatch);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ImportBatch[]>([initialBatch]);
  const viewedId = history[history.length - 1].id;
  const retryRequest = useRef<string | null>(null);
  const status = useAdminRead<{ batch: ImportBatch }>(`/admin/import-batches/${viewedId}`, active, batch.items.some(pendingJob) ? 3000 : 0);
  const reload = async () => status.reload();
  useEffect(() => { if (status.data) { setBatch(status.data.batch); setError(''); } else if (status.error) setError(status.error); }, [status.data, status.error]);
  useEffect(() => {
    setBatch(initialBatch);
    setHistory([initialBatch]);
    retryRequest.current = null;
  }, [initialBatch]);
  const pending = batch.items.filter(pendingJob).length;
  const complete = batch.items.filter((i) => ['completed', 'skipped'].includes(i.status)).length;
  const failed = batch.items.filter((i) => i.status === 'failed');
  const previousPending = useRef(pending);
  useEffect(() => {
    if (previousPending.current && !pending) onChanged();
    previousPending.current = pending;
  }, [pending, onChanged]);
  async function retryFailed() {
    setBusy(true);
    setError('');
    retryRequest.current ||= crypto.randomUUID();
    try {
      const { batch: next } = await api<{ batch: ImportBatch }>('/admin/import-batches', {
        requestId: retryRequest.current,
        items: failed.map((i) => ({ repositoryId: i.repositoryId, releaseId: i.releaseId })),
      });
      // Retries create a separate persistent batch, preserving the original history.
      setHistory((prev) => [...prev, next]);
      setBatch(next);
      retryRequest.current = null;
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="batch-progress">
      {history.length > 1 && (
        <div className="source-heading">
          <p>正在查看失敗項目的重試批次。</p>
          <button
            className="button small"
            disabled={busy}
            onClick={() => {
              const previous = history.slice(0, -1);
              setHistory(previous);
              setBatch(previous[previous.length - 1]);
              retryRequest.current = null;
            }}
          >
            返回上一批次
          </button>
        </div>
      )}
      <div className="source-heading">
        <div>
          <h3>{pending ? '遊戲正在匯入' : '匯入處理完成'}</h3>
          <p>{date(batch.createdAt)} · 關閉視窗後，匯入仍會繼續。</p>
        </div>
        <span className="badge neutral">{pending ? `${pending} 款處理中` : '已完成處理'}</span>
      </div>
      <div className="batch-counts">
        <div>
          <strong>{complete}</strong>
          <span>已匯入 / 跳過</span>
        </div>
        <div>
          <strong>{pending}</strong>
          <span>等待 / 處理中</span>
        </div>
        <div>
          <strong>{failed.length}</strong>
          <span>失敗 / 中斷</span>
        </div>
      </div>
      <progress
        max={batch.items.length}
        value={batch.items.length - pending}
        aria-label="批次處理進度"
      />
      <ErrorNote error={error} retry={() => void reload()} />
      <div className="batch-items">
        {batch.items.map((item) => (
          <div className="batch-item" key={`${item.repositoryId}-${item.releaseId}`}>
            <div>
              <strong>{item.fullName}</strong>
              <small>
                {item.version ? `v${item.version}` : `Release #${item.releaseId}`}
                {item.error && <span className="source-inline-error">{item.error}</span>}
              </small>
            </div>
            <span className={`badge ${item.status === 'completed' ? 'green' : 'neutral'}`}>
              {pendingJob(item) ? (
                <>
                  <LoaderCircle size={12} className="spin" />
                  {labels[item.phase || item.status] || labels[item.status]}
                </>
              ) : item.phase === 'interrupted' ? (
                '已中斷'
              ) : (
                labels[item.status]
              )}
            </span>
            {item.gameId && item.version && ['completed', 'skipped'].includes(item.status) && (
              <button
                className="button small"
                onClick={() => onPreview(item.gameId!, item.version!)}
              >
                預覽
              </button>
            )}
          </div>
        ))}
      </div>
      {!!failed.length && (
        <div className="import-footer">
          <span>失敗項目可單獨重試。</span>
          <button className="button primary" disabled={busy} onClick={() => void retryFailed()}>
            <RefreshCw size={16} />
            重試 {failed.length} 個失敗項目
          </button>
        </div>
      )}
    </section>
  );
}
