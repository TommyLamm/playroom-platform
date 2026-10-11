// Streamed into the running updater container; its token stays inside the container.
export async function requestUpdater(action, commit, {
  baseUrl = 'http://127.0.0.1:3090', token = process.env.UPDATER_TOKEN,
} = {}) {
  if (!token) throw new Error('UPDATER_TOKEN is required');
  if (!['check', 'status', 'update'].includes(action)) throw new Error('Unknown OTA action');
  if (action === 'update' && !/^[a-f0-9]{40}$/.test(commit || ''))
    throw new Error('COMMIT must be a full 40-character lowercase Git SHA; run make ota-check first');
  const response = await fetch(`${baseUrl}/${action}`, {
    method: action === 'status' ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: action === 'status' ? undefined : JSON.stringify(action === 'update' ? { commit } : {}),
    signal: AbortSignal.timeout(35000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Updater ${response.status}: ${result.error || 'Request failed'}`);
  return result;
}

if (process.argv[1] === '-') {
  try {
    const action = process.argv[2];
    console.info(JSON.stringify(await requestUpdater(action, process.argv[3]), null, 2));
    if (action === 'update')
      console.info('Update queued; use make ota-status or make logs to monitor completion.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
