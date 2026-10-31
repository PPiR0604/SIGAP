import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SigapRepository } from '../src/db/repo.js';
import { validateAndCreateApproval, verifyToolExecutionAgainstGate } from '../src/approvals/gate.js';
import { buildServer } from '../src/server.js';
import { FakeAgentRuntime } from '../src/acp/fakeRuntime.js';
import type { AppConfig } from '../src/config.js';
import { buildApprovedWritePayload } from '../src/approvals/gate.js';
import type { AgentPromptOptions, AgentEventHandler, PermissionGate } from '../src/acp/types.js';

const id = '1'.repeat(32), sha = 'a'.repeat(64);
function fixture() {
  const repo = new SigapRepository(':memory:');
  const session = repo.createSession();
  const batch = repo.createBatch({ sessionId: session.session_id, requestId: 'one', contextId: session.context_id, sourceSha256: 'hash', sourceLength: 1, filteredText: 'x', piiSummary: {} });
  repo.saveSnapshot({ snapshotId: id, snapshotSha256: sha, batchId: batch.batch_id, version: 1, qualityStatus: 'LOLOS_PEMERIKSAAN', payload: { records: [] } });
  repo.updateBatchStatus(batch.batch_id, 'ready_for_review', { latest_snapshot_id: id, latest_snapshot_sha256: sha });
  return { repo, batch: repo.getBatch(batch.batch_id)!, session };
}
const decision = { action: 'approve_save' as const, snapshot_id: id, partial_acknowledged: false, clear_decisions: {} };

test('snapshot-level conflicts require partial acknowledgement even if record fields are complete',async ()=>{
  const {repo,batch}=fixture();
  try{
    const newer='3'.repeat(32);
    repo.saveSnapshot({snapshotId:newer,snapshotSha256:sha,batchId:batch.batch_id,version:2,qualityStatus:'PERLU_KLARIFIKASI',payload:{records:[{report_id:'R1',total_people:10}],issues:[{detail:'Konflik antar laporan'}]}});
    assert.equal((await validateAndCreateApproval(repo,repo.getBatch(batch.batch_id)!,'actor',{...decision,snapshot_id:newer})).code,'PARTIAL_CONFIRMATION_REQUIRED');
  }finally{repo.close();}
});

test('unknown and prefixed write tools are denied before approval', async () => {
  const { repo, batch } = fixture();
  try {
    for (const tool of ['delete_database', 'mcp__langflow__upsert_shelter', undefined]) {
      assert.equal((await verifyToolExecutionAgainstGate(repo, batch.batch_id, tool as string, {})).allow, false);
    }
  } finally { repo.close(); }
});
test('approval cannot use a snapshot belonging to a different batch', async () => {
  const { repo, batch, session } = fixture();
  try {
    const other = repo.createBatch({ sessionId: session.session_id, requestId: 'two', contextId: session.context_id, sourceSha256: 'h', sourceLength: 1, filteredText: 'x', piiSummary: {} });
    assert.equal((await validateAndCreateApproval(repo, other, 'actor', decision)).valid, false);
  } finally { repo.close(); }
});
test('write digest and choices must exactly match the approved candidate', async () => {
  const { repo, batch } = fixture();
  try {
    assert.equal((await validateAndCreateApproval(repo, batch, 'actor', decision)).valid, true);
    assert.equal((await verifyToolExecutionAgainstGate(repo, batch.batch_id, 'upsert_shelter', { snapshot_id: id, snapshot_sha256: 'b'.repeat(64) })).allow, false);
    assert.equal((await verifyToolExecutionAgainstGate(repo, batch.batch_id, 'upsert_shelter', { snapshot_id: id, snapshot_sha256: sha, confirmed: true, partial_acknowledged: false, clear_decisions: { R01: { disability: 'clear' } } })).allow, false);
  } finally { repo.close(); }
});
test('consuming an already consumed or missing approval returns false', async () => {
  const { repo, batch } = fixture();
  try {
    const approval = (await validateAndCreateApproval(repo, batch, 'actor', decision)).approval!;
    assert.equal(repo.consumeApproval(approval.approval_id), true);
    assert.equal(repo.consumeApproval(approval.approval_id), false);
    assert.equal(repo.consumeApproval('missing'), false);
  } finally { repo.close(); }
});
test('a second approval for the same candidate cannot authorize another write', async () => {
  const { repo, batch } = fixture();
  try {
    assert.equal((await validateAndCreateApproval(repo, batch, 'actor', decision)).valid, true);
    assert.equal((await validateAndCreateApproval(repo, batch, 'actor', decision)).valid, false);
  } finally { repo.close(); }
});
test('expired approval is denied without consuming it', async () => {
  const { repo, batch } = fixture();
  try {
    const approval = (await validateAndCreateApproval(repo, batch, 'actor', decision)).approval!;
    assert.equal((await verifyToolExecutionAgainstGate(repo, batch.batch_id, 'upsert_shelter', buildApprovedWritePayload(approval), -1)).allow, false);
    assert.equal(repo.getPendingApprovalForSnapshot(batch.batch_id, id)?.approval_id, approval.approval_id);
  } finally { repo.close(); }
});
test('write attempts cannot silently change a keep decision into clear', async () => {
  const { repo, batch } = fixture();
  try {
    // Persist a real pending clear proposal as a fresh candidate.
    const newer = '2'.repeat(32);
    repo.saveSnapshot({ snapshotId: newer, snapshotSha256: sha, batchId: batch.batch_id, version: 2, qualityStatus: 'PERLU_KLARIFIKASI', payload: { records: [{ report_id: 'R01', pending_clear_fields: ['disability'] }] } });
    repo.supersedePreviousSnapshots(batch.batch_id, newer);
    const approval = (await validateAndCreateApproval(repo, batch, 'actor', { ...decision, snapshot_id: newer, partial_acknowledged: true, clear_decisions: { R01: { disability: 'keep' } } })).approval!;
    const payload = buildApprovedWritePayload(approval);
    assert.equal((await verifyToolExecutionAgainstGate(repo, batch.batch_id, 'upsert_shelter', { ...payload, clear_decisions: { R01: { disability: 'clear' } } })).allow, false);
    assert.equal((await verifyToolExecutionAgainstGate(repo, batch.batch_id, 'upsert_shelter', { input_value: JSON.stringify(payload) })).allow, true);
  } finally { repo.close(); }
});
test('draft_bulletin cannot create an external document without a publication approval', async () => {
  const { repo, batch } = fixture();
  try {
    assert.equal((await verifyToolExecutionAgainstGate(repo, batch.batch_id, 'draft_bulletin', { action: 'create_doc', confirmed_create_doc: true })).allow, false);
    assert.equal((await verifyToolExecutionAgainstGate(repo, batch.batch_id, 'draft_bulletin', { action: 'preview' })).allow, true);
  } finally { repo.close(); }
});

