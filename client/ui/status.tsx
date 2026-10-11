import { type ReactNode } from 'react';
import { CircleAlert, Gamepad2, LoaderCircle, RefreshCw } from 'lucide-react';


export function Spinner({ text = '載入中' }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{text}</span>
    </div>
  );
}
export function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <Gamepad2 size={40} />
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function ErrorMessage({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <CircleAlert size={19} />
      <span>{message}</span>
      {retry && (
        <button className="button small" onClick={retry}>
          <RefreshCw size={14} />
          重試
        </button>
      )}
    </div>
  );
}
