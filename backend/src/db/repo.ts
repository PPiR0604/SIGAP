import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { initDatabase } from './schema.js';

export interface SessionRecord {
  session_id: string;
  context_id: string;
  created_at: string;
  last_active_at: string;
  status: string;
}

export interface BatchRecord {
  batch_id: string;
  session_id: string;
  request_id: string;
  context_id: string;
  status: string;
  source_sha256: string;
  source_length: number;
  filtered_text: string | null;
  pii_summary_json: string | null;
  latest_snapshot_id: string | null;
  latest_snapshot_sha256: string | null;
  quality_status: string | null;
  preview_payload_json: string | null;
  gap_payload_json: string | null;
  bulletin_payload_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventRecord {
  event_id: number;
  session_id: string;
  batch_id: string | null;
  request_id: string | null;
  event_type: string;
  payload_json: string;
  created_at: string;
}

export interface SnapshotRecord {
  snapshot_id: string;
  snapshot_sha256: string;
  batch_id: string;
  version: number;
  quality_status: string;
  payload_json: string;
  created_at: string;
  expires_at: string;
  superseded_by: string | null;
}

export interface ApprovalRecord {
  approval_id: string;
  batch_id: string;
  actor_id: string;
  action: string;
  snapshot_id: string;
  snapshot_sha256: string;
  partial_scope_json: string | null;
  clear_decisions_json: string | null;
  status: 'pending' | 'consumed' | 'expired' | 'revoked';
  created_at: string;
  consumed_at: string | null;
}

export class SigapRepository {
  private db: DatabaseSync;

  constructor(dbPath: string = ':memory:') {
    this.db = new DatabaseSync(dbPath);
    initDatabase(this.db);
  }

  // --- Session ---
  createSession(contextId = 'posko-default'): SessionRecord {
    const sessionId = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO sessions (session_id, context_id, created_at, last_active_at, status)
      VALUES (?, ?, ?, ?, 'active')
    `);
    stmt.run(sessionId, contextId, now, now);
    return {
      session_id: sessionId,
      context_id: contextId,
      created_at: now,
      last_active_at: now,
      status: 'active'
    };
  }

  getSession(sessionId: string): SessionRecord | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE session_id = ?');
    return (stmt.get(sessionId) as any) || null;
  }

  touchSession(sessionId: string): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare('UPDATE sessions SET last_active_at = ? WHERE session_id = ?');
    stmt.run(now, sessionId);
  }

  // --- Batch ---
  getActiveBatch(sessionId: string): BatchRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM batches 
      WHERE session_id = ? AND status IN ('processing', 'saving', 'verifying')
      ORDER BY created_at DESC LIMIT 1
    `);
    return (stmt.get(sessionId) as any) || null;
  }

  countBatches(sessionId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM batches WHERE session_id = ?').get(sessionId) as any;
    return Number(row?.total ?? 0);
  }

  getBatchByRequestId(requestId: string, sessionId: string): BatchRecord | null {
    const stmt = this.db.prepare('SELECT * FROM batches WHERE request_id = ? AND session_id = ?');
    return (stmt.get(`${sessionId}:${requestId}`, sessionId) as any) || null;
  }

  getBatch(batchId: string): BatchRecord | null {
    const stmt = this.db.prepare('SELECT * FROM batches WHERE batch_id = ?');
    return (stmt.get(batchId) as any) || null;
  }

