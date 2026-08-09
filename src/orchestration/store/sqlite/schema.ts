import { Database } from "bun:sqlite";

const SCHEMA_VERSION = 1;

export function configureExecutionSqlite(
  db: Database,
  busyTimeoutMs: number,
): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
}

export function initializeExecutionSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      schema_version INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projection_checkpoints (
      projector_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      processed_through_sequence INTEGER NOT NULL CHECK (processed_through_sequence >= 0),
      PRIMARY KEY (projector_id, run_id)
    );

    CREATE TABLE IF NOT EXISTS projection_batches (
      projector_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      source_sequence INTEGER NOT NULL CHECK (source_sequence >= 0),
      source_operation_id TEXT NOT NULL,
      graph_id TEXT NOT NULL,
      graph_version TEXT NOT NULL,
      effects_json TEXT NOT NULL,
      PRIMARY KEY (projector_id, run_id, source_sequence)
    );

    CREATE TABLE IF NOT EXISTS executions (
      execution_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      graph_id TEXT NOT NULL,
      graph_version TEXT NOT NULL,
      node_id TEXT NOT NULL,
      source_journal_sequence INTEGER NOT NULL CHECK (source_journal_sequence >= 0),
      source_operation_id TEXT NOT NULL,
      attempt INTEGER NOT NULL CHECK (attempt >= 1),
      intent_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDING','CLAIMED','RUNNING','SUCCEEDED','FAILED')),
      lease_id TEXT,
      worker_id TEXT,
      claimed_at TEXT,
      expires_at TEXT,
      executor_ref TEXT,
      terminal_result_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_executions_pending
      ON executions(status, source_journal_sequence, execution_id);

    CREATE INDEX IF NOT EXISTS idx_executions_recoverable
      ON executions(status, expires_at, execution_id);
  `);

  const meta = db
    .query("SELECT schema_version FROM schema_meta WHERE singleton = 1")
    .get() as { schema_version: number } | null | undefined;

  if (meta === null || meta === undefined) {
    db.query("INSERT INTO schema_meta (singleton, schema_version) VALUES (1, ?)").run(
      SCHEMA_VERSION,
    );
    return;
  }

  if (Number(meta.schema_version) !== SCHEMA_VERSION) {
    throw new Error(`Unsupported SQLite execution-store schema version: ${meta.schema_version}`);
  }
}
