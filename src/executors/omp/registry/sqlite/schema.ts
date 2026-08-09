import { Database } from "bun:sqlite";

const SCHEMA_VERSION = 1;

export function configureOmpRegistrySqlite(
  db: Database,
  busyTimeoutMs: number,
): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
}

export function initializeOmpRegistrySchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      schema_version INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS omp_executions (
      execution_id TEXT PRIMARY KEY,
      launch_spec_json TEXT NOT NULL,
      launch_spec_canonical_json TEXT NOT NULL,
      session_id TEXT NOT NULL,
      session_file TEXT NOT NULL,
      phase TEXT NOT NULL CHECK (phase IN ('PREPARED','ACTIVE','SUCCEEDED','FAILED','INTERRUPTED')),
      prepared_at TEXT NOT NULL,
      activated_at TEXT,
      settled_at TEXT,
      terminal_result_json TEXT,
      terminal_output_json TEXT,
      interruption_reason TEXT
    );
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
    throw new Error(`Unsupported OMP execution registry schema version: ${meta.schema_version}`);
  }
}
