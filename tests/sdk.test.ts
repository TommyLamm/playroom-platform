import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync('examples/starter/playroom-sdk.js', 'utf8')
  .replace('export const Playroom =', 'globalThis.Playroom =');
const origin = 'https://platform.example';
const connection = '00000000-0000-4000-8000-000000000001';
const runId = '00000000-0000-4000-8000-000000000002';

type Message = Record<string, unknown>;
type Sdk = {
  ready(): Promise<{ available: boolean; mode: string }>;
  startRun(): Promise<{ runId: string } | null>;
  finishRun(result: { runId: string; score: number }): Promise<{ saved: true } | null>;
};

function harness(standalone = false) {
  let receive: (event: { source: unknown; origin: string; data: Message }) => void;
  let nextTimer = 0;
  let nextRequest = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const messages: { data: Message; targetOrigin: string }[] = [];
  const parent = { postMessage(data: Message, targetOrigin: string) { messages.push({ data, targetOrigin }); } };
  const fakeWindow: { parent: unknown; addEventListener: (_: string, listener: typeof receive) => void } = {
    parent,
    addEventListener(_, listener) { receive = listener; },
  };
  if (standalone) fakeWindow.parent = fakeWindow;
  const sandbox = {
    window: fakeWindow,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++nextRequest + 10).padStart(12, '0')}` },
    setTimeout(callback: () => void, delay: number) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id: number) { timers.delete(id); },
    Playroom: undefined as Sdk | undefined,
  };
  runInNewContext(source, sandbox);
  return {
    sdk: sandbox.Playroom!, messages, parent,
    requests: () => messages.filter((message) => message.data.type === 'request'),
    send(data: Message, overrides: { source?: unknown; origin?: string } = {}) {
      receive({ source: parent, origin, data, ...overrides });
    },
    init(mode: string, diagnostics = false, scoring = true) {
      receive({ source: parent, origin, data: { protocol: 'playroom', version: 1, type: 'init', connection, mode, diagnostics, scoring } });
    },
    respond(request: Message, result: unknown, overrides: Message = {}) {
      receive({ source: parent, origin, data: { protocol: 'playroom', version: 1, type: 'response', connection, requestId: request.requestId, result, ...overrides } });
    },
    expire(delay: number) {
      for (const [id, timer] of timers) if (timer.delay === delay) {
        timers.delete(id);
        timer.callback();
      }
    },
    timers,
  };
}

async function flush() { await Promise.resolve(); await Promise.resolve(); }

test('SDK guest, ordinary preview and unconfigured game remain playable without score requests', async () => {
  for (const config of [{ mode: 'guest', scoring: true }, { mode: 'preview', scoring: true }, { mode: 'authenticated', scoring: false }]) {
    const h = harness();
    h.init(config.mode, false, config.scoring);
    const ready = await h.sdk.ready();
    assert.equal(ready.available, false);
    assert.equal(ready.mode, config.mode);
    assert.equal(await h.sdk.startRun(), null);
    assert.equal(await h.sdk.finishRun({ runId, score: 0 }), null);
    assert.equal(h.requests().length, 0);
  }
});

test('SDK standalone readiness fallback performs no parent calls', async () => {
  const h = harness(true);
  h.expire(8000);
  const ready = await h.sdk.ready();
  assert.equal(ready.available, false);
  assert.equal(ready.mode, 'standalone');
  assert.equal(await h.sdk.startRun(), null);
  assert.equal(await h.sdk.finishRun({ runId, score: 0 }), null);
  assert.equal(h.messages.length, 0);
});

test('SDK diagnostic preview simulates runs but never claims a saved result', async () => {
  const h = harness();
  assert.equal(h.messages[0].data.diagnostics, true);
  h.init('preview', true);
  const ready = await h.sdk.ready();
  assert.equal(ready.available, false);
  assert.equal(ready.mode, 'preview');
  const starting = h.sdk.startRun();
  await flush();
  const start = h.requests()[0];
  assert.equal(start.data.method, 'startRun');
  assert.equal(start.targetOrigin, origin);
  h.respond(start.data, { runId });
  assert.equal((await starting)?.runId, runId);
  const finishing = h.sdk.finishRun({ runId, score: 0 });
  await flush();
  const finish = h.requests()[1];
  assert.equal(finish.data.method, 'finishRun');
  assert.equal((finish.data.payload as { score: number }).score, 0);
  // Even an incorrect host reply cannot turn a preview into an apparent save.
  h.respond(finish.data, { saved: true });
  assert.equal(await finishing, null);
  assert.equal(h.timers.size, 0);
});

test('SDK authenticated mode keeps saved responses and scopes requests to the pinned parent', async () => {
  const h = harness();
  h.init('authenticated', true);
  assert.equal((await h.sdk.ready()).available, true);
  const starting = h.sdk.startRun();
  await flush();
  h.respond(h.requests()[0].data, { runId });
  assert.equal((await starting)?.runId, runId);
  const finishing = h.sdk.finishRun({ runId, score: 7 });
  await flush();
  h.respond(h.requests()[1].data, { saved: true, runId, score: 7 });
  assert.equal((await finishing)?.saved, true);
  assert.ok(h.requests().every((request) => request.targetOrigin === origin && request.data.connection === connection));
});

test('SDK ignores forged init sources and forged responses until the correct response arrives', async () => {
  const h = harness();
  const init = { protocol: 'playroom', version: 1, type: 'init', connection, mode: 'authenticated', scoring: true };
  h.send(init, { source: {} });
  let ready = false;
  void h.sdk.ready().then(() => { ready = true; });
  await flush();
  assert.equal(ready, false);
  h.init('authenticated');
  const starting = h.sdk.startRun();
  let settled = false;
  void starting.then(() => { settled = true; });
  await flush();
  const request = h.requests()[0].data;
  const response = { protocol: 'playroom', version: 1, type: 'response', connection, requestId: request.requestId, result: { runId } };
  h.send(response, { source: {} });
  h.send(response, { origin: 'https://attacker.example' });
  h.send({ ...response, connection: runId });
  h.send({ ...response, version: 2 });
  h.send({ ...response, requestId: runId });
  await flush();
  assert.equal(settled, false);
  h.send(response);
  assert.equal((await starting)?.runId, runId);
  assert.equal(h.timers.size, 0);
});

test('SDK diagnostic errors and request timeouts reject without a saved result', async () => {
  const h = harness();
  h.init('preview', true, false);
  const starting = h.sdk.startRun();
  const rejected = assert.rejects(starting, /Manifest 未設定 leaderboard/);
  await flush();
  h.respond(h.requests()[0].data, null, { error: 'Manifest 未設定 leaderboard' });
  await rejected;
  const retry = h.sdk.startRun();
  const timedOut = assert.rejects(retry, /平台回應逾時/);
  await flush();
  h.expire(15000);
  await timedOut;
  h.respond(h.requests()[1].data, { runId });
  assert.equal(h.timers.size, 0);
});