const config: AppConfig = { host: '127.0.0.1', port: 8787, allowedOrigins: [], bobCommand: 'bob', bobArgs: '', bobWorkspace: 'output/bob-workspace', langflowUrl: 'http://localhost:7860', snapshotDir: 'output/.sigap_snapshots', maxInputBytes: 204800, retentionDays: 7, approvalTtlSeconds: 3600, dbPath: ':memory:', sessionToken: 'test-token' };
test('mock health never advertises live Bob or real writes', async () => {
  const repo = new SigapRepository(':memory:');
  const { app } = await buildServer({ repo, config, runtime: new FakeAgentRuntime() });
  try {
    const health = (await app.inject('/api/health')).json();
    assert.equal(health.mode, 'mock_mode');
    assert.equal(health.write_enabled, false);
  } finally { await app.close(); repo.close(); }
});
test('source metadata is a real SHA-256 and request IDs are scoped to a session', async () => {
  const repo = new SigapRepository(':memory:');
  const { app } = await buildServer({ repo, config, runtime: new FakeAgentRuntime() });
  try {
    const first = repo.createSession(), second = repo.createSession();
    const send = (sid: string) => app.inject({ method: 'POST', url: `/api/sessions/${sid}/messages`, headers: { authorization: 'Bearer test-token' }, payload: { request_id: 'shared-request-id', text: 'abc' } });
    const one = await send(first.session_id);
    const two = await send(second.session_id);
    assert.equal(repo.getBatch(one.json().batch_id)?.source_sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.notEqual(one.json().batch_id, two.json().batch_id);
    await new Promise<void>(resolve => setImmediate(resolve));
  } finally { await app.close(); repo.close(); }
});
test('approval endpoint continues through simulated write and read-back exactly once', async () => {
  const repo = new SigapRepository(':memory:');
  const { app } = await buildServer({ repo, config, runtime: new FakeAgentRuntime() });
  try {
    const session = repo.createSession();
    const sent = await app.inject({ method: 'POST', url: `/api/sessions/${session.session_id}/messages`, headers: { authorization: 'Bearer test-token' }, payload: { request_id: 'approve-flow', text: 'Posko A 10 jiwa' } });
    await new Promise<void>(resolve => setImmediate(resolve));
    const batch = repo.getBatch(sent.json().batch_id)!;
    const body = { action: 'approve_save', snapshot_id: batch.latest_snapshot_id, partial_acknowledged: true, clear_decisions: { R001: { disability: 'keep' } } };
    const approve = () => app.inject({ method: 'POST', url: `/api/batches/${batch.batch_id}/decisions`, headers: { authorization: 'Bearer test-token' }, payload: body });
    const result = await approve();
    assert.equal(result.statusCode, 202);
    assert.equal((await approve()).statusCode, 409);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(repo.getBatch(batch.batch_id)?.status, 'simulated_done');
    const types = repo.getEventsAfter(session.session_id).map(e => e.event_type);
    assert.equal(types.filter(t => t === 'storage_result').length, 1);
    assert.equal(types.filter(t => t === 'readback_result').length, 1);
  } finally { await app.close(); repo.close(); }
});
for (const scenario of [{ readbackStatus: 'mismatch' as const }, { shouldFailStage: 'fetch_shelters' as const }]) {
  test(`read-back ${'readbackStatus' in scenario ? 'mismatch' : 'failure'} never marks the batch done`, async () => {
    const repo = new SigapRepository(':memory:');
    const { app } = await buildServer({ repo, config, runtime: new FakeAgentRuntime(scenario) });
    try {
      const session = repo.createSession();
      const sent = await app.inject({ method: 'POST', url: `/api/sessions/${session.session_id}/messages`, headers: { authorization: 'Bearer test-token' }, payload: { request_id: 'failure-flow', text: 'Posko A' } });
      await new Promise<void>(resolve => setImmediate(resolve));
      const batch = repo.getBatch(sent.json().batch_id)!;
      const result = await app.inject({ method: 'POST', url: `/api/batches/${batch.batch_id}/decisions`, headers: { authorization: 'Bearer test-token' }, payload: { action: 'approve_save', snapshot_id: batch.latest_snapshot_id, partial_acknowledged: true, clear_decisions: { R001: { disability: 'defer' } } } });
      assert.equal(result.statusCode, 202);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(repo.getBatch(batch.batch_id)?.status, 'readbackStatus' in scenario ? 'needs_review' : 'save_status_unknown');
    } finally { await app.close(); repo.close(); }
  });
}
test('a visible preview does not unlock a session while the agent prompt is still running', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => release = resolve);
  class SlowRuntime extends FakeAgentRuntime {
    override async sendPrompt(options: AgentPromptOptions, onEvent: AgentEventHandler, gate?: PermissionGate) {
      await super.sendPrompt(options, onEvent, gate);
      await held;
    }
  }
  const repo = new SigapRepository(':memory:');
  const { app } = await buildServer({ repo, config, runtime: new SlowRuntime() });
  try {
    const session = repo.createSession();
    const send = (request_id: string) => app.inject({ method: 'POST', url: `/api/sessions/${session.session_id}/messages`, headers: { authorization: 'Bearer test-token' }, payload: { request_id, text: 'Posko A' } });
    assert.equal((await send('held-first')).statusCode, 202);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal((await send('held-second')).statusCode, 409);
  } finally { release(); await new Promise<void>(resolve => setImmediate(resolve)); await app.close(); repo.close(); }
});
test('reusing a snapshot ID/hash with changed data cannot replace the displayed candidate', async () => {
  class MutatedSnapshotRuntime extends FakeAgentRuntime {
    override async sendPrompt(options: AgentPromptOptions, onEvent: AgentEventHandler) {
      const meta = { session_id: options.sessionId, batch_id: options.batchId, request_id: options.requestId, timestamp: new Date().toISOString() };
      for (const total_people of [10, 999]) onEvent({ ...meta, event_type: 'preview_ready', payload: { rawOutput: JSON.stringify({ snapshot_id: id, snapshot_sha256: sha, records: [{ report_id: 'R01', shelter_name: 'Posko A', total_people }], issues: [] }) } });
    }
  }
  const repo = new SigapRepository(':memory:');
  const { app } = await buildServer({ repo, config, runtime: new MutatedSnapshotRuntime() });
  try {
    const session = repo.createSession();
    const sent = await app.inject({ method: 'POST', url: `/api/sessions/${session.session_id}/messages`, headers: { authorization: 'Bearer test-token' }, payload: { request_id: 'mutated', text: 'Posko A 10 jiwa' } });
    await new Promise<void>(resolve => setImmediate(resolve));
    const batch = repo.getBatch(sent.json().batch_id)!;
    assert.equal(JSON.parse(batch.preview_payload_json!).records[0].total_people, 10);
    assert.equal(batch.status, 'payload_invalid');
    assert.equal((await validateAndCreateApproval(repo, batch, 'actor', decision)).valid, false);
  } finally { await app.close(); repo.close(); }
});

test('draft_bulletin denial explains the required format so the model can retry', async () => {
  const repo = new SigapRepository(':memory:');
  const session = repo.createSession('posko-uji');
  const batch = repo.createBatch({ sessionId: session.session_id, requestId: 'r-reason', contextId: 'posko-uji', sourceSha256: 'a'.repeat(64), sourceLength: 1, filteredText: 'x', piiSummary: { nikCount: 0, phoneCount: 0, emailCount: 0, bankCount: 0, totalRedacted: 0 } });
  for (const args of [{ action: 'create_doc' }, 'buatkan buletin', { input_value: 'bukan json' }, { action: 'preview', confirmed_create_doc: true }]) {
    const decision = (await verifyToolExecutionAgainstGate(repo, batch.batch_id, 'draft_bulletin', args));
    assert.equal(decision.allow, false);
    assert.match(decision.reason || '', /"action":"preview"/);
  }
  repo.close();
});
