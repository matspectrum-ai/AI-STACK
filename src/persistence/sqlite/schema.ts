import { Database } from "bun:sqlite";

const SCHEMA_VERSION = 1;

export function configureSqlite(
  db: Database,
  busyTimeoutMs: number,
): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
}

export function initializeSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      schema_version INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      graph_version TEXT NOT NULL,
      state_revision INTEGER NOT NULL CHECK (state_revision >= 0),
      journal_head_sequence INTEGER NOT NULL CHECK (journal_head_sequence >= 0),
      snapshot_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS journal (
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence >= 0),
      resulting_state_revision INTEGER NOT NULL CHECK (resulting_state_revision >= 0),
      operation_id TEXT NOT NULL UNIQUE,
      operation_digest TEXT NOT NULL,
      graph_id TEXT NOT NULL,
      graph_version TEXT NOT NULL,
      operation_kind TEXT NOT NULL,
      operation_json TEXT NOT NULL,
      committed_at TEXT NOT NULL,
      PRIMARY KEY (run_id, sequence),
      FOREIGN KEY (run_id) REFERENCES runs(run_id)
    );

    CREATE TABLE IF NOT EXISTS idempotency (
      operation_id TEXT PRIMARY KEY,
      operation_digest TEXT NOT NULL,
      run_id TEXT NOT NULL,
      state_revision INTEGER NOT NULL CHECK (state_revision >= 0),
      journal_sequence INTEGER NOT NULL CHECK (journal_sequence >= 0),
      FOREIGN KEY (run_id, journal_sequence)
        REFERENCES journal(run_id, sequence)
    );
  `);

  const meta = db.query("SELECT schema_version FROM schema_meta WHERE singleton = 1").get() as
    | { schema_version: number }
    | null
    | undefined;

  if (meta === null || meta === undefined) {
    db.query("INSERT INTO schema_meta (singleton, schema_version) VALUES (1, ?)").run(
      SCHEMA_VERSION,
    );
    return;
  }

  if (Number(meta.schema_version) !== SCHEMA_VERSION) {
    throw new Error(`Unsupported SQLite schema version: ${meta.schema_version}`);
  }
}
