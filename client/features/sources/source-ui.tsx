import { ChevronLeft, ChevronRight, ExternalLink, LoaderCircle, Search } from 'lucide-react';


export const labels: Record<string, string> = {
  unchecked: '尚未檢查',
  available: '可匯入',
  current: '已匯入最新 Release',
  unavailable: '無可匯入正式版',
  error: '檢查失敗',
  importing: '匯入中',
  queued: '等待中',
  running: '處理中',
  completed: '已匯入',
  failed: '失敗',
  skipped: '已匯入・已跳過',
  resolving: '取得 Release',
  downloading: '下載中',
  validating: '驗證遊戲包',
  interrupted: '已中斷',
};
export const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('zh-HK', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
export function ErrorNote({ error, retry }: { error: string; retry?: () => void }) {
  if (!error) return null;
  return (
    <div className="source-error" role="alert">
      {error}
      {retry && (
        <button className="button small" onClick={retry}>
          重試
        </button>
      )}
    </div>
  );
}
export function Busy({ text }: { text: string }) {
  return (
    <span className="source-busy" role="status">
      <LoaderCircle size={16} className="spin" />
      {text}
    </span>
  );
}

export function Pager({
  page,
  count,
  onPage,
}: {
  page: number;
  count: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / 25));
  return (
    <div className="source-pager">
      <span>
        {count} 個來源・第 {page} / {pages} 頁
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="上一頁"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="下一頁"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}
export function SearchInput({
  value,
  onChange,
  placeholder = '搜尋遊戲或 repository',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="source-search">
      <Search size={16} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function RepoName({ fullName }: { fullName: string }) {
  return (
    <a
      className="source-repo-link"
      href={`https://github.com/${fullName}`}
      target="_blank"
      rel="noreferrer"
    >
      {fullName}
      <ExternalLink size={12} />
    </a>
  );
}
