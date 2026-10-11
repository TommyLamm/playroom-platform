import { useContext } from 'react';
import { errorAction } from '../../../shared/errors';
import { ApiError } from '../../api';
import { SessionContext } from '../../environment/session';
import { useAdminRefresh } from './admin-data';

export function useCommandRecovery() {
  const { refresh } = useContext(SessionContext);
  const reload = useAdminRefresh();
  return async (error: unknown) => {
    if (!(error instanceof ApiError)) return;
    const action = errorAction(error.code, error.status);
    // Refresh is for a new human decision; never resubmit the failed command.
    if (action === 'refresh-session') await refresh().catch(() => {});
    if (action === 'refresh-state') await reload().catch(() => {});
  };
}
