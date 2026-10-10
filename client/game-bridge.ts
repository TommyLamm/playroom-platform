import { useEffect, useRef, useState, type RefObject } from 'react';
import { z } from 'zod';
import type { PublicGame } from '../shared/types';
import type { Session } from '../shared/account';
import type { GameManifest } from '../shared/manifest';
import { api, ApiError } from './api';
import { saveProgressInput, type ProgressSave } from '../shared/cloud-save';

export type SdkDiagnosticEvent = { id: number; at: number; kind: 'info' | 'success' | 'error'; text: string };
export type SdkDiagnostics = { state: 'waiting' | 'connected' | 'timeout'; simulation: boolean; events: SdkDiagnosticEvent[] };

const messageSchema = z.object({
  protocol: z.literal('playroom'), version: z.literal(1), type: z.literal('request'),
  connection: z.string().uuid(), requestId: z.string().uuid(),
  method: z.enum(['startRun', 'finishRun', 'loadProgress', 'saveProgress']), payload: z.unknown(),
}).strict();

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
    const previewScores = new Map<string, number>();
    let previewSave: ProgressSave | null = null;
    let sdkHello = false;
    let simulation = false;
    let eventId = 0;
    let diagnosticTimer: ReturnType<typeof setTimeout> | undefined;
    const record = (kind: SdkDiagnosticEvent['kind'], text: string) => {
      if (!diagnose || disposed) return;
      const entry = { id: ++eventId, at: Date.now(), kind, text };
      setDiagnostics((current) => ({ ...current, events: [...current.events.slice(-79), entry] }));
    };
    const runIds = new Set<string>();
    const operations = new Map<string, Promise<unknown>>();
    const failed = new Map<string, { runId: string; score: number }>();
    const finished = new Set<string>();
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
    function init() { send({ type: 'init', mode: invalid ? 'guest' : mode, scoring: !!(game?.leaderboard || previewManifest?.leaderboard), progress: !!game && mode === 'authenticated' && !invalid, ...(diagnose ? { diagnostics: true } : {}) }); }
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
          finished.add(result.runId);
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
    async function onMessage(event: MessageEvent) {
      if (disposed || event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      const hello = event.data;
      if (hello?.protocol === 'playroom' && hello.version === 1 && hello.type === 'hello') {
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
      const parsed = messageSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.connection !== connection || !started) {
        if (diagnose && hello?.protocol === 'playroom') record('error', '已拒絕不符合目前協定或連線的訊息');
        return;
      }
      const message = parsed.data;
      if (diagnose) {
        let operation = operations.get(message.requestId);
        if (!operation) {
          if (operations.size >= 1000) { record('error', '預覽診斷已達上限，請重新開始'); send({ type: 'response', requestId: message.requestId, error: '請重新開始預覽' }); return; }
          operation = (async () => {
            if (message.method === 'loadProgress') {
              z.object({}).strict().parse(message.payload);
              record('info', 'loadProgress：只讀取此預覽的暫存進度');
              return previewSave;
            }
            if (message.method === 'saveProgress') {
              const input = saveProgressInput.parse(message.payload);
              if (input.revision !== (previewSave?.revision ?? 0)) throw new Error('預覽進度版本衝突，請重新讀取');
              previewSave = { ...input, revision: input.revision + 1, gameVersion: previewManifest.version, updatedAt: new Date().toISOString() };
              record('success', 'saveProgress：驗證通過；只暫存於預覽，不保存帳號進度');
              return null;
            }
            if (message.method === 'startRun') {
              z.object({}).strict().parse(message.payload);
              record('info', 'startRun：收到開始一局');
              if (!previewManifest.leaderboard) throw new Error('Manifest 未設定 leaderboard，無法模擬成績');
              const runId = crypto.randomUUID();
              runIds.add(runId);
              record('success', 'startRun：已建立模擬局次，不保存');
              return { runId };
            }
            record('info', 'finishRun：收到完成一局');
            const result = z.object({ runId: z.string().uuid(), score: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict().parse(message.payload);
            if (!runIds.has(result.runId)) throw new Error('局次不屬於目前的預覽連線');
            const board = previewManifest.leaderboard;
            if (!board || result.score < board.minScore || result.score > board.maxScore) throw new Error('分數超出 Manifest 設定範圍');
            const previous = previewScores.get(result.runId);
            if (previous !== undefined && previous !== result.score) throw new Error('已完成的模擬局次不可覆寫分數');
            previewScores.set(result.runId, result.score);
            record('success', `finishRun：${result.score} ${board.unit}，${previous === undefined ? '驗證通過' : '重複提交已忽略'}；預覽不保存`);
            return null;
          })();
          operations.set(message.requestId, operation);
        }
        try { send({ type: 'response', requestId: message.requestId, result: await operation }); }
        catch (error) {
          operations.delete(message.requestId);
          const text = error instanceof z.ZodError ? 'SDK 資料格式不正確' : (error as Error).message;
          record('error', `${message.method}：${text}`);
          send({ type: 'response', requestId: message.requestId, error: text });
        }
        return;
      }
      if (mode !== 'authenticated' || invalid) {
        send({ type: 'response', requestId: message.requestId, error: '請先登入後重新開啟遊戲' });
        return;
      }
      let operation = operations.get(message.requestId);
      if (!operation) {
        if (operations.size >= 1000) { send({ type: 'response', requestId: message.requestId, error: '請重新開啟遊戲以繼續保存' }); return; }
        operation = (async () => {
          if (message.method === 'loadProgress' || message.method === 'saveProgress') {
            if (!game || disposed || invalid) throw new Error('遊戲連線已失效');
            if (message.method === 'loadProgress') {
              z.object({}).strict().parse(message.payload);
              return call(`/games/${game.id}/save`);
            }
            const input = saveProgressInput.parse(message.payload);
            const result = await call(`/games/${game.id}/save`, { ...input, version: game.version, requestId: message.requestId });
            // Score retries have their own toolbar state; progress must not hide an unsaved run.
            if (!disposed && !game.leaderboard && failed.size === 0) setStatus('進度已保存至帳號');
            return result;
          }
          const id = await ensurePlay();
          if (!id || disposed || invalid) throw new Error('遊戲連線已失效');
          if (message.method === 'startRun') {
            z.object({}).strict().parse(message.payload);
            const result = await call<{ runId: string }>(`/plays/${id}/runs`, { requestId: message.requestId });
            if (disposed) throw new Error('遊戲連線已失效');
            runIds.add(result.runId);
            return result;
          }
          const result = z.object({ runId: z.string().uuid(), score: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict().parse(message.payload);
          if (!runIds.has(result.runId)) throw new Error('此局次不屬於目前的遊戲連線');
          if (finished.has(result.runId)) return call(`/runs/${result.runId}/finish`, { score: result.score });
          return save(result);
        })();
        operations.set(message.requestId, operation);
      }
      try { send({ type: 'response', requestId: message.requestId, result: await operation }); }
      catch (error) {
        operations.delete(message.requestId);
        failure(error);
        send({ type: 'response', requestId: message.requestId, error: error instanceof z.ZodError ? 'SDK 資料格式不正確' : (error as Error).message, ...(error instanceof ApiError ? { errorCode: error.status } : {}) });
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
