import { LoaderCircle } from 'lucide-react';
import type { ImportJob, Repository } from '../../../shared/types';
import { Spinner, Empty, ErrorMessage } from '../../ui/status';
import { date } from '../../ui/date';

const phaseNames: Record<string, string> = {
  queued: '等待中',
  resolving: '取得 Release',
  downloading: '下載中',
  validating: '檢查遊戲包',
  completed: '已匯入',
  failed: '匯入失敗',
  interrupted: '已中斷',
};

export function ImportHistory({ jobs, repositories }: { jobs: ImportJob[]; repositories: Repository[] }) {
  if (!jobs.length)
    return <Empty title="還沒有匯入紀錄" text="匯入遊戲後，可以在這裡查看處理狀態。" />;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>來源</th>
            <th>狀態</th>
            <th>遊戲版本</th>
            <th>時間</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>
                <strong>{repositories.find((r) => r.id === job.repositoryId)?.fullName}</strong>
                <small>Release #{job.releaseId}</small>
              </td>
              <td>
                <span
                  className={`badge ${job.status === 'completed' ? 'green' : job.status === 'failed' ? 'red' : 'amber'}`}
                >
                  {job.status === 'running' && <LoaderCircle className="spin" size={12} />}{' '}
                  {phaseNames[job.phase] || job.phase}
                </span>
                {job.error && <p className="job-error">{job.error}</p>}
              </td>
              <td>{job.gameId ? `${job.gameId} · ${job.version}` : '—'}</td>
              <td>{date(job.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
