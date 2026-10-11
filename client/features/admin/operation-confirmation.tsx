import { useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { Dialog } from '../../dialog';
import { useNotice } from '../../environment/notices';
import { ApiError } from '../../api';
import { errorAction } from '../../../shared/errors';

type Confirmation = { title: string; text: string; action: () => Promise<void> };

export function useOperationConfirmation() {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  return { confirmation, requestConfirmation: setConfirmation };
}

export function OperationConfirmation({ confirmation, onClose }: { confirmation: Confirmation; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const notice = useNotice();
  return <Dialog title={confirmation.title} closeDisabled={busy} onClose={() => { if (!busy) onClose(); }}>
    <p className="confirm-text">{confirmation.text}</p>
    <div className="dialog-actions">
      <button className="button" disabled={busy} onClick={onClose}>取消</button>
      <button className="button primary" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await confirmation.action(); onClose(); }
        catch (e) {
          notice((e as Error).message, true);
          if (e instanceof ApiError && errorAction(e.code, e.status) !== 'wait') onClose();
        }
        finally { setBusy(false); }
      }}>{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}確認</button>
    </div>
  </Dialog>;
}
