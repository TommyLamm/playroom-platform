export const ERROR_CODES = [
  'STATE_CONFLICT', 'SAVE_REVISION_CONFLICT', 'REQUEST_ID_REUSED',
  'SAVE_FORMAT_INCOMPATIBLE', 'CAPABILITY_UNAVAILABLE', 'AUTH_REQUIRED',
  'PERMISSION_DENIED', 'RATE_LIMITED', 'VALIDATION_ERROR', 'NOT_FOUND',
  'INTERNAL_ERROR', 'REQUEST_TIMEOUT', 'REQUEST_IN_FLIGHT', 'CONNECTION_INVALID',
  'REVIEW_REQUIRED', 'VERSION_NOT_NEWER', 'LAST_ADMIN_REQUIRED', 'ORIGIN_REJECTED', 'CSRF_INVALID',
] as const;
export type ErrorCode = typeof ERROR_CODES[number];
export type ErrorDetails = Record<string, string | number | boolean | null>;
export type ErrorResponse = { error: string; code: ErrorCode; details?: ErrorDetails };

// Older servers may omit code. Never classify a generic 409 as a save conflict.
export function errorAction(code?: string, status?: number): 'refresh-state' | 'refresh-session' | 'wait' | 'stop' {
  if (['AUTH_REQUIRED', 'PERMISSION_DENIED', 'CSRF_INVALID'].includes(code || '') || status === 401 || status === 403 && !code)
    return 'refresh-session';
  if (['STATE_CONFLICT', 'REVIEW_REQUIRED', 'VERSION_NOT_NEWER', 'SAVE_REVISION_CONFLICT'].includes(code || '')) return 'refresh-state';
  if (code === 'RATE_LIMITED' || status === 429) return 'wait';
  return 'stop';
}

export function safeErrorDetails(value: unknown): ErrorDetails | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > 32 || entries.some(([, v]) => v !== null && typeof v !== 'string' && typeof v !== 'boolean' && !(typeof v === 'number' && Number.isFinite(v)))) return undefined;
  return Object.fromEntries(entries) as ErrorDetails;
}

export function defaultErrorCode(status: number): ErrorCode {
  return status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'PERMISSION_DENIED'
    : status === 404 ? 'NOT_FOUND' : status === 409 ? 'STATE_CONFLICT'
    : status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR';
}
