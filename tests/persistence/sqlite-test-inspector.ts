import { Database } from "bun:sqlite";
import type { RunId } from "../../contracts/domain";
import type { JournalSequence, OperationId } from "../../contracts/persistence";

function withDatabase<T>(databasePath: string, action: (db: Database) => T): T {
  const db = new Database(databasePath, { create: false, strict: true });
  try {
    return action(db);
  } finally {
    db.close();
  }
}

export function overwriteSnapshotJson(
  databasePath: string,
  runId: RunId,
  rawJson: string,
): void {
  withDatabase(databasePath, (db) => {
    db.query("UPDATE runs SET snapshot_json = ? WHERE run_id = ?").run(rawJson, runId);
  });
}

export function overwriteRunRevision(
  databasePath: string,
  runId: RunId,
  revision: number,
): void {
  withDatabase(databasePath, (db) => {
    db.query("UPDATE runs SET state_revision = ? WHERE run_id = ?").run(revision, runId);
  });
}

export function overwriteRunGraphId(
  databasePath: string,
  runId: RunId,
  graphId: string,
): void {
  withDatabase(databasePath, (db) => {
    db.query("UPDATE runs SET graph_id = ? WHERE run_id = ?").run(graphId, runId);
  });
}

export function deleteJournalEntry(
  databasePath: string,
  runId: RunId,
  sequence: JournalSequence,
): void {
  withDatabase(databasePath, (db) => {
    db.exec("PRAGMA foreign_keys = OFF");
    db.query("DELETE FROM journal WHERE run_id = ? AND sequence = ?").run(runId, sequence);
  });
}

export function overwriteJournalGraphId(
  databasePath: string,
  runId: RunId,
  sequence: JournalSequence,
  graphId: string,
): void {
  withDatabase(databasePath, (db) => {
    db.query(
      "UPDATE journal SET graph_id = ? WHERE run_id = ? AND sequence = ?",
    ).run(graphId, runId, sequence);
  });
}

export function overwriteIdempotencyDigest(
  databasePath: string,
  operationId: OperationId,
  digest: string,
): void {
  withDatabase(databasePath, (db) => {
    db.query(
      "UPDATE idempotency SET operation_digest = ? WHERE operation_id = ?",
    ).run(digest, operationId);
  });
}

export function overwriteIdempotencyReceipt(
  databasePath: string,
  operationId: OperationId,
  stateRevision: number,
  journalSequence: number,
): void {
  withDatabase(databasePath, (db) => {
    db.query(
      "UPDATE idempotency SET state_revision = ?, journal_sequence = ? WHERE operation_id = ?",
    ).run(stateRevision, journalSequence, operationId);
  });
}

export function readRawCounts(databasePath: string): {
  runs: number;
  journal: number;
  idempotency: number;
} {
  return withDatabase(databasePath, (db) => {
    const count = (table: "runs" | "journal" | "idempotency"): number => {
      const row = db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count: number | bigint;
      };
      return Number(row.count);
    };

    return {
      runs: count("runs"),
      journal: count("journal"),
      idempotency: count("idempotency"),
    };
  });
}