  createBatch(params: {
    sessionId: string;
    requestId: string;
    contextId: string;
    sourceSha256: string;
    sourceLength: number;
    filteredText: string;
    piiSummary: any;
  }): BatchRecord {
    const batchId = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const piiSummaryJson = JSON.stringify(params.piiSummary || {});

    const stmt = this.db.prepare(`
      INSERT INTO batches (
        batch_id, session_id, request_id, context_id, status,
        source_sha256, source_length, filtered_text, pii_summary_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      batchId,
      params.sessionId,
      `${params.sessionId}:${params.requestId}`,
      params.contextId,
      params.sourceSha256,
      params.sourceLength,
      params.filteredText,
      piiSummaryJson,
      now,
      now
    );

    return this.getBatch(batchId)!;
  }

  updateBatchStatus(batchId: string, status: string, extra?: Partial<BatchRecord>): void {
    const now = new Date().toISOString();
    const updates: string[] = ['status = ?', 'updated_at = ?'];
    const values: any[] = [status, now];

    if (extra?.latest_snapshot_id !== undefined) {
      updates.push('latest_snapshot_id = ?');
      values.push(extra.latest_snapshot_id);
    }
    if (extra?.latest_snapshot_sha256 !== undefined) {
      updates.push('latest_snapshot_sha256 = ?');
      values.push(extra.latest_snapshot_sha256);
    }
    if (extra?.quality_status !== undefined) {
      updates.push('quality_status = ?');
      values.push(extra.quality_status);
    }
    if (extra?.preview_payload_json !== undefined) {
      updates.push('preview_payload_json = ?');
      values.push(extra.preview_payload_json);
    }
    if (extra?.gap_payload_json !== undefined) {
      updates.push('gap_payload_json = ?');
      values.push(extra.gap_payload_json);
    }
    if (extra?.bulletin_payload_json !== undefined) {
      updates.push('bulletin_payload_json = ?');
      values.push(extra.bulletin_payload_json);
    }

    values.push(batchId);
    const sql = `UPDATE batches SET ${updates.join(', ')} WHERE batch_id = ?`;
    this.db.prepare(sql).run(...values);
  }

  // --- Events ---
  appendEvent(params: {
    sessionId: string;
    batchId?: string;
    requestId?: string;
    eventType: string;
    payload: any;
  }): EventRecord {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO events (session_id, batch_id, request_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const payloadJson = JSON.stringify(params.payload || {});
    stmt.run(
      params.sessionId,
      params.batchId || null,
      params.requestId || null,
      params.eventType,
      payloadJson,
      now
    );

    const lastIdStmt = this.db.prepare('SELECT last_insert_rowid() as id');
    const row = lastIdStmt.get() as any;
    return {
      event_id: Number(row.id),
      session_id: params.sessionId,
      batch_id: params.batchId || null,
      request_id: params.requestId || null,
      event_type: params.eventType,
      payload_json: payloadJson,
      created_at: now
    };
  }

  getEventsAfter(sessionId: string, afterEventId = 0): EventRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events 
      WHERE session_id = ? AND event_id > ?
      ORDER BY event_id ASC
    `);
    return (stmt.all(sessionId, afterEventId) as any[]) || [];
  }

  // --- Snapshots ---
  saveSnapshot(params: {
    snapshotId: string;
    snapshotSha256: string;
    batchId: string;
    version: number;
    qualityStatus: string;
    payload: any;
    expiresInSeconds?: number;
  }): SnapshotRecord {
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + (params.expiresInSeconds || 86400) * 1000).toISOString();
    const payloadJson = JSON.stringify(params.payload);

