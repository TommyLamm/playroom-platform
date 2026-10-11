import { safeErrorDetails, type ErrorDetails } from '../shared/errors';
import type { CommandInput, CommandResponses } from '../shared/commands';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: ErrorDetails,
  ) {
    super(message);
  }
}
let csrf = '';
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T>(url: string, body?: unknown, options: { signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(`/api/v1${url}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options.signal,
  });
  const value = await response.json().catch(() => ({ error: '無法讀取伺服器回應' }));
  if (!response.ok) throw new ApiError(response.status, typeof value?.error === 'string' ? value.error : '操作失敗',
    typeof value?.code === 'string' ? value.code : undefined, safeErrorDetails(value?.details));
  return value as T;
}

export function gameCommand<K extends 'publish' | 'unpublish' | 'review' | 'preview'>(id: string, operation: K, input: CommandInput<K>, options: { signal?: AbortSignal } = {}): Promise<CommandResponses[K]> {
  return api(`/admin/games/${encodeURIComponent(id)}/${operation}`, input, options);
}
export function publishBatch(input: CommandInput<'publishBatch'>): Promise<CommandResponses['publishBatch']> {
  return api('/admin/publish-batches', input);
}
export function changeRole(id: number, input: CommandInput<'roleChange'>): Promise<CommandResponses['roleChange']> {
  return api(`/admin/accounts/${id}/role`, input);
}
