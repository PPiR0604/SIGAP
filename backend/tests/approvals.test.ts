import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SigapRepository } from '../src/db/repo.js';
import { validateAndCreateApproval, verifyToolExecutionAgainstGate, buildApprovedWritePayload } from '../src/approvals/gate.js';

describe('Approval Gate & Write Control (FR-05, FR-06, FR-07)', () => {
  const snapshotId = '1234567890abcdef1234567890abcdef';
  const snapshotSha256 = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

  test('menolak jika snapshot_id tidak ditemukan', async () => {
    const repo = new SigapRepository(':memory:');
    const session = repo.createSession();
    const batch = repo.createBatch({
      sessionId: session.session_id,
      requestId: 'req-1',
      contextId: 'posko-1',
      sourceSha256: 'hash',
      sourceLength: 10,
      filteredText: 'test',
      piiSummary: {}
    });

    const res = (await validateAndCreateApproval(repo, batch, 'actor-1', {
      action: 'approve_save',
      snapshot_id: snapshotId,
      partial_acknowledged: true,
      clear_decisions: {}
    }));

    assert.equal(res.valid, false);
    assert.equal(res.code, 'SNAPSHOT_NOT_FOUND');
  });

  test('menolak rekap parsial jika partial_acknowledged bernilai false', async () => {
    const repo = new SigapRepository(':memory:');
    const session = repo.createSession();
    const batch = repo.createBatch({
      sessionId: session.session_id,
      requestId: 'req-2',
      contextId: 'posko-1',
      sourceSha256: 'hash',
      sourceLength: 10,
      filteredText: 'test',
      piiSummary: {}
    });

    repo.saveSnapshot({
      snapshotId,
      snapshotSha256,
      batchId: batch.batch_id,
      version: 1,
      qualityStatus: 'PERLU_KLARIFIKASI',
      payload: {
        records: [{ report_id: 'R01', missing_fields: ['female'] }]
      }
    });

    const res = (await validateAndCreateApproval(repo, batch, 'actor-1', {
      action: 'approve_save',
      snapshot_id: snapshotId,
      partial_acknowledged: false, // User didn't confirm partial
      clear_decisions: {}
    }));

    assert.equal(res.valid, false);
    assert.equal(res.code, 'PARTIAL_CONFIRMATION_REQUIRED');
  });

  test('menolak jika usulan clear belum diputuskan secara lengkap', async () => {
    const repo = new SigapRepository(':memory:');
    const session = repo.createSession();
    const batch = repo.createBatch({
      sessionId: session.session_id,
      requestId: 'req-3',
      contextId: 'posko-1',
      sourceSha256: 'hash',
      sourceLength: 10,
      filteredText: 'test',
      piiSummary: {}
    });

    repo.saveSnapshot({
      snapshotId,
      snapshotSha256,
      batchId: batch.batch_id,
      version: 1,
      qualityStatus: 'PERLU_KLARIFIKASI',
      payload: {
        records: [{ report_id: 'R01', pending_clear_fields: ['disability'] }]
      }
    });

    const res = (await validateAndCreateApproval(repo, batch, 'actor-1', {
      action: 'approve_save',
      snapshot_id: snapshotId,
      partial_acknowledged: true,
      clear_decisions: {} // Empty decisions for R01.disability
    }));

    assert.equal(res.valid, false);
    assert.equal(res.code, 'INCOMPLETE_CLEAR_DECISIONS');
  });

  test('menolak snapshot yang superseded (telah diperbarui versi baru)', async () => {
    const repo = new SigapRepository(':memory:');
    const session = repo.createSession();
    const batch = repo.createBatch({
      sessionId: session.session_id,
      requestId: 'req-4',
      contextId: 'posko-1',
      sourceSha256: 'hash',
      sourceLength: 10,
      filteredText: 'test',
      piiSummary: {}
    });

    repo.saveSnapshot({
      snapshotId,
      snapshotSha256,
      batchId: batch.batch_id,
      version: 1,
      qualityStatus: 'LOLOS_PEMERIKSAAN',
      payload: { records: [] }
    });

    const newSnapshotId = '2222222222abcdef2222222222abcdef';
    repo.supersedePreviousSnapshots(batch.batch_id, newSnapshotId);

    const res = (await validateAndCreateApproval(repo, batch, 'actor-1', {
      action: 'approve_save',
      snapshot_id: snapshotId,
      partial_acknowledged: true,
      clear_decisions: {}
    }));

    assert.equal(res.valid, false);
    assert.equal(res.code, 'SNAPSHOT_SUPERSEDED');
  });

  test('persetujuan hanya dapat dikonsumsi satu kali (mencegah klik ganda / replay write)', async () => {
    const repo = new SigapRepository(':memory:');
    const session = repo.createSession();
    const batch = repo.createBatch({
      sessionId: session.session_id,
      requestId: 'req-5',
      contextId: 'posko-1',
      sourceSha256: 'hash',
      sourceLength: 10,
      filteredText: 'test',
      piiSummary: {}
    });

    repo.saveSnapshot({
      snapshotId,
      snapshotSha256,
      batchId: batch.batch_id,
      version: 1,
      qualityStatus: 'LOLOS_PEMERIKSAAN',
      payload: { records: [] }
    });

    const approvalRes = (await validateAndCreateApproval(repo, batch, 'actor-1', {
      action: 'approve_save',
      snapshot_id: snapshotId,
      partial_acknowledged: true,
      clear_decisions: {}
    }));
    assert.equal(approvalRes.valid, true);

    // First write execution: should allow
    const firstCheck = (await verifyToolExecutionAgainstGate(repo, batch.batch_id, 'upsert_shelter', buildApprovedWritePayload(approvalRes.approval!)));
    assert.equal(firstCheck.allow, true);

    // Second write execution with same snapshot: MUST be rejected
    const secondCheck = (await verifyToolExecutionAgainstGate(repo, batch.batch_id, 'upsert_shelter', buildApprovedWritePayload(approvalRes.approval!)));
    assert.equal(secondCheck.allow, false);
    assert.ok(secondCheck.reason?.includes('Ditolak'));
  });
});
