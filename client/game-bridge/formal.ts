import type { RequestMessage } from '../../shared/protocol';
import { sdkPayloads } from '../../shared/sdk-payloads';
import type { PublicGame } from '../../shared/types';

export function createFormalOperations(context: {
  game: PublicGame | undefined;
  active(): boolean;
  call<T>(path: string, body?: unknown): Promise<T>;
  ensurePlay(): Promise<string | null>;
  save(result: { runId: string; score: number }): Promise<unknown>;
  progressSaved(): void;
}) {
  const runIds = new Set<string>();
  return async (message: RequestMessage) => {
    const game = context.game;
    if (!game || !context.active()) throw Object.assign(new Error('遊戲連線已失效'), { machineCode: 'CONNECTION_INVALID' });
    if (message.method === 'loadProgress') {
      sdkPayloads.loadProgress.parse(message.payload);
      return context.call(`/games/${game.id}/save?version=${encodeURIComponent(game.version)}`);
    }
    if (message.method === 'saveProgress') {
      const input = sdkPayloads.saveProgress.parse(message.payload);
      const result = await context.call(`/games/${game.id}/save`, { ...input, version: game.version, requestId: message.requestId });
      context.progressSaved();
      return result;
    }
    const id = await context.ensurePlay();
    if (!id || !context.active()) throw Object.assign(new Error('遊戲連線已失效'), { machineCode: 'CONNECTION_INVALID' });
    if (message.method === 'startRun') {
      sdkPayloads.startRun.parse(message.payload);
      const result = await context.call<{ runId: string }>(`/plays/${id}/runs`, { requestId: message.requestId });
      if (!context.active()) throw Object.assign(new Error('遊戲連線已失效'), { machineCode: 'CONNECTION_INVALID' });
      runIds.add(result.runId);
      return result;
    }
    const result = sdkPayloads.finishRun.parse(message.payload);
    if (!runIds.has(result.runId)) throw Object.assign(new Error('此局次不屬於目前的遊戲連線'), { machineCode: 'CONNECTION_INVALID' });
    return context.save(result);
  };
}
