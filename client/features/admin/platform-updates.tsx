import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, Download, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import type { UpdateStatus } from '../../../shared/update';
import { api } from '../../api';
import { Dialog } from '../../dialog';
import { useNotice } from '../../environment/notices';
import { Spinner, Empty, ErrorMessage } from '../../ui/status';
import { date } from '../../ui/date';

const updatePhases: Record<string, string> = {
  queued: '準備更新',
  building: '建置與測試',
  'backing-up': '暫停服務並備份',
  deploying: '啟動新版',
  verifying: '健康檢查',
  completed: '更新完成',
  failed: '更新失敗',
  'rolling-back': '還原舊版',
  'rolled-back': '已回復舊版',
  'recovery-failed': '需人工回復',
};

export function PlatformUpdates() {
  const [data, setData] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const notice = useNotice();
  const load = useCallback(async () => {
    try {
      setData(await api<UpdateStatus>('/admin/updates'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [load]);
  const running = data?.jobs?.find((job) => job.status === 'running');
  const available = data?.latest && data.latest.commit !== data.current;
  return (
    <section className="platform-updates" aria-label="平台更新">
      <div className="update-heading">
        <div>
          <h2>平台版本</h2>
          <span className="muted">{data?.branch || 'main'}</span>
        </div>
        <button
          className="button"
          disabled={busy || !!running || !data?.enabled}
          onClick={async () => {
            setBusy(true);
            try {
              setData(await api<UpdateStatus>('/admin/updates/check', {}));
              setError('');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw size={16} className={busy ? 'spin' : ''} />
          檢查更新
        </button>
      </div>
      {error && <ErrorMessage message={error} retry={() => void load()} />}
      {!data ? (
        <Spinner />
      ) : !data.enabled ? (
        <div className="update-unavailable">
          <CircleAlert size={20} />
          <span>此部署尚未啟用 OTA 更新服務</span>
        </div>
      ) : (
        <>
          <div className="update-versions">
            <div>
              <span>目前提交</span>
              <code title={data.current}>{data.current.slice(0, 12)}</code>
            </div>
            <div>
              <span>最新提交</span>
              <code title={data.latest?.commit}>
                {data.latest?.commit.slice(0, 12) || '尚未檢查'}
              </code>
            </div>
            <div>
              <span>最後檢查</span>
              <strong>
                {data.checkedAt
                  ? new Intl.DateTimeFormat('zh-HK', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(new Date(data.checkedAt))
                  : '—'}
              </strong>
            </div>
          </div>
          <div className="update-release">
            <div>
              <span className={`status-badge ${available ? 'draft' : 'published'}`}>
                {available ? '有新版本' : data.latest ? '已是最新版本' : '等待檢查'}
              </span>
              <h3>{data.latest?.subject || 'GitHub 更新來源'}</h3>
              <a href={data.repository} target="_blank" rel="noreferrer">
                {data.repository?.replace('https://github.com/', '')}
                <ExternalLink size={13} />
              </a>
            </div>
            <button
              className="button primary"
              disabled={busy || !!running || !available}
              onClick={() => setConfirm(true)}
            >
              <Download size={16} />
              更新平台
            </button>
          </div>
          {data.checkError && <ErrorMessage message={data.checkError} />}
          {running && (
            <div className="update-progress" role="status">
              <LoaderCircle size={18} className="spin" />
              <strong>{updatePhases[running.phase] || running.phase}</strong>
              <code>{running.commit.slice(0, 12)}</code>
            </div>
          )}
          <h3 className="update-history-title">更新紀錄</h3>
          {!data.jobs?.length ? (
            <p className="muted">尚無更新紀錄</p>
          ) : (
            <div className="update-history">
              {data.jobs.map((job) => (
                <div className="update-job" key={job.id}>
                  <div>
                    <span
                      className={`status-badge ${job.status === 'completed' ? 'published' : job.status === 'failed' ? 'failed' : 'draft'}`}
                    >
                      {updatePhases[job.phase] || job.phase}
                    </span>
                    <code title={job.commit}>{job.commit.slice(0, 12)}</code>
                    <span className="muted">{date(job.startedAt)}</span>
                  </div>
                  {job.backup && (
                    <p>
                      備份：<code>{job.backup}</code>
                    </p>
                  )}
                  {job.error && (
                    <details>
                      <summary>錯誤詳情</summary>
                      <pre>{job.error}</pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {confirm && data?.latest && (
        <Dialog title="更新平台" onClose={() => setConfirm(false)}>
          <p className="update-confirm-copy">
            將部署提交 <code>{data.latest.commit.slice(0, 12)}</code>
            。切換版本時網站會短暫離線；帳號與遊戲資料會備份，啟動失敗時回復舊版。回復後需重新登入。
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setConfirm(false)}>
              取消
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('/admin/updates', { commit: data.latest!.commit });
                  setConfirm(false);
                  await load();
                  notice('平台更新已開始');
                } catch (e) {
                  notice((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Download size={16} />
              確認更新
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
