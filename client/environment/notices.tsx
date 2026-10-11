import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Check, CircleAlert, X } from 'lucide-react';


export const NoticeContext = createContext<(message: string, error?: boolean) => void>(() => {});
export function useNotice() {
  return useContext(NoticeContext);
}

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [notice]);

  return <NoticeContext.Provider value={(message, error = false) => setNotice({ message, error })}>
    {children}
{notice && (
            <div
              className={`toast ${notice.error ? 'error' : ''}`}
              role={notice.error ? 'alert' : 'status'}
            >
              {notice.error ? <CircleAlert size={18} /> : <Check size={18} />}
              <span>{notice.message}</span>
              <button className="icon-button" title="關閉通知" onClick={() => setNotice(null)}>
                <X size={16} />
              </button>
            </div>
          )}

  </NoticeContext.Provider>;
}
