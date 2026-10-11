import type { Config } from './config.js';
import { AppError } from './errors.js';

export async function updater(config: Config, action: string, body?: unknown) {
  if (!config.updaterUrl || !config.updaterToken) {
    if (action === 'status') return { enabled: false, current: config.commit };
    throw new AppError(503, '尚未設定平台更新服務');
  }
  try {
    const response = await fetch(`${config.updaterUrl}/${action}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${config.updaterToken}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const value = (await response.json()) as { error?: string };
    if (!response.ok)
      throw new AppError(response.status, value.error || '平台更新服務無法完成操作');
    return value;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, '更新服務暫時無法連線，請稍後重試');
  }
}
