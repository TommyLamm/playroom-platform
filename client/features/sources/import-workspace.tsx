import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Download, LoaderCircle, Plus } from 'lucide-react';
import { api } from '../../api';
import { defaultRelease, eligibleRelease, type Source, type ImportBatch, type ImportSelection } from '../../../shared/sources';
import { labels, date, ErrorNote, Busy, Pager, SearchInput, RepoName } from './source-ui';
import { useSources, limited } from './source-data';
import { AddSources } from './add-sources';
import { BatchProgress } from './batch-progress';

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
  const [step, setStep] = useState<1 | 2 | 3>(initialIds.length ? 2 : 1);
  const [selected, setSelected] = useState<number[]>(initialIds);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { sources, visible, total, page: shownPage, loaded, error, reload, update } = useSources(query, page, selected);
  const [adding, setAdding] = useState(false);
  const [choices, setChoices] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [progress, setProgress] = useState(0);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const task = useRef<AbortController | null>(null);
  const initialized = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    const available = new Set(sources.filter((source) => !source.archived).map((source) => source.id));
    setSelected((values) => values.every((id) => available.has(id)) ? values : values.filter((id) => available.has(id)));
  }, [loaded, sources.map((source) => `${source.id}:${source.archived}`).join(',')]);
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
  const displayed = visible;
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
              <SearchInput value={query} onChange={(value) => { setQuery(value); setPage(1); }} />
              <div className="source-pick-tools">
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() => setSelected((values) => [...new Set([...values, ...displayed.map((s) => s.id)])].slice(0, 100))}
                >
                  選取本頁（最多 100 款）
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
              <Pager page={shownPage} count={total} onPage={setPage} />
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
