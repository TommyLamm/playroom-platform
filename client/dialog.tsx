import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Dialog({ title, children, onClose, wide = false, drawer = false, closeDisabled = false }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean; drawer?: boolean; closeDisabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className={`dialog ${wide ? 'wide' : ''} ${drawer ? 'drawer' : ''}`} aria-label={title}
    onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
    <div className="dialog-heading"><h2>{title}</h2><button className="icon-button" title="關閉" disabled={closeDisabled} onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>;
}
