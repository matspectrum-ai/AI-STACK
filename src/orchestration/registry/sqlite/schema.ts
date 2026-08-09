import { Database } from "bun:sqlite";

const SCHEMA_VERSION = 1;

export function configureGraphRegistrySqlite(
  db: Database,
  busyTimeoutMs: number,
): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
}

export function initializeGraphRegistrySchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      schema_version INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graph_definitions (
      graph_id TEXT NOT NULL,
      graph_version TEXT NOT NULL,
      canonical_json TEXT NOT NULL,
      definition_json TEXT NOT NULL,
      PRIMARY KEY (graph_id, graph_version)
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
    throw new Error(`Unsupported graph registry schema version: ${meta.schema_version}`);
  }
}
