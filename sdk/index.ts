import { SDK_VERSION, PROTOCOL_VERSION } from '../shared/versions.js';
import { isInitMessage, isResponseMessage, negotiatedCapabilities, SDK_CAPABILITIES, type SdkMethod } from '../shared/protocol.js';

export type ProgressSave = { data: Record<string, unknown>; revision: number; formatVersion: number; gameVersion: string; updatedAt: string };
export type ReadyState = { available: boolean; progressAvailable: boolean; mode: 'authenticated' | 'guest' | 'preview' | 'standalone'; sdkVersion: string; protocolVersion: number; capabilities: string[] };
export type PlayroomError = Error & { code?: number; machineCode?: string; details?: Record<string, string | number | boolean | null> };
type Pending = { resolve(value: unknown): void; reject(error: PlayroomError): void; timer: ReturnType<typeof setTimeout> };
const pending = new Map<string, Pending>();
let connection: string | null = null;
let parentOrigin: string | null = null;
let mode: ReadyState['mode'] = 'standalone';
let features: string[] = [];
let resolveReady!: (state: ReadyState) => void;
const readiness = new Promise<ReadyState>((resolve) => { resolveReady = resolve; });
const state = (): ReadyState => ({ available: mode === 'authenticated' && features.includes('scoring'), progressAvailable: mode === 'authenticated' && features.includes('progress'), mode, sdkVersion: SDK_VERSION, protocolVersion: PROTOCOL_VERSION, capabilities: [...features] });
const timeout = setTimeout(() => resolveReady(state()), 8000);
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.source === window) return;
  const data: unknown = event.data;
  if (isInitMessage(data) && !connection) {
    parentOrigin = event.origin;
    connection = data.connection;
    mode = data.mode;
    features = negotiatedCapabilities(data);
    clearTimeout(timeout);
    resolveReady(state());
    return;
  }
  if (event.origin !== parentOrigin || !isResponseMessage(data) || data.connection !== connection) return;
  const request = pending.get(data.requestId);
  if (!request) return;
  pending.delete(data.requestId);
  clearTimeout(request.timer);
  if (data.error) request.reject(Object.assign(new Error(data.error), { code: data.errorCode, machineCode: data.machineCode, details: data.details }));
  else request.resolve(data.result);
});
if (window.parent !== window) window.parent.postMessage({ protocol: 'playroom', version: PROTOCOL_VERSION, type: 'hello', diagnostics: true, sdkVersion: SDK_VERSION, capabilities: [...SDK_CAPABILITIES] }, '*');

async function request<T>(method: SdkMethod, payload: unknown, requestId: string = crypto.randomUUID()): Promise<T | null> {
  await readiness;
  const progress = method === 'loadProgress' || method === 'saveProgress';
  const diagnostic = features.includes('diagnostics');
  if (!connection || (mode !== 'authenticated' && !diagnostic) || (!features.includes(progress ? 'progress' : 'scoring') && !diagnostic)) return null;
  if (pending.has(requestId)) throw Object.assign(new Error('此保存請求仍在處理中'), { machineCode: 'REQUEST_IN_FLIGHT' });
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(Object.assign(new Error('平台回應逾時，請在平台工具列確認保存狀態'), { machineCode: 'REQUEST_TIMEOUT' }));
    }, 15000);
    pending.set(requestId, { resolve: (value) => resolve(value as T), reject, timer });
    window.parent.postMessage({ protocol: 'playroom', version: PROTOCOL_VERSION, type: 'request', connection, requestId, method, payload }, parentOrigin!);
  });
}

export const Playroom = {
  ready: (): Promise<ReadyState> => readiness,
  /** null means unavailable or no save. SAVE_FORMAT_INCOMPATIBLE rejects unsupported formats; never initialize empty progress after a rejected read. */
  loadProgress: (): Promise<ProgressSave | null> => request('loadProgress', {}),
  /** Use the Manifest writeFormat and validate/migrate data. Reuse requestId only for identical retries; only saved:true proves persistence. */
  saveProgress: async ({ data, revision, formatVersion, requestId = crypto.randomUUID() }: { data: Record<string, unknown>; revision: number; formatVersion: number; requestId?: string }): Promise<({ saved: true } & ProgressSave) | null> => {
    const result = await request<{ saved: true } & ProgressSave>('saveProgress', { data, revision, formatVersion }, requestId);
    return mode === 'preview' ? null : result;
  },
  /** Diagnostic previews return temporary run IDs; no account run is created. */
  startRun: (): Promise<{ runId: string } | null> => request('startRun', {}),
  finishRun: async ({ runId, score }: { runId: string; score: number }): Promise<{ saved: true; runId: string; score: number; finishedAt: string } | null> => {
    const result = await request<{ saved: true; runId: string; score: number; finishedAt: string }>('finishRun', { runId, score });
    return mode === 'preview' ? null : result;
  },
};
