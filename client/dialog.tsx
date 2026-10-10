import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { lockScroll } from './scroll-lock';

export function Dialog({ title, children, onClose, wide = false, drawer = false, closeDisabled = false, dismissOnEscape = true }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean; drawer?: boolean; closeDisabled?: boolean; dismissOnEscape?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseScroll = lockScroll(document.body);
    dialog?.showModal();
    return () => { dialog?.close(); releaseScroll(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className={`dialog ${wide ? 'wide' : ''} ${drawer ? 'drawer' : ''}`} aria-label={title}
    onCancel={(e) => { e.preventDefault(); if (dismissOnEscape && !closeDisabled) onClose(); }} onClick={(e) => { if (e.target === ref.current && !closeDisabled) onClose(); }}>
    <div className="dialog-heading"><h2>{title}</h2><button className="icon-button" title="關閉" disabled={closeDisabled} onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>;
}
