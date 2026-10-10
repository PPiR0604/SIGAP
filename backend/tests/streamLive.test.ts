import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.js';
import { SigapRepository } from '../src/db/repo.js';
import { FakeAgentRuntime } from '../src/acp/fakeRuntime.js';
import type { AppConfig } from '../src/config.js';

test('authenticated SSE remains open for events after the HTTP request completes', async () => {
  const repo = new SigapRepository(':memory:');
  const config: AppConfig = { host: '127.0.0.1', port: 0, allowedOrigins: [], bobCommand: 'missing', bobArgs: '', bobWorkspace: 'output/bob-workspace', langflowUrl: '', snapshotDir: '', maxInputBytes: 204800, retentionDays: 7, approvalTtlSeconds: 3600, dbPath: ':memory:', sessionToken: 'test-token' };
  const { app, orchestrator } = await buildServer({ repo, config, runtime: new FakeAgentRuntime() });
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const session = repo.createSession();
    const response = await fetch(`${address}/api/sessions/${session.session_id}/events`, { headers: { authorization: 'Bearer test-token' }, signal: controller.signal });
    assert.equal(response.status, 200);
    reader = response.body!.getReader();
    await new Promise(resolve => setTimeout(resolve, 20));
    orchestrator.emit('event', { event_id: 9, session_id: session.session_id, event_type: 'assistant_message', payload: { text: 'delayed event' } });
    const data = await Promise.race([reader.read(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Live SSE event missing')), 1000).unref())]);
    assert.match(new TextDecoder().decode(data.value), /delayed event/);
  } finally { controller.abort(); await reader?.cancel().catch(() => {}); await app.close(); repo.close(); }
});
