export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let csrf = '';
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${url}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({ error: '無法讀取伺服器回應' }));
  if (!response.ok) throw new ApiError(response.status, value.error || '操作失敗');
  return value as T;
}
