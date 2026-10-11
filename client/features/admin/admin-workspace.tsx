import { AdminDataProvider, useAdminRead, useAdminRefresh } from './admin-data';
import type { AdminSummary, AdminTasks } from '../../../shared/admin-data';
import { usePreviewQueue } from './preview-queue';
import { OperationConfirmation, useOperationConfirmation } from './operation-confirmation';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Clock3, Gamepad2, Github, Grid2X2, History, LayoutDashboard, LoaderCircle, LogOut, Menu, Plus, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import type { AdminGame, ImportJob, Repository } from '../../../shared/types';
import { canAccessAdmin, hasPermission, roleLabels } from '../../../shared/account';
import { api, gameCommand } from '../../api';
import { useCommandRecovery } from './command-recovery';
import type { GameManifest } from '../../../shared/manifest';
import { ImportWorkspace, ImportBatches } from '../../admin-sources';
import { AdminAccounts } from '../../admin-accounts';
import { Dialog } from '../../dialog';
import { GameUpdatesPanel } from '../../admin-game-updates';
import { type SourceCheck } from '../../../shared/game-updates';
import type { Source, ImportSelection } from '../../../shared/sources';
import { AdminGames } from '../../admin-games';
import { updateRows, isPendingUpdate } from '../../game-update-model';
import { SessionContext } from '../../environment/session';
import { useNotice } from '../../environment/notices';
import { Spinner, Empty, ErrorMessage } from '../../ui/status';
import { AuthPage } from '../account/auth-page';
import { GameFrame } from '../player/game-frame';
import { PlatformUpdates } from './platform-updates';
import { ImportHistory } from './import-history';
const AdminAnalytics = React.lazy(async () => ({ default: (await import('../../admin-analytics')).AdminAnalytics }));

