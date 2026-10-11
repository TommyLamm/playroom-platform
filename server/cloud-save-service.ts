import type { Store } from './db.js';
import { AppError } from './errors.js';
import type { z } from 'zod';
import { saveProgressRequest, restoreProgressRequest, MAX_SAVE_SNAPSHOTS, type ProgressSave, type SaveSnapshotList } from '../shared/cloud-save.js';
import { assertReadableFormat } from './save-compatibility.js';
import { requirePublicGame, publishedManifest } from './game-catalog.js';

type Row = { data: string; revision: number; format_version: number; game_version: string; updated_at: string; request_id: string; source_snapshot_id: number | null };

export function createCloudSaveService(store: Store) {
  const sql = store.sqlite;
  const manifest = (id: string, version?: string) => publishedManifest(store, id, version);
  const read = (user: number, id: string) => sql.prepare('SELECT * FROM cloud_saves WHERE user_id=? AND game_id=?').get(user, id) as Row | undefined;
  const view = (row: Row): ProgressSave => ({ data: JSON.parse(row.data), revision: row.revision, formatVersion: row.format_version, gameVersion: row.game_version, updatedAt: row.updated_at });
  function snapshot(user: number, id: string, row: Row, reason: 'migration' | 'restore') {
    sql.prepare(`INSERT INTO cloud_save_snapshots (user_id,game_id,data,revision,format_version,game_version,updated_at,request_id,captured_at,reason)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(user, id, row.data, row.revision, row.format_version, row.game_version, row.updated_at, row.request_id, new Date().toISOString(), reason);
    sql.prepare(`DELETE FROM cloud_save_snapshots WHERE user_id=? AND game_id=? AND id NOT IN
      (SELECT id FROM cloud_save_snapshots WHERE user_id=? AND game_id=? ORDER BY id DESC LIMIT ?)`).run(user, id, user, id, MAX_SAVE_SNAPSHOTS);
  }
  function conflict() { throw new AppError(409, '另一台設備已更新進度，請重新讀取存檔後再保存', 'SAVE_REVISION_CONFLICT'); }
  function reused() { throw new AppError(409, '存檔請求識別已被使用', 'REQUEST_ID_REUSED'); }

  return {
    requireAvailable: (id: string) => requirePublicGame(store, id),
    load(user: number, id: string, version?: string) {
      requirePublicGame(store, id);
      const target = manifest(id, version), row = read(user, id);
      if (row) assertReadableFormat(target, row.format_version);
      return row ? view(row) : null;
    },
    save(user: number, id: string, input: z.infer<typeof saveProgressRequest>) {
      requirePublicGame(store, id);
      const target = manifest(id, input.version);
      const data = JSON.stringify(input.data);
      return sql.transaction(() => {
        const previous = read(user, id);
        if (previous?.request_id === input.requestId) {
          if (previous.source_snapshot_id !== null || previous.data !== data || previous.format_version !== input.formatVersion || previous.game_version !== input.version || previous.revision !== input.revision + 1) reused();
          return { saved: true, ...view(previous) };
        }
        if (previous) assertReadableFormat(target, previous.format_version);
        if (target.cloudSave && target.cloudSave.writeFormat !== input.formatVersion)
          throw new AppError(409, '寫入格式與此版本 Manifest 宣告不符', 'SAVE_FORMAT_INCOMPATIBLE');
        // A still-open historical tab must not create a format the active release cannot read.
        assertReadableFormat(manifest(id), input.formatVersion);
        if ((previous?.revision ?? 0) !== input.revision) conflict();
        if (previous && previous.format_version !== input.formatVersion) snapshot(user, id, previous, 'migration');
        const updatedAt = new Date().toISOString();
        sql.prepare(`INSERT INTO cloud_saves (user_id,game_id,data,revision,format_version,game_version,updated_at,request_id)
          VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,game_id) DO UPDATE SET
          data=excluded.data,revision=excluded.revision,format_version=excluded.format_version,
          game_version=excluded.game_version,updated_at=excluded.updated_at,request_id=excluded.request_id,source_snapshot_id=NULL`)
          .run(user, id, data, input.revision + 1, input.formatVersion, input.version, updatedAt, input.requestId);
        return { saved: true, ...view(read(user, id)!) };
      })();
    },
    snapshots(user: number, id: string): SaveSnapshotList {
      requirePublicGame(store, id);
      return { revision: read(user, id)?.revision ?? 0,
        snapshots: sql.prepare(`SELECT id,revision,format_version AS formatVersion,game_version AS gameVersion,
          updated_at AS updatedAt,captured_at AS capturedAt,reason FROM cloud_save_snapshots WHERE user_id=? AND game_id=? ORDER BY id DESC`).all(user, id) as SaveSnapshotList['snapshots'] };
    },
    restore(user: number, id: string, input: z.infer<typeof restoreProgressRequest>) {
      requirePublicGame(store, id);
      return sql.transaction(() => {
        const previous = read(user, id);
        if (previous?.request_id === input.requestId) {
          if (previous.source_snapshot_id !== input.snapshotId || previous.revision !== input.revision + 1) reused();
          return { saved: true, ...view(previous) };
        }
        if ((previous?.revision ?? 0) !== input.revision) conflict();
        const selected = sql.prepare('SELECT * FROM cloud_save_snapshots WHERE id=? AND user_id=? AND game_id=?').get(input.snapshotId, user, id) as Row | undefined;
        if (!selected) throw new AppError(404, '找不到本人的存檔快照');
        if (!previous) conflict();
        assertReadableFormat(manifest(id), selected.format_version);
        if (previous) snapshot(user, id, previous, 'restore');
        sql.prepare(`UPDATE cloud_saves SET data=?,revision=?,format_version=?,game_version=?,updated_at=?,request_id=?,source_snapshot_id=?
          WHERE user_id=? AND game_id=?`).run(selected.data, input.revision + 1, selected.format_version, selected.game_version, new Date().toISOString(), input.requestId, input.snapshotId, user, id);
        return { saved: true, ...view(read(user, id)!) };
      })();

    },
  };
}
