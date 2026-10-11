import type { RequestMessage } from '../../shared/protocol';

/** Request identity binds method and canonical payload, including after a failed call. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'undefined';
}
export function createOperationRegistry(limit = 1000) {
  const operations = new Map<string, { fingerprint: string; promise?: Promise<unknown> }>();
  return {
    run(message: RequestMessage, perform: () => Promise<unknown>) {
      const fingerprint = message.method + ':' + canonical(message.payload);
      let operation = operations.get(message.requestId);
      if (operation && operation.fingerprint !== fingerprint) return Promise.reject(Object.assign(new Error('requestId 已用於不同請求'), { machineCode: 'REQUEST_ID_REUSED', status: 409 }));
      if (operation?.promise) return operation.promise;
      if (!operation) {
        if (operations.size >= limit) return Promise.reject(Object.assign(new Error('請重新開啟遊戲以繼續保存'), { machineCode: 'CAPABILITY_UNAVAILABLE' }));
        operation = { fingerprint }; operations.set(message.requestId, operation);
      }
      const entry = operation;
      entry.promise = Promise.resolve().then(perform).catch((error) => { entry.promise = undefined; throw error; });
      return entry.promise;
    },
  };
}
