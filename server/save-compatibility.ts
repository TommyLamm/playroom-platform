import type { Store } from './db.js';
import { cloudSaveCompatibility, type GameManifest } from '../shared/manifest.js';
import type { SaveCompatibilitySummary } from '../shared/cloud-save.js';
import { AppError } from './errors.js';

/** Only aggregate formats/counts leave the private save boundary. */
export function saveCompatibility(store: Store, manifest: GameManifest): SaveCompatibilitySummary {
  const rows = store.sqlite.prepare('SELECT format_version AS formatVersion, count(*) AS count FROM cloud_saves WHERE game_id=? GROUP BY format_version ORDER BY format_version').all(manifest.id) as { formatVersion: number; count: number }[];
  const formats = rows.map((row) => ({ ...row, compatibility: cloudSaveCompatibility(manifest, row.formatVersion) }));
  const affected = formats.reduce((total, row) => total + (row.compatibility === 'incompatible' ? row.count : 0), 0);
  return { status: !manifest.cloudSave ? 'unknown' : affected ? 'incompatible' : 'compatible',
    total: formats.reduce((total, row) => total + row.count, 0), affected, formats };
}

export function assertPublishSaveCompatibility(store: Store, manifest: GameManifest) {
  const summary = saveCompatibility(store, manifest);
  if (summary.affected) throw new AppError(409, `目標版本無法讀取 ${summary.affected} 份現有存檔，請提供相容版本後再發布或回退`, 'SAVE_FORMAT_INCOMPATIBLE', { affected: summary.affected });
}

export function assertReadableFormat(manifest: GameManifest, format: number) {
  if (cloudSaveCompatibility(manifest, format) === 'incompatible')
    throw new AppError(409, '此遊戲版本不支援目前存檔格式，請重新開啟相容版本；不能以空進度覆寫', 'SAVE_FORMAT_INCOMPATIBLE', { formatVersion: format, gameVersion: manifest.version });
}