export function Admin() {
  const { session, refresh } = useContext(SessionContext);
  useEffect(() => {
    if (!session?.authenticated) return;
    const timer = setInterval(() => { if (!document.hidden) void refresh().catch(() => {}); }, 3000);
    const focus = () => { void refresh().catch(() => {}); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [session?.authenticated, refresh]);
  return <AdminDataProvider key={session?.authenticated ? `${session.username}:${session.role}` : 'guest'}><AdminWorkspace /></AdminDataProvider>;
}

function AdminWorkspace() {
  const { session, refresh } = useContext(SessionContext);
  const role = session?.authenticated ? session.role : 'player';
  const canManageGames = hasPermission(role, 'games.manage');
  const canReadAnalytics = hasPermission(role, 'analytics.read');
  const canManagePlatform = hasPermission(role, 'platform.manage');
  const canManageAccounts = hasPermission(role, 'accounts.manage');
  const [importing, setImporting] = useState(false);
  const [importIds, setImportIds] = useState<number[]>([]);
  const [importSelections, setImportSelections] = useState<ImportSelection[] | undefined>();
  const checkedOnEntry = useRef(false);
  const { confirmation: confirm, requestConfirmation: setConfirm } = useOperationConfirmation();
  const [tab, setTab] = useState(canManageGames ? 'game-updates' : 'analytics');
  const [visited, setVisited] = useState(() => new Set([canManageGames ? 'game-updates' : 'analytics']));
  const [navigationOpen, setNavigationOpen] = useState(false);
  function selectTab(next: string) { setTab(next); setVisited((tabs) => new Set([...tabs, next])); setNavigationOpen(false); }
  const pageInfo: Record<string, [string, string]> = {
    'game-updates': ['遊戲更新', '集中管理來源、新版匯入與發布。'], games: ['遊戲與版本', '快速找到遊戲，管理目前與歷史版本。'],
    imports: ['匯入紀錄', '追蹤匯入進度，處理需要重試的項目。'], analytics: ['營運概況', '查看遊戲與訪客彙總統計。'],
    updates: ['平台更新', '檢查平台版本與部署狀態。'], accounts: ['帳號權限', '管理工作區成員與角色。'],
  };
  const notice = useNotice();
  const load = useAdminRefresh();
  const recoverCommand = useCommandRecovery();
  const summary = useAdminRead<AdminSummary>('/admin/summary', canManageGames);
  const tasks = useAdminRead<AdminTasks>('/admin/tasks', canManageGames, 3000);
  const check = useAdminRead<{ check: SourceCheck | null }>('/admin/source-checks/current', canManageGames, 3000);
  const sourceCheck = check.data?.check || null;
  const error = summary.error || tasks.error || check.error;
  const previousPending = useRef<number | null>(null);
  const previousCheck = useRef<string | null>(null);
  useEffect(() => {
    if (!tasks.data) return;
    if (previousPending.current && !tasks.data.pending) void load();
    previousPending.current = tasks.data.pending;
  }, [tasks.data, load]);
  useEffect(() => {
    if (!sourceCheck) return;
    if (previousCheck.current === 'running' && sourceCheck.status !== 'running') void load();
    previousCheck.current = sourceCheck.status;
  }, [sourceCheck, load]);
  const checkSources = useCallback(async (force = true) => {
    const result = await api<{ check: SourceCheck }>('/admin/source-checks', { force });
    previousCheck.current = result.check.status;
    await load();
  }, [load]);
  useEffect(() => {
    if (!canManageGames) { checkedOnEntry.current = false; return; }
    if (checkedOnEntry.current) return;
    checkedOnEntry.current = true;
    void checkSources(false).catch((e) => notice((e as Error).message, true));
  }, [canManageGames, checkSources, notice]);
  async function mutate(action: () => Promise<unknown>, message: string) {
    try { await action(); }
    catch (error) { await recoverCommand(error); throw error; }
    await load(); notice(message);
  }
  const { preview, previewQueue, previewExpanded, setPreviewExpanded, reviewing, showPreview, previewSequence, approvePreview, closePreview } = usePreviewQueue(load);
  async function previewImported(gameId: string, version: string) {
    try {
      const game = { id: gameId };
      setImporting(false);
      setImportSelections(undefined);
      await showPreview(game, version);
    } catch (e) {
      notice((e as Error).message, true);
    }
  }
  if (!session)
    return (
      <main className="page">
        <Spinner />
      </main>
    );
  if (!session.authenticated) return <AuthPage admin />;
  if (!canAccessAdmin(session.role))
    return (
      <main className="page">
        <Empty title="這裡是管理員工作區" text="你的玩家帳號可以在大廳選擇遊戲。">
          <Link className="button primary" to="/">
            返回遊戲大廳
          </Link>
        </Empty>
      </main>
    );
  const pendingCount = summary.data?.pending || 0;
  const navigation = <nav className="admin-navigation" aria-label="後台導覽">
    {canManageGames && <><span className="admin-nav-group">遊戲管理</span>
      <button className={tab === 'game-updates' ? 'active' : ''} aria-current={tab === 'game-updates' ? 'page' : undefined} onClick={() => selectTab('game-updates')}><RefreshCw size={18} /><span>遊戲更新</span><span className="admin-nav-count">{pendingCount}</span></button>
      <button className={tab === 'games' ? 'active' : ''} aria-current={tab === 'games' ? 'page' : undefined} onClick={() => selectTab('games')}><Gamepad2 size={18} /><span>遊戲與版本</span></button>
      <button className={tab === 'imports' ? 'active' : ''} aria-current={tab === 'imports' ? 'page' : undefined} onClick={() => selectTab('imports')}><History size={18} /><span>匯入紀錄</span>{!!tasks.data?.pending && <span className="status-dot" />}</button></>}
    {(canReadAnalytics || canManagePlatform || canManageAccounts) && <span className="admin-nav-group">平台管理</span>}
    {canReadAnalytics && <button className={tab === 'analytics' ? 'active' : ''} aria-current={tab === 'analytics' ? 'page' : undefined} onClick={() => selectTab('analytics')}><Grid2X2 size={18} /><span>營運概況</span></button>}
    {canManagePlatform && <button className={tab === 'updates' ? 'active' : ''} aria-current={tab === 'updates' ? 'page' : undefined} onClick={() => selectTab('updates')}><RefreshCw size={18} /><span>平台更新</span></button>}
    {canManageAccounts && <button className={tab === 'accounts' ? 'active' : ''} aria-current={tab === 'accounts' ? 'page' : undefined} onClick={() => selectTab('accounts')}><ShieldCheck size={18} /><span>帳號權限</span></button>}
  </nav>;
  const openImport = () => { setImportSelections(undefined); setImportIds([]); setImporting(true); };
  return (
    <main className="page admin-page">
      <aside className="admin-sidebar"><div className="admin-sidebar-brand"><LayoutDashboard size={22} /><div><strong>管理工作台</strong><small>PLAYROOM WORKSPACE</small></div></div>{navigation}<div className="admin-sidebar-account"><span className="account-avatar"><UserRound size={17} /></span><div><strong>{session.username}</strong><small>{roleLabels[role]}</small></div></div></aside>
      <div className="admin-content">
      <header className="admin-intro"><div><div className="eyebrow">管理工作台 / {canManageGames && ['games', 'game-updates', 'imports'].includes(tab) ? '遊戲管理' : '平台管理'}</div><h1>{pageInfo[tab][0]}</h1><p>{pageInfo[tab][1]}</p></div>
        <div className="admin-actions"><button className="button admin-mobile-nav" aria-label="開啟後台導覽" onClick={() => setNavigationOpen(true)}><Menu size={18} /></button>
          {canManageGames && <button className="icon-button" title="重新整理" onClick={() => void load()}><RefreshCw size={17} /></button>}
          <button className="button" onClick={async () => { try { await api('/logout', {}); await refresh(); } catch (e) { notice((e as Error).message, true); } }}><LogOut size={16} /><span>登出</span></button>
          {canManageGames && ['games', 'game-updates', 'imports'].includes(tab) && <button className="button primary" onClick={openImport}><Plus size={17} />匯入遊戲</button>}
        </div>
      </header>
      {canManageGames && ['games', 'game-updates'].includes(tab) && <div className="stats-row">
        <div><span>全部遊戲</span><strong>{summary.data?.games || 0}</strong><Gamepad2 /></div>
        <div><span>已上架</span><strong>{summary.data?.published || 0}</strong><span className="stat-dot green" /></div>
        <div><span>待處理更新</span><strong>{pendingCount}</strong><span className="stat-dot yellow" /></div>
        <div><span>使用中來源</span><strong>{summary.data?.activeSources || 0}</strong><Github /></div>
      </div>}
      {error && <ErrorMessage message={error} retry={() => void load()} />}
      {visited.has('accounts') && canManageAccounts && <div hidden={tab !== 'accounts'}><AdminAccounts username={session.username} onChanged={refresh} /></div>}
      {visited.has('analytics') && canReadAnalytics && <div hidden={tab !== 'analytics'}><React.Suspense fallback={<Spinner />}><AdminAnalytics canViewRecords={hasPermission(role, 'visitors.read')} /></React.Suspense></div>}
      {visited.has('updates') && canManagePlatform && <div hidden={tab !== 'updates'}><PlatformUpdates /></div>}
      {canManageGames && !summary.data && <Spinner />}
      {canManageGames && summary.data && <>
        <div hidden={tab !== 'game-updates'}><GameUpdatesPanel active={tab === 'game-updates'} check={sourceCheck} onChanged={load} onCheck={checkSources}
          onPreview={(items) => void previewSequence(items)}
          onImport={(items) => { setImportSelections(items); setImportIds(items.map((item) => item.repositoryId)); setImporting(true); }}
          onManualImport={(ids) => { setImportSelections(undefined); setImportIds(ids); setImporting(true); }} /></div>
        {visited.has('games') && <div hidden={tab !== 'games'}><AdminGames active={tab === 'games'} onImport={openImport}
          onPreview={(game, version) => void showPreview(game, version)}
          onRevokeReview={(game, version) => setConfirm({ title: '撤銷預覽確認', text: '撤銷 ' + game.name + ' v' + version + ' 的驗收確認。', action: () => mutate(() => gameCommand(game.id, 'review', { version, approved: false }), '預覽確認已撤銷') })}
          onPublish={(game, version) => setConfirm({ title: version.publishedAt ? '切換發布版本' : '發布遊戲', text: '將 ' + game.name + ' 的 v' + version.version + ' 設為目前上架版本。', action: () => mutate(() => gameCommand(game.id, 'publish', { version: version.version, expectedActiveVersion: game.activeVersion, expectedPublished: game.published }), '遊戲已發布') })}
          onUnpublish={(game) => setConfirm({ title: '下架遊戲', text: '下架後，玩家將無法開啟這款遊戲。所有版本會保留。', action: () => mutate(() => gameCommand(game.id, 'unpublish', { expectedActiveVersion: game.activeVersion, expectedPublished: game.published }), '遊戲已下架') })} /></div>}
        {visited.has('imports') && <div hidden={tab !== 'imports'}><ImportBatches active={tab === 'imports'} onChanged={() => void load()} onPreview={(id, version) => void previewImported(id, version)} /><ImportHistory jobs={tasks.data?.jobs || []} repositories={(tasks.data?.jobs || []).map((job) => ({ id: job.repositoryId, fullName: job.repositoryName, createdAt: '' }))} /></div>}
      </>}
      </div>
      {navigationOpen && <Dialog title="後台導覽" drawer onClose={() => setNavigationOpen(false)}>{navigation}</Dialog>}
      {importing && (
        <Dialog title="從 GitHub 匯入" wide onClose={() => {
          setImporting(false);
          setImportSelections(undefined);
          void load();
        }}>
          <ImportWorkspace
            initialIds={importIds}
            initialSelections={importSelections}
            onChanged={() => {
              if (tab !== 'game-updates') selectTab('imports');
              void load();
            }}
            onPreview={(id, version) => void previewImported(id, version)}
          />
        </Dialog>
      )}
      {preview && (
        <Dialog title="遊戲預覽" wide closeDisabled={reviewing} dismissOnEscape={!previewExpanded} onClose={closePreview}>
          <GameFrame key={`${preview.gameId}:${preview.version}`} {...preview} onExpandedChange={setPreviewExpanded} />
          <p className="preview-note">
            <Clock3 size={14} />
            預覽授權有效 15 分鐘
          </p>
          <div className="preview-review-actions"><p>確認代表你已實際驗收開始、主要玩法、結束及重新開始，並檢查資源與錯誤。確認將保存並供其他管理者共用。</p>
            <button className="button primary" disabled={reviewing || Date.now() >= preview.expiresAt} onClick={() => void approvePreview()}>{reviewing ? '保存確認…' : previewQueue.length ? '確認通過並看下一款' : '確認通過'}</button></div>
        </Dialog>
      )}
      {confirm && <OperationConfirmation confirmation={confirm} onClose={() => setConfirm(null)} />}
    </main>
  );
}
