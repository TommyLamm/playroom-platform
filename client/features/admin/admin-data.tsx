import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../../api';
import { SessionContext } from '../../environment/session';
import { hasPermission } from '../../../shared/account';

const RefreshContext = createContext({ revision: 0, invalidate: async () => {} });
export function AdminDataProvider({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  const invalidate = useCallback(async () => { setRevision((value) => value + 1); }, []);
  return <RefreshContext.Provider value={{ revision, invalidate }}>{children}</RefreshContext.Provider>;
}
export const useAdminRefresh = () => useContext(RefreshContext).invalidate;

// Only pending promises are shared. Resolved data stays in the permission-scoped component.
const requests = new Map<string, { controller: AbortController; promise: Promise<unknown>; users: number }>();
function acquire<T>(key: string, url: string, body?: unknown) {
  let entry = requests.get(key);
  if (!entry) {
    const controller = new AbortController();
    const promise = api<T>(url, body, { signal: controller.signal });
    entry = { controller, promise, users: 0 };
    requests.set(key, entry);
    const captured = entry;
    void promise.finally(() => { if (requests.get(key) === captured) requests.delete(key); }).catch(() => {});
  }
  entry.users++;
  const captured = entry;
  let released = false;
  return { promise: entry.promise as Promise<T>, release: () => { if (released) return; released = true; if (--captured.users === 0) { captured.controller.abort(); if (requests.get(key) === captured) requests.delete(key); } } };
}

export function queryString(values: Record<string, string | number | undefined>) {
  return new URLSearchParams(Object.entries(values).filter((entry): entry is [string, string | number] => entry[1] !== undefined).map(([key, value]) => [key, String(value)])).toString();
}

export function useAdminRead<T>(url: string | null, active = true, pollMs = 0, body?: unknown) {
  const { session, refresh } = useContext(SessionContext);
  const permitted = !!session?.authenticated && hasPermission(session.role, 'games.manage');
  const scope = session?.authenticated ? `${session.username}:${session.role}:${session.csrf}` : 'guest';
  const { revision } = useContext(RefreshContext);
  const [localRevision, setLocalRevision] = useState(0);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const identity = useRef('');
  const bodyKey = JSON.stringify(body);
  const reload = useCallback(() => setLocalRevision((value) => value + 1), []);
  useEffect(() => {
    if (!permitted) { setData(null); setError(''); setLoading(false); return; }
    if (!url) { setData(null); setError(''); setLoading(false); return; }
    if (!active) return;
    const requestIdentity = `${scope}:${url}:${bodyKey || ''}`;
    if (identity.current !== requestIdentity) { setData(null); identity.current = requestIdentity; }
    let alive = true, pending = false;
    let release: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (!alive || pending || document.hidden) return;
      pending = true;
      setLoading(true);
      const request = acquire<T>(`${requestIdentity}:${revision}:${localRevision}`, url, bodyKey ? JSON.parse(bodyKey) : undefined);
      release = request.release;
      try {
        const next = await request.promise;
        if (alive) { setData(next); setError(''); }
      } catch (e) {
        if (alive) {
          if (e instanceof ApiError && [401, 403].includes(e.status)) { setData(null); await refresh().catch(() => {}); }
          else setError((e as Error).message);
        }
      } finally {
        request.release(); release = undefined; pending = false;
        if (alive) { setLoading(false); if (pollMs) timer = setTimeout(() => void run(), pollMs); }
      }
    };
    const visible = () => { if (!document.hidden) { clearTimeout(timer); void run(); } };
    document.addEventListener('visibilitychange', visible);
    void run();
    return () => { alive = false; clearTimeout(timer); release?.(); document.removeEventListener('visibilitychange', visible); };
  }, [url, active, permitted, scope, revision, localRevision, pollMs, refresh, bodyKey]);
  return { data, error, loading, reload };
}
