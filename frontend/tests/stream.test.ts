import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connectEventStream } from '../src/stream.ts';

test('SSE sends Bearer auth and replays from the last event after reconnect', async () => {
  const headers: any[] = [];
  const server = createServer((req, res) => {
    headers.push(req.headers);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (headers.length === 1) {
      res.write('id: 7\r\nevent: preview_ready\r\ndata: {"value":"');
      res.end('one"}\r\n\r\n');
    } else res.end('id: 8\nevent: preview_ready\ndata: {"value":"two"}\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const seen: string[] = [];
  let stream: { close(): void } | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SSE did not replay')), 5000);
      stream = connectEventStream(`http://127.0.0.1:${address.port}/events`, 'secret', {
        preview_ready: event => { seen.push(event.value); if (seen.length === 2) { clearTimeout(timer); stream?.close(); resolve(); } }
      }, reject);
    });
    assert.deepEqual(seen, ['one', 'two']);
    assert.equal(headers[0].authorization, 'Bearer secret');
    assert.equal(headers[1]['last-event-id'], '7');
  } finally { stream?.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
