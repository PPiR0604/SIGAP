import { DatabaseSync } from 'node:sqlite';

export function initDatabase(db: DatabaseSync): void {
  // Pragma setups
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      context_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS batches (
      batch_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      request_id TEXT NOT NULL UNIQUE,
      context_id TEXT NOT NULL,
      status TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      source_length INTEGER NOT NULL,
      filtered_text TEXT,
      pii_summary_json TEXT,
      latest_snapshot_id TEXT,
      latest_snapshot_sha256 TEXT,
      quality_status TEXT,
      preview_payload_json TEXT,
      gap_payload_json TEXT,
      bulletin_payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      batch_id TEXT,
      request_id TEXT,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id, event_id);

    CREATE TABLE IF NOT EXISTS snapshots (
      snapshot_id TEXT PRIMARY KEY,
      snapshot_sha256 TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      quality_status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      superseded_by TEXT,
      FOREIGN KEY (batch_id) REFERENCES batches(batch_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS approvals (
      approval_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      snapshot_sha256 TEXT NOT NULL,
      partial_scope_json TEXT,
      clear_decisions_json TEXT,
      status TEXT NOT NULL, -- pending, consumed, expired, revoked
      created_at TEXT NOT NULL,
      consumed_at TEXT,
      FOREIGN KEY (batch_id) REFERENCES batches(batch_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      resource_id TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
}