    const stmt = this.db.prepare(`
      INSERT INTO snapshots (
        snapshot_id, snapshot_sha256, batch_id, version, quality_status, payload_json, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      params.snapshotId,
      params.snapshotSha256,
      params.batchId,
      params.version,
      params.qualityStatus,
      payloadJson,
      createdAt,
      expiresAt
    );
    this.updateBatchStatus(params.batchId, 'ready_for_review', {
      latest_snapshot_id: params.snapshotId,
      latest_snapshot_sha256: params.snapshotSha256,
      quality_status: params.qualityStatus
    });

    return {
      snapshot_id: params.snapshotId,
      snapshot_sha256: params.snapshotSha256,
      batch_id: params.batchId,
      version: params.version,
      quality_status: params.qualityStatus,
      payload_json: payloadJson,
      created_at: createdAt,
      expires_at: expiresAt,
      superseded_by: null
    };
  }

  getSnapshot(snapshotId: string): SnapshotRecord | null {
    const stmt = this.db.prepare('SELECT * FROM snapshots WHERE snapshot_id = ?');
    return (stmt.get(snapshotId) as any) || null;
  }

  supersedePreviousSnapshots(batchId: string, newSnapshotId: string): void {
    const stmt = this.db.prepare(`
      UPDATE snapshots 
      SET superseded_by = ? 
      WHERE batch_id = ? AND snapshot_id != ? AND superseded_by IS NULL
    `);
    stmt.run(newSnapshotId, batchId, newSnapshotId);

    // Also revoke pending approvals for older snapshots in this batch
    const revokeStmt = this.db.prepare(`
      UPDATE approvals 
      SET status = 'revoked' 
      WHERE batch_id = ? AND snapshot_id != ? AND status = 'pending'
    `);
    revokeStmt.run(batchId, newSnapshotId);
  }

  getReviewSnapshots(sessionId: string): SnapshotRecord[] {
    return this.db.prepare(`SELECT s.* FROM snapshots s JOIN batches b ON b.batch_id = s.batch_id
      WHERE b.session_id = ? AND b.status = 'ready_for_review' AND s.superseded_by IS NULL
        AND s.expires_at > ? ORDER BY s.created_at DESC`).all(sessionId, new Date().toISOString()) as unknown as SnapshotRecord[];
  }

  supersedeSnapshot(snapshotId: string, newSnapshotId: string): void {
    this.db.prepare('UPDATE snapshots SET superseded_by = ? WHERE snapshot_id = ? AND superseded_by IS NULL').run(newSnapshotId, snapshotId);
    this.db.prepare("UPDATE approvals SET status = 'revoked' WHERE snapshot_id = ? AND status = 'pending'").run(snapshotId);
  }

  // --- Approvals ---
  createApproval(params: {
    batchId: string;
    actorId: string;
    action: string;
    snapshotId: string;
    snapshotSha256: string;
    partialScope?: any;
    clearDecisions?: any;
  }): ApprovalRecord {
    const approvalId = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO approvals (
        approval_id, batch_id, actor_id, action, snapshot_id, snapshot_sha256,
        partial_scope_json, clear_decisions_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `);
    stmt.run(
      approvalId,
      params.batchId,
      params.actorId,
      params.action,
      params.snapshotId,
      params.snapshotSha256,
      params.partialScope ? JSON.stringify(params.partialScope) : null,
      params.clearDecisions ? JSON.stringify(params.clearDecisions) : null,
      now
    );

    return {
      approval_id: approvalId,
      batch_id: params.batchId,
      actor_id: params.actorId,
      action: params.action,
      snapshot_id: params.snapshotId,
      snapshot_sha256: params.snapshotSha256,
      partial_scope_json: params.partialScope ? JSON.stringify(params.partialScope) : null,
      clear_decisions_json: params.clearDecisions ? JSON.stringify(params.clearDecisions) : null,
      status: 'pending',
      created_at: now,
      consumed_at: null
    };
  }

  getPendingApprovalForSnapshot(batchId: string, snapshotId: string): ApprovalRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM approvals 
      WHERE batch_id = ? AND snapshot_id = ? AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1
    `);
    return (stmt.get(batchId, snapshotId) as any) || null;
  }

  hasApprovalForSnapshot(batchId: string, snapshotId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM approvals WHERE batch_id = ? AND snapshot_id = ? AND status != 'revoked'").get(batchId, snapshotId);
  }

  revokeApprovals(batchId: string): void {
    this.db.prepare("UPDATE approvals SET status = 'revoked' WHERE batch_id = ? AND status = 'pending'").run(batchId);
  }

  consumeApproval(approvalId: string): boolean {
    const now = new Date().toISOString();
    // Atomic update
    const stmt = this.db.prepare(`
      UPDATE approvals 
      SET status = 'consumed', consumed_at = ?
      WHERE approval_id = ? AND status = 'pending'
    `);
    return stmt.run(now, approvalId).changes === 1;
  }

  // --- Audit ---
  logAudit(eventType: string, actorId: string, resourceId?: string, details?: any): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (event_type, actor_id, resource_id, details_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(eventType, actorId, resourceId || null, details ? JSON.stringify(details) : null, now);
  }

  // --- Retention cleanup ---
  cleanupRetention(retentionDays = 7): number {
    const cutoff = new Date(Date.now() - retentionDays * 86400 * 1000).toISOString();
    const delEvents = this.db.prepare('DELETE FROM events WHERE created_at < ?');
    delEvents.run(cutoff);
    const delBatches = this.db.prepare('DELETE FROM batches WHERE created_at < ?');
    delBatches.run(cutoff);
    return 1;
  }

  close(): void {
    this.db.close();
  }
}
