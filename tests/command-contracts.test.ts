import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, api, gameCommand, setCsrf } from '../client/api.js';
import { errorAction, safeErrorDetails } from '../shared/errors.js';
import { publishBatchRequest, publishRequest, unpublishRequest, roleChangeRequest } from '../shared/commands.js';

test('command contracts reject missing or invalid expectations and retain batch limits', () => {
  const input = { version: '1.0.0', expectedActiveVersion: null, expectedPublished: false };
  assert.equal(publishRequest.safeParse(input).success, true);
  for (const value of [{ version: '1.0.0' }, { ...input, expectedPublished: 0 }, { ...input, expectedActiveVersion: '' }, { ...input, extra: 1 }])
    assert.equal(publishRequest.safeParse(value).success, false);
  assert.equal(unpublishRequest.safeParse({}).success, false);
  const item = { ...input, gameId: 'alpha' };
  for (const items of [[], [item, item], Array.from({ length: 101 }, (_, i) => ({ ...item, gameId: `game-${i}` }))])
    assert.equal(publishBatchRequest.safeParse({ items }).success, false);
  assert.equal(roleChangeRequest.safeParse({ role: 'admin' }).success, false);
  assert.equal(safeErrorDetails({ private: { nested: true } }), undefined);
  assert.equal(safeErrorDetails({ count: Infinity }), undefined);
});

test('client error transport preserves status, codes and safe details, with old-server fallback', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; setCsrf(''); });
  let requests = 0;
  setCsrf('csrf');
  globalThis.fetch = async (url, init) => {
    requests++;
    assert.equal(url, '/api/v1/admin/games/alpha/publish');
    assert.equal((init?.headers as Record<string, string>)['X-CSRF-Token'], 'csrf');
    assert.deepEqual(JSON.parse(String(init?.body)), { version: '2.0.0', expectedActiveVersion: '1.0.0', expectedPublished: true });
    return new Response(JSON.stringify({ error: 'Changed text', code: 'STATE_CONFLICT', details: { activeVersion: '3.0.0', published: true } }), { status: 409 });
  };
  await assert.rejects(gameCommand('alpha', 'publish', { version: '2.0.0', expectedActiveVersion: '1.0.0', expectedPublished: true }), (e: unknown) => {
    assert.ok(e instanceof ApiError); assert.equal(e.status, 409); assert.equal(e.code, 'STATE_CONFLICT');
    assert.deepEqual(e.details, { activeVersion: '3.0.0', published: true }); assert.equal(errorAction(e.code, e.status), 'refresh-state'); return true;
  });
  assert.equal(requests, 1, 'transport never retries a failed mutation');
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Legacy error', details: { unsafe: { nested: true } } }), { status: 409 });
  await assert.rejects(api('/legacy', {}), (e: unknown) => { assert.ok(e instanceof ApiError); assert.equal(e.message, 'Legacy error'); assert.equal(e.status, 409); assert.equal(e.code, undefined); assert.equal(e.details, undefined); return true; });
  assert.equal(errorAction(undefined, 409), 'stop');
  assert.equal(errorAction(undefined, 401), 'refresh-session');
  for (const code of ['AUTH_REQUIRED', 'PERMISSION_DENIED', 'CSRF_INVALID']) assert.equal(errorAction(code), 'refresh-session');
  for (const code of ['REQUEST_ID_REUSED', 'SAVE_FORMAT_INCOMPATIBLE', 'LAST_ADMIN_REQUIRED', 'ORIGIN_REJECTED']) assert.equal(errorAction(code), 'stop');
  assert.equal(errorAction('SAVE_REVISION_CONFLICT'), 'refresh-state'); assert.equal(errorAction('RATE_LIMITED'), 'wait');
});
