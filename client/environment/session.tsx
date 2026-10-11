import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '../../shared/account';
import { api, setCsrf } from '../api';


export const SessionContext = createContext<{ session: Session | null; refresh: () => Promise<void> }>({
  session: null,
  refresh: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
const [session, setSession] = useState<Session | null>(null);
  const refresh = useCallback(async () => {
    const data = await api<Session>('/session');
    setCsrf(data.authenticated ? data.csrf : '');
    setSession(data);
  }, []);
  useEffect(() => {
    void refresh().catch(() => setSession({ authenticated: false }));
  }, [refresh]);

  return <SessionContext.Provider value={{ session, refresh }}>{children}</SessionContext.Provider>;
}
