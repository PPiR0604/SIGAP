import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TokenRateLimiter} from '../src/gemini/rateLimit.js';
import {shrinkConsumedPrepare} from '../src/gemini/context.js';
import {slimSchema} from '../src/gemini/client.js';
import {GeminiAgentRuntime} from '../src/gemini/runtime.js';
import {call,done,scriptedModel,scenarioMcp} from './helpers/geminiScenario.js';

test('limiter lets requests pass under the limit and waits when the window is full', async () => {
  let clock = 0;
  const limiter = new TokenRateLimiter(1000, 60000, 90000, () => clock);
  await limiter.acquire(500);
  limiter.record(800);
  let waited = 0;
  const pending = limiter.acquire(500, undefined, ms => { waited = ms; });
  await new Promise(r => setTimeout(r, 10));
  assert.ok(waited > 0, 'menunggu karena 800 + 500 melebihi 1000');
  clock = 61000;
  await pending;
  assert.equal(limiter.used(), 0, 'catatan lama keluar dari jendela');
});

test('limiter fails clearly when the wait would exceed the maximum', async () => {
  let clock = 0;
  const limiter = new TokenRateLimiter(1000, 60000, 5000, () => clock);
  limiter.record(900);
  await assert.rejects(limiter.acquire(500), /Batas token per menit/);
});

test('limiter never blocks an empty window and is disabled by limit 0', async () => {
  await new TokenRateLimiter(100).acquire(5000);
  const off = new TokenRateLimiter(0); off.record(1e9);
  await off.acquire(1e9);
});

test('consumed prepare results are replaced by a short marker, only from the given index', () => {
  const big = 'x'.repeat(5000);
  const response = (name: string) => ({role: 'user' as const, parts: [{functionResponse: {name, response: {result: {content: [{type: 'text', text: big}]}}}}]});
  const history = [response('sigap_1_prepare_needs'), response('sigap_1_prepare_needs'), response('sigap_2_validate_needs')];
  assert.equal(shrinkConsumedPrepare(history, 1), 1);
  assert.ok(JSON.stringify(history[0]).includes(big), 'operasi lama tidak disentuh');
  assert.ok(!JSON.stringify(history[1]).includes(big));
  assert.ok(JSON.stringify(history[2]).includes(big), 'hasil validator tetap utuh');
  assert.equal(shrinkConsumedPrepare(history, 1), 0, 'idempoten');
});

test('long tool descriptions are trimmed before being sent', () => {
  const slim = slimSchema({type: 'object', properties: {a: {type: 'string', description: 'y'.repeat(2000)}}}) as any;
  assert.ok(slim.properties.a.description.length < 450);
  assert.equal((slimSchema({description: 'pendek'}) as any).description, 'pendek');
});

test('after validate succeeds the model no longer receives the large prepare output', async () => {
  const bigText = 'LAPORAN '.repeat(2000);
  const mcp = await scenarioMcp(name => name === 'sigap_1_prepare_needs'
    ? {content: [{type: 'text', text: '<<<SOURCE_REF>>>{"batch_id":"source","source_sha256":"hash"}<<<END_SOURCE_REF>>>\n' + bigText}]} : undefined);
  const script = scriptedModel([
    call('sigap_1_prepare_needs', {input_value: 'Posko Uji 10 jiwa.'}),
    call('sigap_2_validate_needs', {input_value: '{"batch_id":"source","source_sha256":"hash","records":[]}'}),
    done
  ]);
  const runtime = new GeminiAgentRuntime({apiKey: 'synthetic-test-key', model: 'gemini-3.8-flash'}, script.model);
  try {
    await runtime.initSession({sessionId: 's', contextId: 't', mcpServerConfig: [{name: 'langflow', type: 'http', url: mcp.url, headers: []}]});
    await runtime.sendPrompt({sessionId: 's', batchId: 'b', requestId: 'r', prompt: 'Laporan', operation: 'prepare'}, () => {}, async () => ({allow: true}));
    assert.ok(JSON.stringify(script.inputs[1].contents).includes('LAPORAN LAPORAN'), 'putaran 2 masih butuh hasil prepare');
    assert.ok(!JSON.stringify(script.inputs[2].contents).includes('LAPORAN LAPORAN'), 'putaran 3 tidak lagi membawanya');
    assert.ok(JSON.stringify(script.inputs[2].contents).includes('sudah dipakai validate_needs'));
  } finally {await runtime.shutdown(); await mcp.close();}
});

test('a denied tool call returns the gate reason to the model instead of a generic message', async () => {
  const mcp = await scenarioMcp();
  const script = scriptedModel([call('sigap_6_draft_bulletin', {input_value: 'buatkan buletin'}), done]);
  const runtime = new GeminiAgentRuntime({apiKey: 'synthetic-test-key', model: 'gemini-3.8-flash'}, script.model);
  try {
    await runtime.initSession({sessionId: 's', contextId: 't', mcpServerConfig: [{name: 'langflow', type: 'http', url: mcp.url, headers: []}]});
    await runtime.sendPrompt({sessionId: 's', batchId: 'b', requestId: 'r', prompt: 'Buat buletin', operation: 'prepare'}, () => {}, async () => ({allow: false, reason: 'ALASAN-UJI: gunakan action preview'}));
    assert.match(JSON.stringify(script.inputs[1].contents.at(-1)), /ALASAN-UJI: gunakan action preview/);
    assert.equal(mcp.requests.filter(r => r.method === 'tools/call').length, 0, 'tool tidak dijalankan');
  } finally {await runtime.shutdown(); await mcp.close();}
});
