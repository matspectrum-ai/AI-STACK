import { Database } from "bun:sqlite";
import type {
  GraphRunState,
  StateRevision,
} from "../../../contracts/domain";
import type {
  CommitReceipt,
  CommitStateRequest,
  CommitStateResult,
  CreateRunRequest,
  CreateRunResult,
  IntegrityError,
  JournalEntry,
  JournalSequence,
  LoadRunResult,
  OperationId,
  PersistenceIntegrityCode,
  ReadJournalResult,
} from "../../../contracts/persistence";
import type {
  ClosableAuthoritativeStateStore,
  SqliteStateStoreOptions,
} from "../../../contracts/sqlite-persistence";
import {
  decodeGraphRunState,
  decodeJournalOperation,
  encodeEnvelope,
} from "./codec";
import {
  validateCommitStructure,
  validateInitialState,
} from "./validation";

const SCHEMA_VERSION = 1;

interface RunRow {
  readonly run_id: string;
  readonly graph_id: string;
  readonly graph_version: string;
  readonly state_revision: number;
  readonly journal_head_sequence: number;
  readonly snapshot_json: string;
}

interface JournalRow {
  readonly run_id: string;
  readonly sequence: number;
  readonly resulting_state_revision: number;
  readonly operation_id: string;
  readonly operation_digest: string;
  readonly graph_id: string;
  readonly graph_version: string;
  readonly operation_kind: string;
  readonly operation_json: string;
  readonly committed_at: string;
}

interface BindingRow {
  readonly operation_id: string;
  readonly operation_digest: string;
  readonly run_id: string;
  readonly state_revision: number;
  readonly journal_sequence: number;
  readonly journal_operation_id: string | null;
  readonly journal_operation_digest: string | null;
  readonly journal_run_id: string | null;
  readonly journal_revision: number | null;
  readonly journal_sequence_ref: number | null;
}

function integrity(code: PersistenceIntegrityCode): { status: "INTEGRITY_ERROR"; error: IntegrityError } {
  return { status: "INTEGRITY_ERROR", error: { code } };
}

function isFiniteNonNegativeInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function asStateRevision(value: number): StateRevision {
  return value as StateRevision;
}

function asJournalSequence(value: number): JournalSequence {
  return value as JournalSequence;
}

function receipt(
  operationId: OperationId,
  stateRevision: number,
  journalSequence: number,
): CommitReceipt {
  return {
    operationId,
    stateRevision: asStateRevision(stateRevision),
    journalSequence: asJournalSequence(journalSequence),
  };
}

function assertOptions(options: SqliteStateStoreOptions): void {
  if (
    typeof options.databasePath !== "string" ||
    options.databasePath.length === 0 ||
    options.databasePath === ":memory:"
  ) {
    throw new Error("SQLite authoritative state store requires a file-backed databasePath");
  }
  if (
    !Number.isFinite(options.busyTimeoutMs) ||
    !Number.isInteger(options.busyTimeoutMs) ||
    options.busyTimeoutMs < 0
  ) {
    throw new Error("busyTimeoutMs must be a finite non-negative integer");
  }
  if (!options.clock || typeof options.clock.now !== "function") {
    throw new Error("clock.now() is required");
  }
}

function assertTimestamp(value: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("PersistenceClock returned an invalid ISO-8601 timestamp");
  }
  return value;
}

