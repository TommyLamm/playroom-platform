import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { UpdateEngine, UpdateError, settings } from './engine.mjs';

const config = settings();
const engine = new UpdateEngine(config);
await engine.init();
const server = http.createServer(async (request, response) => {
  const send = (status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  if (request.method === 'GET' && request.url === '/health') return send(200, { status: 'ok' });
  const received = Buffer.from(request.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${config.token}`);
  if (received.length !== expected.length || !timingSafeEqual(received, expected))
    return send(401, { error: 'Unauthorized' });
  try {
    if (request.method === 'GET' && request.url === '/status')
      return send(200, await engine.status());
    if (request.method !== 'POST' || !['/check', '/update'].includes(request.url))
      return send(404, { error: 'Not found' });
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 1024) throw new UpdateError(413, 'Payload too large');
    }
    let input;
    try {
      input = JSON.parse(body || '{}');
    } catch {
      throw new UpdateError(400, 'Invalid JSON');
    }
    if (request.url === '/check') return send(200, await engine.check());
    if (!input || Object.keys(input).length !== 1 || typeof input.commit !== 'string')
      throw new UpdateError(400, 'Only commit is accepted');
    send(202, await engine.start(input.commit));
  } catch (error) {
    console.error(error.message);
    send(error instanceof UpdateError ? error.status : 503, {
      error: error instanceof UpdateError ? error.message : '更新服務無法完成操作，請查看主機日誌',
    });
  }
});
server.requestTimeout = 35000;
server.listen(3090, '0.0.0.0');
const check = () => {
  if (!engine.busy && !engine.checking)
    void engine.check().catch((error) => console.error(error.message));
};
const timer = setInterval(check, 5 * 60000);
check();
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
  });
