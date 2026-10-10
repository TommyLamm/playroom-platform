// Run against an isolated development/test server only; creates two test accounts.
// `write` validates real HTTP saves, then `verify` checks them after restart/restore.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.CLOUD_SAVE_SMOKE_ORIGIN || 'http://localhost:3000';
const phase = process.argv[2];
assert.ok(['write', 'verify'].includes(phase), 'Expected write or verify');
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use an isolated loopback test server');
const password = 'cloud-save-smoke-only-password';
const url = '/api/v1/games/signal-tap/save';
const finalData = { stage: 8, inventory: ['key', 'map'], best: 43 };
const guest = { cookie: '', csrf: '' };
async function request(path, body, client = guest, expected = 200, overrides = {}) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: base, Cookie: client.cookie, 'X-CSRF-Token': client.csrf,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...overrides },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  return { data, response };
}
async function authenticate(username, register = false) {
  const { data, response } = await request(`/api/v1/${register ? 'register' : 'login'}`, { username, password }, guest, register ? 201 : 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return { cookie, csrf: data.csrf };
}
const alice = await authenticate('cloud_smoke_alice', phase === 'write');
const bob = await authenticate('cloud_smoke_bob', phase === 'write');
if (phase === 'write') {
  await request(url, undefined, guest, 401);
  assert.equal((await request(url, undefined, alice)).data, null);
  const input = { data: { stage: 7, inventory: ['key'], best: 42 }, revision: 0, formatVersion: 1, version: '1.2.1', requestId: randomUUID() };
  const first = (await request(url, input, alice)).data;
  assert.equal(first.saved, true);
  assert.equal(first.revision, 1);
  assert.deepEqual((await request(url, input, alice)).data, first);
  const device = await authenticate('cloud_smoke_alice');
  assert.deepEqual((await request(url, undefined, device)).data.data, input.data);
  await request(url, input, alice, 403, { 'X-CSRF-Token': '' });
  await request(url, input, alice, 403, { Origin: 'http://127.0.0.1:3001' });
  await request(url, { ...input, userId: 2 }, alice, 400);
  const next = (await request(url, { ...input, data: finalData, revision: 1, requestId: randomUUID() }, device)).data;
  assert.equal(next.revision, 2);
  await request(url, { ...input, revision: 1, requestId: randomUUID() }, alice, 409);
}
const saved = (await request(url, undefined, alice)).data;
assert.deepEqual(saved.data, finalData);
assert.equal(saved.revision, 2);
assert.equal(saved.formatVersion, 1);
assert.equal(saved.gameVersion, '1.2.1');
assert.equal((await request(url, undefined, bob)).data, null);
assert.equal((await request('/api/v1/games/color-hunt/save', undefined, alice)).data, null);
await request(`${url}?username=cloud_smoke_alice`, undefined, bob, 400);
await request('/api/v1/logout', {}, alice);
await request(url, undefined, alice, 401);
console.log(`Cloud save HTTP ${phase}: OK (revision 2, account/game isolation, authenticated sessions)`);
