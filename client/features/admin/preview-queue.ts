import { useEffect, useRef, useState } from 'react';
import type { StoredVersion } from '../../../shared/types';
import type { GameManifest } from '../../../shared/manifest';
import { api, ApiError, gameCommand } from '../../api';
import { errorAction } from '../../../shared/errors';
import { useCommandRecovery } from './command-recovery';
import { useNotice } from '../../environment/notices';

export type PreviewSelection = { gameId: string; version: string };
type Preview = PreviewSelection & { url: string; title: string; expiresAt: number; previewManifest: GameManifest };

// The queue lives with the admin workspace; closing an import dialog does not affect it.
export function usePreviewQueue(reload: () => Promise<void>) {
  const [previewQueue, setPreviewQueue] = useState<PreviewSelection[]>([]);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const notice = useNotice();
  const recoverCommand = useCommandRecovery();
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function showPreview(game: { id: string }, version: string, keepQueue = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (!keepQueue) setPreviewQueue([]);
    try {
      const { version: stored } = await api<{ version: StoredVersion }>(`/admin/games/${game.id}/versions/${version}`, undefined, { signal: controller.signal });
      const manifest = stored.manifest;
      const result = await gameCommand(game.id, 'preview', { version }, { signal: controller.signal });
      if (controller.signal.aborted) return false;
      setPreview({ ...result, gameId: game.id, version, title: `${manifest.name} · v${version}`, previewManifest: manifest });
      return true;
    } catch (e) {
      if (!controller.signal.aborted) { notice((e as Error).message, true); await recoverCommand(e); }
      return false;
    }
  }

  async function previewSequence(items: PreviewSelection[]) {
    const first = items[0];
    const game = first && { id: first.gameId };
    if (!game) return;
    if (await showPreview(game, first.version, true)) setPreviewQueue(items.slice(1));
  }

  async function approvePreview() {
    if (!preview) return;
    setReviewing(true);
    try {
      await gameCommand(preview.gameId, 'review', { version: preview.version, approved: true });
      if (request.current?.signal.aborted) return;
      await reload();
      const next = previewQueue[0];
      const game = next && { id: next.gameId };
      if (next && game) {
        if (await showPreview(game, next.version, true)) setPreviewQueue((items) => items.slice(1));
      } else { setPreview(null); setPreviewQueue([]); }
    } catch (e) {
      notice((e as Error).message, true); await recoverCommand(e);
      if (e instanceof ApiError && errorAction(e.code, e.status) === 'refresh-session') { setPreview(null); setPreviewQueue([]); }
    }
    finally { setReviewing(false); }
  }

  const closePreview = () => { if (!reviewing) { request.current?.abort(); setPreview(null); setPreviewQueue([]); } };
  return { preview, previewQueue, previewExpanded, setPreviewExpanded, reviewing, showPreview, previewSequence, approvePreview, closePreview };
}
