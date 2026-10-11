import { PROTOCOL_VERSION } from './versions.js';

export const SDK_METHODS = ['startRun', 'finishRun', 'loadProgress', 'saveProgress'] as const;
export const SDK_CAPABILITIES = ['scoring', 'progress', 'diagnostics', 'saveFormats', 'machineErrors'] as const;
export type SdkMethod = typeof SDK_METHODS[number];
export type SdkCapability = typeof SDK_CAPABILITIES[number];
export type SdkMode = 'authenticated' | 'guest' | 'preview';
export type ProtocolEnvelope = { protocol: 'playroom'; version: 1 };
export type HelloMessage = ProtocolEnvelope & { type: 'hello'; diagnostics?: boolean; sdkVersion?: string; capabilities?: string[] };
export type InitMessage = ProtocolEnvelope & { type: 'init'; connection: string; mode: SdkMode; scoring: boolean; progress?: boolean; diagnostics?: boolean; capabilities?: string[] };
export type RequestMessage = ProtocolEnvelope & { type: 'request'; connection: string; requestId: string; method: SdkMethod; payload: unknown };
export type ResponseMessage = ProtocolEnvelope & { type: 'response'; connection: string; requestId: string; result?: unknown; error?: string; errorCode?: number; machineCode?: string; details?: Record<string, string | number | boolean | null> };

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function envelope(value: unknown): value is Record<string, unknown> {
  return object(value) && value.protocol === 'playroom' && value.version === PROTOCOL_VERSION;
}
function capabilities(value: unknown) { return value === undefined || (Array.isArray(value) && value.length <= 32 && value.every((v) => typeof v === 'string' && v.length <= 64)); }
export function isHelloMessage(value: unknown): value is HelloMessage {
  return envelope(value) && value.type === 'hello' && (value.diagnostics === undefined || typeof value.diagnostics === 'boolean') && (value.sdkVersion === undefined || typeof value.sdkVersion === 'string') && capabilities(value.capabilities);
}
export function isInitMessage(value: unknown): value is InitMessage {
  return envelope(value) && value.type === 'init' && isUuid(value.connection) && ['authenticated', 'guest', 'preview'].includes(String(value.mode)) && typeof value.scoring === 'boolean' && (value.progress === undefined || typeof value.progress === 'boolean') && (value.diagnostics === undefined || typeof value.diagnostics === 'boolean') && capabilities(value.capabilities);
}
export function isRequestMessage(value: unknown): value is RequestMessage {
  return envelope(value) && value.type === 'request' && isUuid(value.connection) && isUuid(value.requestId) && SDK_METHODS.includes(value.method as SdkMethod) && Object.hasOwn(value, 'payload') && Object.keys(value).every((key) => ['protocol', 'version', 'type', 'connection', 'requestId', 'method', 'payload'].includes(key));
}
export function isResponseMessage(value: unknown): value is ResponseMessage {
  return envelope(value) && value.type === 'response' && isUuid(value.connection) && isUuid(value.requestId) && (value.error === undefined || typeof value.error === 'string') && (value.errorCode === undefined || (Number.isInteger(value.errorCode) && typeof value.errorCode === 'number')) && (value.machineCode === undefined || typeof value.machineCode === 'string') && (value.details === undefined || (object(value.details) && Object.keys(value.details).length <= 32 && Object.values(value.details).every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))));
}

/** Missing capabilities means a v1 host; preserve its boolean feature flags. */
export function negotiatedCapabilities(init: InitMessage): string[] {
  const supported = init.capabilities;
  return [
    ...(init.scoring && (!supported || supported.includes('scoring')) ? ['scoring'] : []),
    ...(init.progress && (!supported || supported.includes('progress')) ? ['progress'] : []),
    ...(init.mode === 'preview' && init.diagnostics && (!supported || supported.includes('diagnostics')) ? ['diagnostics'] : []),
    ...(supported?.includes('saveFormats') ? ['saveFormats'] : []),
    ...(supported?.includes('machineErrors') ? ['machineErrors'] : []),
  ];
}
