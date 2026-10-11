// Copy this ES module into your game ZIP and import it with a relative path.
// No platform credentials are sent to games. Network failures must not block play.
const pending = new Map();
let connection = null;
let parentOrigin = null;
let mode = 'standalone';
let scoring = false;
let progress = false;
let diagnostics = false;
let resolveReady;
const readiness = new Promise((resolve) => { resolveReady = resolve; });
const timeout = setTimeout(() => resolveReady({ available: false, progressAvailable: false, mode }), 8000);
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.source === window) return;
  const data = event.data;
  if (!data || data.protocol !== 'playroom' || data.version !== 1) return;
  if (data.type === 'init' && !connection && typeof data.connection === 'string' &&
      ['authenticated', 'guest', 'preview'].includes(data.mode)) {
    parentOrigin = event.origin;
    connection = data.connection;
    mode = data.mode;
    scoring = data.scoring === true;
    progress = data.progress === true;
    diagnostics = mode === 'preview' && data.diagnostics === true;
    clearTimeout(timeout);
    resolveReady({ available: mode === 'authenticated' && scoring, progressAvailable: mode === 'authenticated' && progress, mode });
    return;
  }
  if (event.origin !== parentOrigin || data.connection !== connection || data.type !== 'response') return;
  const request = pending.get(data.requestId);
  if (!request) return;
  pending.delete(data.requestId);
  clearTimeout(request.timer);
  if (data.error) request.reject(Object.assign(new Error(data.error), { code: data.errorCode }));
  else request.resolve(data.result);
});
if (window.parent !== window) window.parent.postMessage({ protocol: 'playroom', version: 1, type: 'hello', diagnostics: true }, '*');

async function request(method, payload, requestId = crypto.randomUUID()) {
  await readiness;
  // Diagnostic preview issues ephemeral runs, while ready().available stays false.
  // A simulated finish always resolves null: it never represents a saved result.
  const isProgress = method === 'loadProgress' || method === 'saveProgress';
  if (!connection || (mode !== 'authenticated' && !diagnostics) || (!(isProgress ? progress : scoring) && !diagnostics)) return null;
  if (pending.has(requestId)) throw new Error('此保存請求仍在處理中');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('平台回應逾時，請在平台工具列確認保存狀態'));
    }, 15000);
    pending.set(requestId, { resolve, reject, timer });
    window.parent.postMessage({ protocol: 'playroom', version: 1, type: 'request', connection, requestId, method, payload }, parentOrigin);
  });
}
export const Playroom = {
  // available controls account-save UI; still call start/finish in diagnostic preview.
  ready: () => readiness,
  loadProgress: () => request('loadProgress', {}),
  // Reuse requestId when retrying the same snapshot after a timeout/network failure.
  saveProgress: async ({ data, revision, formatVersion, requestId = crypto.randomUUID() }) => {
    const result = await request('saveProgress', { data, revision, formatVersion }, requestId);
    return mode === 'preview' ? null : result;
  },
  // Returns {runId} or null. Preview diagnostic IDs are temporary, never account runs.
  startRun: () => request('startRun', {}),
  // Only {saved:true} proves a save. Null is unsaved; errors reject the Promise.
  finishRun: async ({ runId, score }) => {
    const result = await request('finishRun', { runId, score });
    return mode === 'preview' ? null : result;
  },
};
