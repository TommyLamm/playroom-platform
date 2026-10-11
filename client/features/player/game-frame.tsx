import { useContext, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Gamepad2, Maximize, Minimize, RefreshCw } from 'lucide-react';
import type { PublicGame } from '../../../shared/types';
import { canAccessAdmin } from '../../../shared/account';
import { useGameBridge } from '../../game-bridge';
import { SdkDiagnosticsPanel } from '../../sdk-diagnostics';
import { useGameDisplay } from '../../use-game-display';
import { HomeScreenInstallButton } from '../../home-screen';
import type { GameManifest } from '../../../shared/manifest';
import { trackVisitor } from '../../visitor-tracking';
import { SessionContext } from '../../environment/session';
import { Spinner, Empty, ErrorMessage } from '../../ui/status';

export function GameFrame({
  url,
  title,
  onBack,
  expiresAt,
  game,
  previewManifest,
  onExpandedChange,
}: {
  url: string;
  title: string;
  onBack?: () => void;
  expiresAt?: number;
  game?: PublicGame;
  previewManifest?: GameManifest;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [restart, setRestart] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [verified, setVerified] = useState(false);
  const [loadedFrame, setLoadedFrame] = useState('');
  const lastTrackedFrame = useRef('');
  const loadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const display = useGameDisplay(container, frame, onExpandedChange);
  const { session } = useContext(SessionContext);
  const bridge = useGameBridge(frame, url, game, session, restart, previewManifest);
  useEffect(() => {
    if (!game || !session || loadedFrame !== `${url}-${restart}-${bridge.identity}` || lastTrackedFrame.current === loadedFrame) return;
    if (session.authenticated && canAccessAdmin(session.role)) return;
    lastTrackedFrame.current = loadedFrame;
    trackVisitor({ kind: 'game_open', path: `/play/${game.id}`, gameId: game.id, version: game.version });
  }, [game, session, loadedFrame, url, restart, bridge.identity]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setVerified(false);
    // iframe onload fires even for HTTP errors, so verify the entry before mounting it.
    loadTimer.current = setTimeout(() => {
      controller.abort();
      setLoading(false);
      setError('載入時間較長，請檢查連線後重試');
    }, 20000);
    void fetch(url, { method: 'HEAD', credentials: 'omit', signal: controller.signal })
      .then((response) => {
        if (!response.ok)
          throw new Error(
            response.status === 403 ? '預覽連結已失效，請重新預覽' : '遊戲目前無法載入，可能已下架',
          );
        if (!controller.signal.aborted) setVerified(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          clearTimeout(loadTimer.current);
          setLoading(false);
          setError(
            e.message === 'Failed to fetch' ? '無法連線到遊戲，請檢查網路後重試' : e.message,
          );
        }
      });
    return () => {
      controller.abort();
      clearTimeout(loadTimer.current);
    };
  }, [url, restart]);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);
  return (
    <div className="game-shell" ref={container} data-display-mode={display.mode}>
      {display.expanded && <button className="game-display-exit" title="退出全螢幕" aria-label="退出全螢幕" onClick={() => void display.exit()}><Minimize size={20} /></button>}
      {display.hint && <div className="game-display-hint" role="status">{display.hint}</div>}
      <div className="player-toolbar">
        <div>
          {onBack && (
            <button className="icon-button" title="返回" onClick={onBack}>
              <ArrowLeft size={19} />
            </button>
          )}
          <Gamepad2 size={19} />
          <strong>{title}</strong>
          {expiresAt && <span className="badge amber">預覽</span>}
        </div>
        <div>
          <button
            className="icon-button"
            title="重新開始"
            onClick={() => {
              setError('');
              setLoading(true);
              setRestart((v) => v + 1);
            }}
          >
            <RefreshCw size={18} />
          </button>
          <button ref={display.enterButton} className="icon-button" title="全螢幕" disabled={display.busy} onClick={() => void display.enter()}>
            <Maximize size={19} />
          </button>
          <HomeScreenInstallButton />
        </div>
      </div>
      <div className="game-viewport">
        {expired ? (
          <Empty title="預覽連結已過期" text="請關閉預覽，重新取得預覽連結。" />
        ) : (
          <>
            {verified && (
              <iframe
                key={`${url}-${restart}-${bridge.identity}`}
                ref={frame}
                title={title}
                src={url}
                sandbox="allow-scripts allow-same-origin allow-pointer-lock"
                allow="fullscreen; autoplay; gamepad"
                allowFullScreen
                referrerPolicy="no-referrer"
                onLoad={() => {
                  clearTimeout(loadTimer.current);
                  setLoading(false);
                  bridge.onLoad();
                  setLoadedFrame(`${url}-${restart}-${bridge.identity}`);
                  if (display.expanded) frame.current?.focus({ preventScroll: true });
                }}
                onError={() => {
                  clearTimeout(loadTimer.current);
                  setLoading(false);
                  setError('遊戲載入失敗，請重試');
                }}
              />
            )}
            {loading && (
              <div className="frame-overlay">
                <Spinner text="遊戲載入中" />
              </div>
            )}
            {error && (
              <div className="frame-error">
                <ErrorMessage message={error} retry={() => setRestart((v) => v + 1)} />
              </div>
            )}
          </>
        )}
      </div>
      <div className="record-status" role="status">
        <span>{bridge.status}</span>
        {bridge.retryable && <button className="button secondary small" onClick={bridge.retry}>重試保存</button>}
      </div>
      {previewManifest && <SdkDiagnosticsPanel manifest={previewManifest} diagnostics={bridge.diagnostics} loading={loading} error={error} expired={expired} clear={bridge.clearDiagnostics} />}
    </div>
  );
}
