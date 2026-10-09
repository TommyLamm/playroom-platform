import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Github,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { api } from './api';
import type { Repository } from '../shared/types';
import {
  defaultRelease,
  eligibleRelease,
  pendingJob,
  type Source,
  type GitHubOwner,
  type DiscoveredRepository,
  type ImportBatch,
  type BatchSummary,
  type ImportSelection,
} from '../shared/sources';
import './admin-sources.css';

const labels: Record<string, string> = {
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
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('zh-HK', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
function ErrorNote({ error, retry }: { error: string; retry?: () => void }) {
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
function Busy({ text }: { text: string }) {
  return (
    <span className="source-busy" role="status">
      <LoaderCircle size={16} className="spin" />
      {text}
    </span>
  );
}
function useSources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      const data = await api<{ sources: Source[] }>('/admin/sources');
      setSources(data.sources);
      setLoaded(true);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const update = useCallback(
    (source: Source) => setSources((rows) => rows.map((r) => (r.id === source.id ? source : r))),
    [],
  );
  return { sources, loaded, error, reload, update };
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
function Pager({
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
function SearchInput({
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
function RepoName({ fullName }: { fullName: string }) {
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

type AddResult = { name: string; repository?: Repository; error?: string; existing?: boolean };
function normalizeInput(value: string) {
  let name = value.trim();
  if (/^https:\/\//i.test(name)) {
    const url = new URL(name);
    if (
      url.origin !== 'https://github.com' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error('請使用 GitHub repository URL');
    name = url.pathname.slice(1);
  }
  name = name
    .replace(/\/$/, '')
    .replace(/\.git$/i, '')
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/.test(name) || /\/\.{1,2}$/.test(name))
    throw new Error('請輸入 owner/repo 或 GitHub repository URL');
  return name;
}
export function AddSources({
  known,
  onAdded,
  initialMode = 'discover',
}: {
  known: Repository[];
  onAdded: (ids: number[]) => Promise<void>;
  initialMode?: 'discover' | 'paste';
}) {
  const [mode, setMode] = useState(initialMode);
  const [owners, setOwners] = useState<GitHubOwner[]>([]);
  const [login, setLogin] = useState('');
  const [owner, setOwner] = useState('');
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredRepository[]>([]);
  const [discoverPage, setDiscoverPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<AddResult[]>([]);
  const [addingProgress, setAddingProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const task = useRef<AbortController | null>(null);
  const discoveryRequest = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ owners: GitHubOwner[] }>('/admin/github-owners', undefined, {
      signal: controller.signal,
    })
      .then((d) => setOwners(d.owners))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      controller.abort();
      task.current?.abort();
      discoveryRequest.current++;
    };
  }, []);
  useEffect(() => setPage(1), [query]);
  async function discover(loginValue: string, nextPage: number) {
    const request = ++discoveryRequest.current;
    setOwnerBusy(true);
    setError('');
    if (nextPage === 1) {
      setDiscovered([]);
      setChecked([]);
      setQuery('');
      setPage(1);
      setDiscoverPage(0);
      setHasMore(false);
    }
    setOwner(loginValue);
    try {
      const data = await api<{ repositories: DiscoveredRepository[]; hasMore: boolean }>(
        `/admin/github-owners/${encodeURIComponent(loginValue)}/repositories?page=${nextPage}`,
      );
      if (request !== discoveryRequest.current) return;
      setDiscovered((prev) => [
        ...new Map(
          [...(nextPage === 1 ? [] : prev), ...data.repositories].map((r) => [r.fullName, r]),
        ).values(),
      ]);
      setHasMore(data.hasMore);
      setDiscoverPage(nextPage);
    } catch (e) {
      if (request === discoveryRequest.current) setError((e as Error).message);
    } finally {
      if (request === discoveryRequest.current) setOwnerBusy(false);
    }
  }
  async function addOwner() {
    setOwnerBusy(true);
    setError('');
    try {
      const { owner: added } = await api<{ owner: GitHubOwner }>('/admin/github-owners', {
        login: login.trim(),
      });
      setOwners((prev) => [...prev.filter((o) => o.login !== added.login), added]);
      setLogin('');
      await discover(added.login, 1);
    } catch (e) {
      setError((e as Error).message);
      setOwnerBusy(false);
    }
  }
  async function add(names: string[]) {
    setBusy(true);
    setError('');
    setResults([]);
    const parsed: string[] = [];
    const invalid: AddResult[] = [];
    for (const value of names) {
      try {
        parsed.push(normalizeInput(value));
      } catch (e) {
        invalid.push({ name: value, error: (e as Error).message });
      }
    }
    const unique = [...new Set(parsed)];
    if (unique.length + invalid.length > 100) {
      setError('每次最多加入 100 個來源，請分批處理。');
      setBusy(false);
      return;
    }
    setResults(invalid);
    setAddingProgress({ done: invalid.length, total: unique.length + invalid.length });
    const controller = new AbortController();
    task.current = controller;
    const ids: number[] = [];
    await limited(
      unique,
      async (name) => {
        let result: AddResult;
        try {
          const { repository } = await api<{ repository: Repository }>(
            '/admin/repositories',
            { fullName: name },
            { signal: controller.signal },
          );
          ids.push(repository.id);
          result = { name, repository, existing: known.some((r) => r.id === repository.id) };
        } catch (e) {
          result = { name, error: (e as Error).message };
        }
        if (!controller.signal.aborted) {
          setResults((prev) => [...prev, result]);
          setAddingProgress((p) => p && { ...p, done: p.done + 1 });
        }
      },
      controller.signal,
    );
    if (!controller.signal.aborted) {
      if (ids.length) await onAdded(ids);
      setChecked([]);
      setBusy(false);
    }
  }
  const visible = discovered.filter((r) =>
    `${r.fullName} ${r.description || ''}`.toLowerCase().includes(query.toLowerCase()),
  );
  const shown = visible.slice((page - 1) * 25, page * 25);
  const isKnown = (repo: DiscoveredRepository) =>
    repo.added ||
    known.some((r) => r.fullName === repo.fullName) ||
    results.some((r) => r.repository?.fullName === repo.fullName);
  return (
    <div className="add-sources">
      <div className="source-mode-tabs">
        <button
          className={mode === 'discover' ? 'active' : ''}
          disabled={busy}
          onClick={() => setMode('discover')}
        >
          <Github size={16} />
          從開發者帳號選擇
        </button>
        <button
          className={mode === 'paste' ? 'active' : ''}
          disabled={busy}
          onClick={() => setMode('paste')}
        >
          貼上多個來源
        </button>
      </div>
      <ErrorNote error={error} />
      {mode === 'discover' ? (
        <>
          <form
            className="source-owner-form"
            onSubmit={(e) => {
              e.preventDefault();
              void addOwner();
            }}
          >
            <label>
              GitHub 帳號或組織
              <input
                aria-label="GitHub 帳號或組織"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="例如 TommyLamm"
                maxLength={39}
                required
              />
            </label>
            <button className="button" disabled={ownerBusy || busy}>
              <Plus size={15} />
              保存並探索
            </button>
          </form>
          {!!owners.length && (
            <div className="source-owner-chips">
              {owners.map((o) => (
                <div key={o.login} className={owner === o.login ? 'active' : ''}>
                  <button disabled={ownerBusy || busy} onClick={() => void discover(o.login, 1)}>
                    {o.login}
                    {o.kind === 'Organization' && <small>組織</small>}
                  </button>
                  <button
                    className="source-owner-remove"
                    title={`移除常用帳號 ${o.login}`}
                    disabled={ownerBusy || busy}
                    onClick={async () => {
                      try {
                        await api(`/admin/github-owners/${o.login}/remove`, {});
                        setOwners((prev) => prev.filter((v) => v.login !== o.login));
                        if (owner === o.login) {
                          setOwner('');
                          setDiscovered([]);
                          setChecked([]);
                          setHasMore(false);
                        }
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {owner && (
            <>
              <div className="source-discovery-heading">
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder="搜尋已載入的 repositories"
                />
                <span>{discovered.length} 個已載入</span>
              </div>
              <div className="source-pick-tools">
                <button
                  className="button small"
                  disabled={busy || ownerBusy}
                  onClick={() =>
                    setChecked((prev) =>
                      [
                        ...new Set([
                          ...prev,
                          ...shown.filter((r) => !isKnown(r)).map((r) => r.fullName),
                        ]),
                      ].slice(0, 100),
                    )
                  }
                >
                  選取本頁未加入來源
                </button>
                <button className="button small" disabled={busy} onClick={() => setChecked([])}>
                  清除選取
                </button>
              </div>
              <div className="source-discovery-list">
                {shown.map((repo) => (
                  <label
                    className={`source-choice ${isKnown(repo) ? 'known' : ''}`}
                    key={repo.fullName}
                  >
                    <input
                      type="checkbox"
                      aria-label={`加入 ${repo.fullName}`}
                      disabled={
                        busy ||
                        isKnown(repo) ||
                        (!checked.includes(repo.fullName) && checked.length >= 100)
                      }
                      checked={checked.includes(repo.fullName)}
                      onChange={(e) =>
                        setChecked((prev) =>
                          e.target.checked
                            ? [...prev, repo.fullName]
                            : prev.filter((v) => v !== repo.fullName),
                        )
                      }
                    />
                    <span>
                      <strong>{repo.fullName}</strong>
                      <small>{repo.description || '沒有描述'}</small>
                    </span>
                    <span className="badge neutral">
                      {isKnown(repo)
                        ? '已加入'
                        : repo.archived
                          ? 'GitHub 已封存'
                          : repo.fork
                            ? 'Fork'
                            : '公開'}
                    </span>
                  </label>
                ))}
              </div>
              {!shown.length && !ownerBusy && (
                <p className="muted">
                  沒有符合條件的 repository。{hasMore && '可繼續載入更多再搜尋。'}
                </p>
              )}
              <Pager page={page} count={visible.length} onPage={setPage} />
              <div className="source-actions">
                {hasMore && (
                  <button
                    className="button"
                    disabled={ownerBusy || busy}
                    onClick={() => void discover(owner, discoverPage + 1)}
                  >
                    載入更多 repositories
                  </button>
                )}
                {error && !ownerBusy && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void discover(owner, Math.max(1, discoverPage || 1))}
                  >
                    重新讀取清單
                  </button>
                )}
                <button
                  className="button primary"
                  disabled={busy || ownerBusy || !checked.length || checked.length > 100}
                  onClick={() => void add(checked)}
                >
                  <Plus size={16} />
                  加入 {checked.length} 個來源
                </button>
              </div>
            </>
          )}
          {ownerBusy && <Busy text="正在讀取 GitHub repositories" />}
          {!owner && (
            <p className="muted">
              保存每位開發者的帳號，之後點一下即可探索。僅支援公開 repositories。
            </p>
          )}
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void add(
              text
                .split(/\r?\n/)
                .map((v) => v.trim())
                .filter(Boolean),
            );
          }}
        >
          <label>
            Repository
            <textarea
              aria-label="Repository"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'owner/game-one\nhttps://github.com/owner/game-two'}
              rows={5}
              maxLength={24000}
              required
              disabled={busy}
            />
          </label>
          <p className="muted">一行一個 URL 或 owner/repo；重複來源只加入一次，每次最多 100 個。</p>
          <div className="source-actions">
            <button className="button primary" disabled={busy || !text.trim()}>
              <Plus size={16} />
              加入來源
            </button>
          </div>
        </form>
      )}
      {addingProgress && (
        <p className="source-check-progress" role="status">
          {busy && <LoaderCircle className="spin" size={14} />}已處理 {addingProgress.done} /{' '}
          {addingProgress.total}
        </p>
      )}
      {!!results.length && (
        <div className="source-add-results">
          {results.map((r, i) => (
            <div key={`${r.name}-${i}`}>
              <strong>{r.name}</strong>
              <span className={r.error ? 'source-inline-error' : ''}>
                {r.error || (r.existing ? '來源已存在' : '已加入')}
              </span>
              {r.repository &&
                known.some((s) => s.id === r.repository!.id && 'archived' in s && s.archived) && (
                  <small>此來源已封存，請在來源管理中恢復。</small>
                )}
            </div>
          ))}
          {results.some((r) => r.error) && (
            <button
              className="button small"
              disabled={busy}
              onClick={() => void add(results.filter((r) => r.error).map((r) => r.name))}
            >
              重試失敗項目
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ImportWorkspace({
  initialIds = [],
  initialSelections,
  onChanged,
  onPreview,
}: {
  initialIds?: number[];
  initialSelections?: ImportSelection[];
  onChanged: () => void;
  onPreview: (gameId: string, version: string) => void;
}) {
  const { sources, loaded, error, reload, update } = useSources();
  const [step, setStep] = useState<1 | 2 | 3>(initialIds.length ? 2 : 1);
  const [selected, setSelected] = useState<number[]>(initialIds);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [choices, setChoices] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [progress, setProgress] = useState(0);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const task = useRef<AbortController | null>(null);
  const initialized = useRef(false);
  useEffect(() => () => task.current?.abort(), []);
  const activeSources = sources.filter((s) => !s.archived);
  async function prepare(ids = selected) {
    setStep(2);
    setBusy(true);
    setActionError('');
    setProgress(0);
    setRequestId(null);
    setChoices({});
    const controller = new AbortController();
    task.current = controller;
    await limited(
      ids,
      async (id) => {
        try {
          const { source } = await api<{ source: Source }>(
            `/admin/repositories/${id}/check`,
            {},
            { signal: controller.signal },
          );
          update(source);
          const choice = source.checkError
            ? undefined
            : defaultRelease(source.releases, source.importedReleaseIds);
          if (!controller.signal.aborted)
            setChoices((prev) => ({ ...prev, [id]: choice?.id || 0 }));
        } catch (e) {
          if (!controller.signal.aborted) setActionError((e as Error).message);
        }
        if (!controller.signal.aborted) setProgress((n) => n + 1);
      },
      controller.signal,
    );
    if (!controller.signal.aborted) setBusy(false);
  }
  useEffect(() => {
    if (!loaded || initialized.current) return;
    initialized.current = true;
    if (initialSelections?.length) {
      setSelected(initialSelections.map((item) => item.repositoryId));
      setChoices(Object.fromEntries(initialSelections.map((item) => [item.repositoryId, item.releaseId])));
      setStep(2);
    } else if (initialIds.length) void prepare(initialIds);
    else if (!activeSources.length) setAdding(true);
  }, [loaded]);
  async function submit(items: ImportSelection[]) {
    setBusy(true);
    setActionError('');
    const id = requestId || crypto.randomUUID();
    setRequestId(id);
    try {
      const result = await api<{ batch: ImportBatch }>('/admin/import-batches', {
        requestId: id,
        items,
      });
      setBatch(result.batch);
      setStep(3);
      onChanged();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const ready = selected.flatMap((id) =>
    choices[id] ? [{ repositoryId: id, releaseId: choices[id] }] : [],
  );
  const displayed = activeSources.filter((s) =>
    `${s.fullName} ${s.gameName || ''}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="import-workspace">
      <div className="import-steps" aria-label="匯入步驟">
        {['選來源', '確認版本', '匯入進度'].map((text, i) => (
          <span key={text} className={step === i + 1 ? 'active' : step > i + 1 ? 'done' : ''}>
            <b>{step > i + 1 ? <Check size={13} /> : i + 1}</b>
            {text}
          </span>
        ))}
      </div>
      <ErrorNote error={error} retry={() => void reload()} />
      <ErrorNote error={actionError} />
      {!loaded && !error ? (
        <Busy text="正在載入來源" />
      ) : step === 1 ? (
        <>
          <div className="source-heading">
            <div>
              <h3>選擇要匯入的遊戲來源</h3>
              <p>可一次選擇多款，下一步逐款確認版本。</p>
            </div>
            <button className="button small" disabled={busy} onClick={() => setAdding(!adding)}>
              <Plus size={15} />
              {adding ? '返回已有來源' : '加入新來源'}
            </button>
          </div>
          {adding ? (
            <AddSources
              initialMode={activeSources.length ? 'discover' : 'paste'}
              known={sources}
              onAdded={async (ids) => {
                await reload();
                setSelected(ids);
                onChanged();
              }}
            />
          ) : (
            <>
              <SearchInput value={query} onChange={setQuery} />
              <div className="source-pick-tools">
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() => setSelected(displayed.slice(0, 100).map((s) => s.id))}
                >
                  選取搜尋結果（最多 100 款）
                </button>
                <button className="button small" onClick={() => setSelected([])}>
                  清除選取
                </button>
              </div>
              <div className="import-source-list">
                {displayed.map((source) => (
                  <label
                    className={`source-choice ${selected.includes(source.id) ? 'selected' : ''}`}
                    key={source.id}
                  >
                    <input
                      type="checkbox"
                      aria-label={`匯入 ${source.fullName}`}
                      checked={selected.includes(source.id)}
                      disabled={!selected.includes(source.id) && selected.length >= 100}
                      onChange={(e) =>
                        setSelected((prev) =>
                          e.target.checked
                            ? [...prev, source.id]
                            : prev.filter((id) => id !== source.id),
                        )
                      }
                    />
                    <span>
                      <strong>{source.gameName || source.fullName.split('/')[1]}</strong>
                      <small>{source.fullName}</small>
                    </span>
                    <span className="badge neutral">{labels[source.status]}</span>
                  </label>
                ))}
              </div>
              {!displayed.length && <p className="muted">沒有符合條件的來源。</p>}
            </>
          )}
          <div className="import-footer">
            <span>已選 {selected.length} 款</span>
            <button
              className="button primary"
              disabled={
                busy ||
                !selected.length ||
                selected.length > 100 ||
                selected.some((id) => !activeSources.some((s) => s.id === id))
              }
              onClick={() => void prepare()}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}
              確認版本
            </button>
          </div>
        </>
      ) : step === 2 ? (
        <>
          <div className="source-heading">
            <div>
              <h3>確認匯入版本</h3>
              <p>預設選取最新可匯入正式版。預發布版本可手動選擇；完成後再預覽及上架。</p>
            </div>
          </div>
          {busy && <Busy text={`正在檢查 ${progress} / ${selected.length} 個來源`} />}
          <div className="import-release-groups">
            {selected.map((id) => {
              const source = sources.find((s) => s.id === id);
              if (!source) return null;
              return (
                <section className="import-release-group" key={id}>
                  <div className="source-heading">
                    <div>
                      <h4>{source.gameName || source.fullName.split('/')[1]}</h4>
                      <RepoName fullName={source.fullName} />
                    </div>
                    <button
                      className="button small"
                      disabled={busy}
                      onClick={() => {
                        setRequestId(null);
                        setChoices((prev) => ({ ...prev, [id]: 0 }));
                      }}
                    >
                      略過此款
                    </button>
                  </div>
                  <ErrorNote error={source.checkError || ''} />
                  {!source.releases.length && !busy && <p className="muted">尚無可用 Release。</p>}
                  <div className="release-list">
                    {source.releases.map((release) => {
                      const imported = source.importedReleaseIds.includes(release.id);
                      const disabled =
                        !eligibleRelease(release) || imported || busy || !!source.checkError;
                      return (
                        <label
                          className={`release-option ${disabled ? 'disabled' : ''} ${choices[id] === release.id ? 'chosen' : ''}`}
                          key={release.id}
                        >
                          <input
                            type="radio"
                            name={`release-${id}`}
                            aria-label={`${source.fullName} ${release.tag}`}
                            checked={choices[id] === release.id}
                            disabled={disabled}
                            onChange={() => {
                              setRequestId(null);
                              setChoices((prev) => ({ ...prev, [id]: release.id }));
                            }}
                          />
                          <span>
                            <strong>{release.name}</strong>
                            <small>
                              {release.tag} · {date(release.publishedAt)}
                              {release.prerelease && ' · 預發布'}
                              {imported
                                ? ' · 已匯入'
                                : !release.asset
                                  ? ' · 缺少唯一 game.zip'
                                  : !eligibleRelease(release)
                                    ? ' · tag 格式不符合規格'
                                    : ` · ${(release.asset.size / 1024 / 1024).toFixed(1)} MB`}
                            </small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="import-footer">
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                setStep(1);
                setAdding(false);
                setRequestId(null);
              }}
            >
              <ArrowLeft size={16} />
              選來源
            </button>
            <div className="source-actions">
              <button className="button" disabled={busy} onClick={() => void prepare()}>
                重新檢查
              </button>
              <button
                className="button primary"
                disabled={busy || !ready.length}
                onClick={() => void submit(ready)}
              >
                <Download size={16} />
                {ready.length === 1 ? '匯入此版本' : `匯入 ${ready.length} 款遊戲`}
              </button>
            </div>
          </div>
        </>
      ) : (
        batch && <BatchProgress initialBatch={batch} onChanged={onChanged} onPreview={onPreview} />
      )}
    </div>
  );
}

export function BatchProgress({
  initialBatch,
  onChanged,
  onPreview,
}: {
  initialBatch: ImportBatch;
  onChanged: () => void;
  onPreview: (id: string, version: string) => void;
}) {
  const [batch, setBatch] = useState(initialBatch);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ImportBatch[]>([initialBatch]);
  const viewedId = history[history.length - 1].id;
  const retryRequest = useRef<string | null>(null);
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await api<{ batch: ImportBatch }>(
          `/admin/import-batches/${viewedId}`,
          undefined,
          { signal },
        );
        if (!signal?.aborted) {
          setBatch(data.batch);
          setError('');
        }
      } catch (e) {
        if (!signal?.aborted) setError((e as Error).message);
      }
    },
    [viewedId],
  );
  useEffect(() => {
    setBatch(initialBatch);
    setHistory([initialBatch]);
    retryRequest.current = null;
  }, [initialBatch]);
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    const timer = setInterval(() => {
      if (!document.hidden) void reload(controller.signal);
    }, 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [reload]);
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

export function ImportBatches({
  onChanged,
  onPreview,
}: {
  onChanged: () => void;
  onPreview: (id: string, version: string) => void;
}) {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [opened, setOpened] = useState<ImportBatch | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      const data = await api<{ batches: BatchSummary[] }>('/admin/import-batches');
      setBatches(data.batches);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => {
      if (!document.hidden) void reload();
    }, 3000);
    return () => clearInterval(timer);
  }, [reload]);
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