function initializeSchema(db: Database): void {
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

function readRunRow(db: Database, runId: string): RunRow | undefined {
  const row = db
    .query(
      `SELECT run_id, graph_id, graph_version, state_revision,
              journal_head_sequence, snapshot_json
         FROM runs
        WHERE run_id = ?`,
    )
    .get(runId) as RunRow | null | undefined;
  return row ?? undefined;
}

function readJournalRows(db: Database, runId: string): JournalRow[] {
  return db
    .query(
      `SELECT run_id, sequence, resulting_state_revision, operation_id,
              operation_digest, graph_id, graph_version, operation_kind,
              operation_json, committed_at
         FROM journal
        WHERE run_id = ?
        ORDER BY sequence ASC`,
    )
    .all(runId) as JournalRow[];
}

function decodeRunRow(
  row: RunRow,
): { state: GraphRunState } | { error: PersistenceIntegrityCode } {
  let state: GraphRunState;
  try {
    state = decodeGraphRunState(row.snapshot_json);
  } catch {
    return { error: "MALFORMED_PERSISTED_STATE" };
  }

  if (state.runId !== row.run_id) return { error: "MALFORMED_PERSISTED_STATE" };
  if (state.graphId !== row.graph_id || state.graphVersion !== row.graph_version) {
    return { error: "GRAPH_BINDING_MISMATCH" };
  }
  if (Number(state.revision) !== Number(row.state_revision)) {
    return { error: "SNAPSHOT_JOURNAL_REVISION_MISMATCH" };
  }
  if (
    !isFiniteNonNegativeInteger(Number(row.state_revision)) ||
    !isFiniteNonNegativeInteger(Number(row.journal_head_sequence))
  ) {
    return { error: "MALFORMED_PERSISTED_STATE" };
  }

  return { state };
}

function mapJournalRow(
  row: JournalRow,
): JournalEntry | PersistenceIntegrityCode {
  let operation: JournalEntry["operation"];
  try {
    operation = decodeJournalOperation(row.operation_json);
  } catch {
    return "MALFORMED_PERSISTED_STATE";
  }

  if (operation.kind !== row.operation_kind) return "MALFORMED_PERSISTED_STATE";
  if (!isFiniteNonNegativeInteger(Number(row.sequence))) {
    return "MALFORMED_PERSISTED_STATE";
  }
  if (!isFiniteNonNegativeInteger(Number(row.resulting_state_revision))) {
    return "MALFORMED_PERSISTED_STATE";
  }
  if (Number.isNaN(Date.parse(row.committed_at))) {
    return "MALFORMED_PERSISTED_STATE";
  }

  return {
    sequence: asJournalSequence(Number(row.sequence)),
    operationId: row.operation_id as JournalEntry["operationId"],
    operationDigest: row.operation_digest as JournalEntry["operationDigest"],
    runId: row.run_id as JournalEntry["runId"],
    resultingStateRevision: asStateRevision(Number(row.resulting_state_revision)),
    graphId: row.graph_id as JournalEntry["graphId"],
    graphVersion: row.graph_version,
    operation,
    committedAt: row.committed_at,
  };
}

function validateRunJournal(
  db: Database,
  row: RunRow,
): { entries: JournalEntry[] } | { error: PersistenceIntegrityCode } {
  const rawRows = readJournalRows(db, row.run_id);
  const expectedHead = Number(row.journal_head_sequence);

  if (rawRows.length !== expectedHead + 1) {
    return { error: "JOURNAL_SEQUENCE_GAP" };
  }

  const entries: JournalEntry[] = [];
  let previousRevision = -1;
  for (let index = 0; index < rawRows.length; index += 1) {
    const raw = rawRows[index]!;
    if (Number(raw.sequence) !== index) {
      return { error: "JOURNAL_SEQUENCE_GAP" };
    }
    if (raw.run_id !== row.run_id) return { error: "MALFORMED_PERSISTED_STATE" };
    if (raw.graph_id !== row.graph_id || raw.graph_version !== row.graph_version) {
      return { error: "GRAPH_BINDING_MISMATCH" };
    }
    const revision = Number(raw.resulting_state_revision);
    if (revision < previousRevision) {
      return { error: "JOURNAL_REVISION_REGRESSION" };
    }
    previousRevision = revision;

    const mapped = mapJournalRow(raw);
    if (typeof mapped === "string") return { error: mapped };
    entries.push(mapped);
  }

  const head = entries.at(-1);
  if (
    head === undefined ||
    Number(head.sequence) !== expectedHead ||
    Number(head.resultingStateRevision) !== Number(row.state_revision)
  ) {
    return { error: "SNAPSHOT_JOURNAL_REVISION_MISMATCH" };
  }

  return { entries };
}

function validatePersistedRun(
  db: Database,
  row: RunRow,
):
  | { state: GraphRunState; entries: JournalEntry[] }
  | { error: PersistenceIntegrityCode } {
  const decoded = decodeRunRow(row);
  if ("error" in decoded) return decoded;
  const journal = validateRunJournal(db, row);
  if ("error" in journal) return journal;
  return { state: decoded.state, entries: journal.entries };
}

function readBinding(db: Database, operationId: OperationId): BindingRow | undefined {
  const row = db
    .query(
      `SELECT i.operation_id, i.operation_digest, i.run_id,
              i.state_revision, i.journal_sequence,
              j.operation_id AS journal_operation_id,
              j.operation_digest AS journal_operation_digest,
              j.run_id AS journal_run_id,
              j.resulting_state_revision AS journal_revision,
              j.sequence AS journal_sequence_ref
         FROM idempotency i
         LEFT JOIN journal j
           ON j.run_id = i.run_id AND j.sequence = i.journal_sequence
        WHERE i.operation_id = ?`,
    )
    .get(operationId) as BindingRow | null | undefined;
  return row ?? undefined;
}

function validateBinding(
  binding: BindingRow,
): PersistenceIntegrityCode | undefined {
  if (
    binding.journal_operation_id === null ||
    binding.journal_operation_digest === null ||
    binding.journal_run_id === null ||
    binding.journal_revision === null ||
    binding.journal_sequence_ref === null
  ) {
    return "IDEMPOTENCY_BINDING_MISMATCH";
  }

  if (
    binding.operation_id !== binding.journal_operation_id ||
    binding.operation_digest !== binding.journal_operation_digest ||
    binding.run_id !== binding.journal_run_id ||
    Number(binding.state_revision) !== Number(binding.journal_revision) ||
    Number(binding.journal_sequence) !== Number(binding.journal_sequence_ref)
  ) {
    return "IDEMPOTENCY_BINDING_MISMATCH";
  }

  return undefined;
}

function replayOrViolation(
  db: Database,
  operationId: OperationId,
  operationDigest: string,
):
  | { kind: "none" }
  | { kind: "integrity"; code: PersistenceIntegrityCode }
  | { kind: "violation" }
  | { kind: "replay"; receipt: CommitReceipt } {
  const binding = readBinding(db, operationId);
  if (!binding) return { kind: "none" };

  const bindingError = validateBinding(binding);
  if (bindingError) return { kind: "integrity", code: bindingError };
  if (binding.operation_digest !== operationDigest) return { kind: "violation" };

  return {
    kind: "replay",
    receipt: receipt(
      operationId,
      Number(binding.state_revision),
      Number(binding.journal_sequence),
    ),
  };
}

function insertIdempotency(
  db: Database,
  operationId: OperationId,
  operationDigest: string,
  runId: string,
  stateRevision: number,
  journalSequence: number,
): void {
  db.query(
    `INSERT INTO idempotency
       (operation_id, operation_digest, run_id, state_revision, journal_sequence)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(operationId, operationDigest, runId, stateRevision, journalSequence);
}

function insertJournal(
  db: Database,
  values: {
    operationId: OperationId;
    operationDigest: string;
    runId: string;
    sequence: number;
    stateRevision: number;
    graphId: string;
    graphVersion: string;
    operation: JournalEntry["operation"];
    committedAt: string;
  },
): void {
  db.query(
    `INSERT INTO journal
       (run_id, sequence, resulting_state_revision, operation_id,
        operation_digest, graph_id, graph_version, operation_kind,
        operation_json, committed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    values.runId,
    values.sequence,
    values.stateRevision,
    values.operationId,
    values.operationDigest,
    values.graphId,
    values.graphVersion,
    values.operation.kind,
    encodeEnvelope(values.operation),
    values.committedAt,
  );
}

export async function createSqliteAuthoritativeStateStore(
  options: SqliteStateStoreOptions,
): Promise<ClosableAuthoritativeStateStore> {
  assertOptions(options);

  const db = new Database(options.databasePath, {
    create: true,
    readwrite: true,
    strict: true,
    safeIntegers: false,
  });

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs};`);
  initializeSchema(db);

  let closed = false;
  const ensureOpen = (): void => {
    if (closed) throw new Error("SQLite authoritative state store is closed");
  };

  const createTransaction = db.transaction(
    (request: CreateRunRequest): CreateRunResult => {
      const replay = replayOrViolation(
        db,
        request.operationId,
        request.operationDigest,
      );
      if (replay.kind === "integrity") return integrity(replay.code);
      if (replay.kind === "violation") {
        return {
          status: "IDEMPOTENCY_VIOLATION",
          operationId: request.operationId,
        };
      }
      if (replay.kind === "replay") {
        return { status: "REPLAYED", receipt: replay.receipt };
      }

      const initialError = validateInitialState(request.initialState);
      if (initialError) return integrity(initialError);

      if (readRunRow(db, request.initialState.runId)) {
        return {
          status: "RUN_ALREADY_EXISTS",
          runId: request.initialState.runId,
        };
      }

      const committedAt = assertTimestamp(options.clock.now());
      const runId = request.initialState.runId;
      const graphId = request.initialState.graphId;
      const graphVersion = request.initialState.graphVersion;

      db.query(
        `INSERT INTO runs
           (run_id, graph_id, graph_version, state_revision,
            journal_head_sequence, snapshot_json)
         VALUES (?, ?, ?, 0, 0, ?)`,
      ).run(
        runId,
        graphId,
        graphVersion,
        encodeEnvelope(request.initialState),
      );

      insertJournal(db, {
        operationId: request.operationId,
        operationDigest: request.operationDigest,
        runId,
        sequence: 0,
        stateRevision: 0,
        graphId,
        graphVersion,
        operation: { kind: "run_created" },
        committedAt,
      });

      insertIdempotency(
        db,
        request.operationId,
        request.operationDigest,
        runId,
        0,
        0,
      );

      return {
        status: "CREATED",
        receipt: receipt(request.operationId, 0, 0),
      };
    },
  );

  const commitTransaction = db.transaction(
    (request: CommitStateRequest): CommitStateResult => {
      const replay = replayOrViolation(
        db,
        request.operationId,
        request.operationDigest,
      );
      if (replay.kind === "integrity") return integrity(replay.code);
      if (replay.kind === "violation") {
        return {
          status: "IDEMPOTENCY_VIOLATION",
          operationId: request.operationId,
        };
      }
      if (replay.kind === "replay") {
        return { status: "REPLAYED", receipt: replay.receipt };
      }

      const row = readRunRow(db, request.runId);
      if (!row) return { status: "RUN_NOT_FOUND", runId: request.runId };

      const persisted = validatePersistedRun(db, row);
      if ("error" in persisted) return integrity(persisted.error);

      if (Number(request.expectedRevision) !== Number(row.state_revision)) {
        return {
          status: "CONFLICT",
          currentRevision: asStateRevision(Number(row.state_revision)),
        };
      }

      const structureError = validateCommitStructure(request, {
        runId: persisted.state.runId,
        graphId: persisted.state.graphId,
        graphVersion: persisted.state.graphVersion,
        state: persisted.state,
      });
      if (structureError) return integrity(structureError);

      const nextRevision = Number(request.nextState.revision);
      const nextSequence = Number(row.journal_head_sequence) + 1;
      const committedAt = assertTimestamp(options.clock.now());

      const update = db.query(
        `UPDATE runs
            SET state_revision = ?,
                journal_head_sequence = ?,
                snapshot_json = ?
          WHERE run_id = ? AND state_revision = ?`,
      ).run(
        nextRevision,
        nextSequence,
        encodeEnvelope(request.nextState),
        request.runId,
        Number(request.expectedRevision),
      );

      if (Number(update.changes) !== 1) {
        const current = readRunRow(db, request.runId);
        return {
          status: "CONFLICT",
          currentRevision: asStateRevision(Number(current?.state_revision ?? row.state_revision)),
        };
      }

      insertJournal(db, {
        operationId: request.operationId,
        operationDigest: request.operationDigest,
        runId: request.runId,
        sequence: nextSequence,
        stateRevision: nextRevision,
        graphId: row.graph_id,
        graphVersion: row.graph_version,
        operation: request.operation,
        committedAt,
      });

      insertIdempotency(
        db,
        request.operationId,
        request.operationDigest,
        request.runId,
        nextRevision,
        nextSequence,
      );

      return {
        status: "COMMITTED",
        receipt: receipt(request.operationId, nextRevision, nextSequence),
      };
    },
  );

  return {
    async createRun(request) {
      ensureOpen();
      return createTransaction.immediate(request) as CreateRunResult;
    },

    async loadRun(request): Promise<LoadRunResult> {
      ensureOpen();
      const row = readRunRow(db, request.runId);
      if (!row) return { status: "NOT_FOUND", runId: request.runId };

      const persisted = validatePersistedRun(db, row);
      if ("error" in persisted) return integrity(persisted.error);

      return {
        status: "FOUND",
        snapshot: {
          state: persisted.state,
          journalHeadSequence: asJournalSequence(Number(row.journal_head_sequence)),
        },
      };
    },

    async commit(request) {
      ensureOpen();
      return commitTransaction.immediate(request) as CommitStateResult;
    },

    async readJournal(request): Promise<ReadJournalResult> {
      ensureOpen();
      const row = readRunRow(db, request.runId);
      if (!row) return { status: "NOT_FOUND", runId: request.runId };

      const persisted = validatePersistedRun(db, row);
      if ("error" in persisted) return integrity(persisted.error);

      const after = request.afterSequence === undefined
        ? -1
        : Number(request.afterSequence);
      return {
        status: "FOUND",
        entries: persisted.entries.filter((entry) => Number(entry.sequence) > after),
        headSequence: asJournalSequence(Number(row.journal_head_sequence)),
      };
    },

    async close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
