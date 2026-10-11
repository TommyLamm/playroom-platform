import { useEffect, useRef, useState, type RefObject } from 'react';
import { z } from 'zod';
import type { PublicGame } from '../shared/types';
import type { Session } from '../shared/account';
import type { GameManifest } from '../shared/manifest';
import { api, ApiError } from './api';
import { isHelloMessage, isRequestMessage, SDK_CAPABILITIES } from '../shared/protocol';
import { createPreviewOperations } from './game-bridge/preview';
import { createFormalOperations } from './game-bridge/formal';
import { createOperationRegistry } from './game-bridge/operations';
import { defaultErrorCode } from '../shared/errors';

export type SdkDiagnosticEvent = { id: number; at: number; kind: 'info' | 'success' | 'error'; text: string };
export type SdkDiagnostics = { state: 'waiting' | 'connected' | 'timeout'; simulation: boolean; events: SdkDiagnosticEvent[] };

export function useGameBridge(frame: RefObject<HTMLIFrameElement | null>, url: string, game: PublicGame | undefined, session: Session | null, restart: number, previewManifest?: GameManifest) {
  const [status, setStatus] = useState('');
  const [retryable, setRetryable] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SdkDiagnostics>({ state: 'waiting', simulation: false, events: [] });
  const loaded = useRef<() => void>(() => {});
  const retry = useRef<() => void>(() => {});
  const identity = session?.authenticated ? `${session.username}:${session.csrf}` : 'guest';
  useEffect(() => {
    let disposed = false;
    let started = false;
    let playId: string | null = null;
    let playPromise: Promise<string | null> | null = null;
    let invalid = false;
    const controller = new AbortController();
    const call = <T,>(path: string, body?: unknown) => api<T>(path, body, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
    });
    const connection = crypto.randomUUID();
    const visitRequestId = crypto.randomUUID();
    const origin = new URL(url).origin;
    // A preview manifest always forces the dry run path, even if a caller also passes a public game.
    const mode = previewManifest || !game ? 'preview' : session?.authenticated ? 'authenticated' : 'guest';
    const diagnose = mode === 'preview' && !!previewManifest;
    let sdkHello = false;
    let simulation = false;
    let eventId = 0;
    let diagnosticTimer: ReturnType<typeof setTimeout> | undefined;
    const record = (kind: SdkDiagnosticEvent['kind'], text: string) => {
      if (!diagnose || disposed) return;
      const entry = { id: ++eventId, at: Date.now(), kind, text };
      setDiagnostics((current) => ({ ...current, events: [...current.events.slice(-79), entry] }));
    };

    const operations = createOperationRegistry();
    const failed = new Map<string, { runId: string; score: number }>();

    setRetryable(false);
    setDiagnostics({ state: 'waiting', simulation: false, events: [] });
    setStatus(mode === 'guest' ? '登入後可保存遊戲記錄' : mode === 'preview' ? '預覽不保存遊戲記錄' : '正在連線遊戲記錄…');
    const send = (data: object) => {
      if (!disposed) frame.current?.contentWindow?.postMessage({ protocol: 'playroom', version: 1, connection, ...data }, origin);
    };
    const failure = (error: unknown) => {
      if (disposed) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        invalid = true;
        failed.clear();
        setRetryable(false);
        setStatus('登入已失效，請重新登入後重新開啟遊戲');
      } else {
        setStatus(`尚未保存：${error instanceof DOMException && error.name === 'TimeoutError' ? '連線逾時，請重試' : (error as Error).message}`);
        const terminal = error instanceof ApiError && [400, 404, 409].includes(error.status);
        setRetryable(!terminal && (failed.size > 0 || !playId));
      }
    };
    async function heartbeat(active = document.visibilityState === 'visible' && document.hasFocus()) {
      if (disposed || invalid || !playId) return;
      try { await call(`/plays/${playId}/heartbeat`, { active }); }
      catch (error) { if (error instanceof ApiError && [401, 403, 404].includes(error.status)) failure(error); }
    }
    function init() { send({ capabilities: SDK_CAPABILITIES, type: 'init', mode: invalid ? 'guest' : mode, scoring: !!(game?.leaderboard || previewManifest?.leaderboard), progress: !!game && mode === 'authenticated' && !invalid, ...(diagnose ? { diagnostics: true } : {}) }); }
    function ensurePlay(): Promise<string | null> {
      if (playPromise) return playPromise;
      if (mode !== 'authenticated' || !game || invalid) return Promise.resolve(null);
      playPromise = call<{ playId: string }>(`/games/${game.id}/plays`, { version: game.version, requestId: visitRequestId })
        .then(async (result) => {
          if (disposed) return null;
          playId = result.playId;
          setStatus(game.leaderboard ? '遊戲記錄已連線' : '已記錄遊玩；此遊戲尚未接入成績排行榜');
          setRetryable(false);
          await heartbeat();
          return playId;
        }).catch((error) => { playPromise = null; failure(error); throw error; });
      return playPromise;
    }
    loaded.current = () => {
      if (started || disposed) return;
      started = true;
      record('info', '遊戲入口已載入；等候 SDK 連線');
      if (diagnose && !sdkHello) diagnosticTimer = setTimeout(() => {
        if (disposed || sdkHello) return;
        setDiagnostics((current) => ({ ...current, state: 'timeout' }));
        record('error', '8 秒內未收到 SDK 連線，請確認遊戲載入 SDK');
      }, 8000);
      init();
      void ensurePlay().catch(() => {});
    };
    async function save(result: { runId: string; score: number }) {
      if (disposed || invalid) throw new Error('遊戲連線已失效');
      failed.set(result.runId, result);
      try {
        const response = await call(`/runs/${result.runId}/finish`, { score: result.score });
        if (!disposed) {
          failed.delete(result.runId);

          setRetryable(failed.size > 0);
          setStatus(failed.size ? '仍有成績尚未保存，請重試' : '成績已保存');
        }
        return response;
      } catch (error) {
        if (error instanceof ApiError && [400, 404, 409].includes(error.status)) failed.delete(result.runId);
        failure(error);
        throw error;
      }
    }
    const previewOperation = previewManifest ? createPreviewOperations(previewManifest, record) : null;
    const formalOperation = createFormalOperations({ game, active: () => !disposed && !invalid, call, ensurePlay, save,
      progressSaved: () => { if (!disposed && !game?.leaderboard && failed.size === 0) setStatus('進度已保存至帳號'); },
    });
    async function onMessage(event: MessageEvent) {
      if (disposed || event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      const hello = event.data;
      if (isHelloMessage(hello)) {
        if (diagnose && !sdkHello) {
          sdkHello = true;
          simulation = hello.diagnostics === true;
          clearTimeout(diagnosticTimer);
          setDiagnostics((current) => ({ ...current, state: 'connected', simulation }));
          record('success', simulation ? 'SDK 已連線；已啟用預覽模擬' : 'SDK 已連線；此 SDK 未支援預覽局次診斷，請更新 SDK');
        }
        if (started) { init(); void ensurePlay().catch(() => {}); }
        return;
      }
      if (!isRequestMessage(event.data) || event.data.connection !== connection || !started) {
        if (diagnose && hello?.protocol === 'playroom') record('error', '已拒絕不符合目前協定或連線的訊息');
        return;
      }
      const message = event.data;
      if (!diagnose && (mode !== 'authenticated' || invalid)) {
        send({ type: 'response', requestId: message.requestId, error: '請先登入後重新開啟遊戲', errorCode: 401, machineCode: 'AUTH_REQUIRED' });
        return;
      }
      try {
        const result = await operations.run(message, () => diagnose ? previewOperation!(message) : formalOperation(message));
        send({ type: 'response', requestId: message.requestId, result });
      } catch (error) {
        const text = error instanceof z.ZodError ? 'SDK 資料格式不正確' : (error as Error).message;
        if (diagnose) record('error', message.method + '：' + text);
        else failure(error);
        const failureData = error as Error & { status?: number; machineCode?: string };
        send({ type: 'response', requestId: message.requestId, error: text,
          ...(error instanceof ApiError ? { errorCode: error.status, machineCode: error.code ?? defaultErrorCode(error.status), details: error.details } : { errorCode: failureData.status, machineCode: failureData.machineCode ?? (error instanceof z.ZodError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR') }) });
      }
    }
    retry.current = () => {
      if (invalid || disposed) return;
      setRetryable(false);
      void (async () => {
        try {
          await ensurePlay();
          init();
          for (const result of failed.values()) await save(result);
        } catch (error) { failure(error); }
      })();
    };
    const visibility = () => { void heartbeat(); };
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus()) void heartbeat(true);
    }, 15000);
    window.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', visibility);
    window.addEventListener('blur', visibility);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(timer);
      clearTimeout(diagnosticTimer);
      window.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', visibility);
      window.removeEventListener('blur', visibility);
      loaded.current = () => {};
      retry.current = () => {};
    };
  }, [frame, url, game?.id, game?.version, identity, restart, previewManifest]);
  return { status, retryable, diagnostics, clearDiagnostics: () => setDiagnostics((current) => ({ ...current, events: [] })), onLoad: () => loaded.current(), retry: () => retry.current(), identity };
}
