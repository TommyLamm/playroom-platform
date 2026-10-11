import type { GameManifest } from '../../shared/manifest';
import type { ProgressSave } from '../../shared/cloud-save';
import type { RequestMessage } from '../../shared/protocol';
import { sdkPayloads } from '../../shared/sdk-payloads';

export function createPreviewOperations(manifest: GameManifest, record: (kind: 'info' | 'success' | 'error', text: string) => void) {
  const runs = new Set<string>();
  const scores = new Map<string, number>();
  let save: ProgressSave | null = null;
  return async (message: RequestMessage) => {
    if (message.method === 'loadProgress') { sdkPayloads.loadProgress.parse(message.payload); record('info', 'loadProgress：只讀取此預覽的暫存進度'); return save; }
    if (message.method === 'saveProgress') {
      const input = sdkPayloads.saveProgress.parse(message.payload);
      if (input.revision !== (save?.revision ?? 0)) throw Object.assign(new Error('預覽進度版本衝突，請重新讀取'), { machineCode: 'SAVE_REVISION_CONFLICT' });
      if (manifest.cloudSave && (input.formatVersion !== manifest.cloudSave.writeFormat || (save && !manifest.cloudSave.readableFormats.includes(save.formatVersion)))) throw Object.assign(new Error('存檔格式不相容'), { machineCode: 'SAVE_FORMAT_INCOMPATIBLE' });
      save = { ...input, revision: input.revision + 1, gameVersion: manifest.version, updatedAt: new Date().toISOString() };
      record('success', 'saveProgress：驗證通過；只暫存於預覽，不保存帳號進度');
      return null;
    }
    if (message.method === 'startRun') {
      sdkPayloads.startRun.parse(message.payload);
      record('info', 'startRun：收到開始一局');
      if (!manifest.leaderboard) throw new Error('Manifest 未設定 leaderboard，無法模擬成績');
      const runId = crypto.randomUUID(); runs.add(runId);
      record('success', 'startRun：已建立模擬局次，不保存');
      return { runId };
    }
    record('info', 'finishRun：收到完成一局');
    const result = sdkPayloads.finishRun.parse(message.payload);
    if (!runs.has(result.runId)) throw new Error('局次不屬於目前的預覽連線');
    const board = manifest.leaderboard;
    if (!board || result.score < board.minScore || result.score > board.maxScore) throw new Error('分數超出 Manifest 設定範圍');
    const previous = scores.get(result.runId);
    if (previous !== undefined && previous !== result.score) throw new Error('已完成的模擬局次不可覆寫分數');
    scores.set(result.runId, result.score);
    record('success', `finishRun：${result.score} ${board.unit}，${previous === undefined ? '驗證通過' : '重複提交已忽略'}；預覽不保存`);
    return null;
  };
}
