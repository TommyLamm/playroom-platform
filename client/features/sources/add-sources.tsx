import { useEffect, useId, useRef, useState } from 'react';
import { Github, LoaderCircle, Plus, X } from 'lucide-react';
import { api } from '../../api';
import type { Repository } from '../../../shared/types';
import { type GitHubOwner, type DiscoveredRepository } from '../../../shared/sources';
import { labels, date, ErrorNote, Busy, Pager, SearchInput, RepoName } from './source-ui';
import { limited } from './source-data';

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
  const repositoryHintId = useId();
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
            <label className="source-input-field">
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
          <label className="source-input-field">
            Repository
            <textarea
              aria-label="Repository"
              aria-describedby={repositoryHintId}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'owner/game-one\nhttps://github.com/owner/game-two'}
              rows={5}
              maxLength={24000}
              required
              disabled={busy}
              spellCheck={false}
            />
          </label>
          <p className="muted" id={repositoryHintId}>
            一行一個 URL 或 owner/repo；重複來源只加入一次，每次最多 100 個。
          </p>
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
