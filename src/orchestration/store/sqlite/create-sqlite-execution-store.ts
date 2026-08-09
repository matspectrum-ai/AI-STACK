import { Database } from "bun:sqlite";
import type {
  ClaimExecutionRequest,
  ClaimExecutionResult,
  ExecutionId,
  ExecutionIntent,
  ExecutionResult,
  GetCheckpointResult,
  MarkRunningRequest,
  MarkRunningResult,
  OrchestrationFailureCode,
  ProjectJournalEntryRequest,
  ProjectJournalEntryResult,
  ProjectionCheckpoint,
  RecordExecutionResultRequest,
  RecordExecutionResultResult,
  StoredExecution,
} from "../../../../contracts/execution";
import type { ListRecoverableRequest } from "../../../../contracts/execution-store";
import type {
  ClosableExecutionStore,
  SqliteExecutionStoreOptions,
} from "../../../../contracts/sqlite-execution-store";
import type { JournalSequence } from "../../../../contracts/persistence";
import {
  asExecutorReference,
  asLease,
  decodeIntent,
  decodeResult,
  encodeIntent,
  encodeIntentEffects,
  encodeResult,
  isExecutionStatus,
  isIsoTimestamp,
  type StoredExecutionRow,
  validateIntentAgainstRow,
} from "./codec";
import {
  configureExecutionSqlite,
  initializeExecutionSchema,
} from "./schema";

interface CheckpointRow {
  readonly projector_id: string;
  readonly run_id: string;
  readonly processed_through_sequence: number;
}

interface ProjectionBatchRow {
  readonly projector_id: string;
  readonly run_id: string;
  readonly source_sequence: number;
  readonly source_operation_id: string;
  readonly graph_id: string;
  readonly graph_version: string;
  readonly effects_json: string;
}

function integrity(code: OrchestrationFailureCode) {
  return { status: "INTEGRITY_ERROR" as const, code };
}

function assertOptions(options: SqliteExecutionStoreOptions): void {
  if (
    typeof options.databasePath !== "string" ||
    options.databasePath.length === 0 ||
    options.databasePath === ":memory:"
  ) {
    throw new Error("SQLite execution store requires a file-backed databasePath");
  }
  if (
    !Number.isFinite(options.busyTimeoutMs) ||
    !Number.isInteger(options.busyTimeoutMs) ||
    options.busyTimeoutMs < 0
  ) {
    throw new Error("busyTimeoutMs must be a finite non-negative integer");
  }
}

function validLimit(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function asSequence(value: number): JournalSequence {
  return value as JournalSequence;
}

function toCheckpoint(row: CheckpointRow): ProjectionCheckpoint {
  return {
    projectorId: row.projector_id as ProjectionCheckpoint["projectorId"],
    runId: row.run_id as ProjectionCheckpoint["runId"],
    processedThroughSequence: asSequence(Number(row.processed_through_sequence)),
  };
}

function readCheckpointRow(
  db: Database,
  projectorId: string,
  runId: string,
): CheckpointRow | undefined {
  const row = db
    .query(
      `SELECT projector_id, run_id, processed_through_sequence
         FROM projection_checkpoints
        WHERE projector_id = ? AND run_id = ?`,
    )
    .get(projectorId, runId) as CheckpointRow | null | undefined;
  return row ?? undefined;
}

function readBatch(
  db: Database,
  projectorId: string,
  runId: string,
  sequence: number,
): ProjectionBatchRow | undefined {
  const row = db
    .query(
      `SELECT projector_id, run_id, source_sequence, source_operation_id,
              graph_id, graph_version, effects_json
         FROM projection_batches
        WHERE projector_id = ? AND run_id = ? AND source_sequence = ?`,
    )
    .get(projectorId, runId, sequence) as ProjectionBatchRow | null | undefined;
  return row ?? undefined;
}

function readExecutionRow(db: Database, executionId: ExecutionId): StoredExecutionRow | undefined {
  const row = db
    .query(
      `SELECT execution_id, run_id, graph_id, graph_version, node_id,
              source_journal_sequence, source_operation_id, attempt, intent_json,
              status, lease_id, worker_id, claimed_at, expires_at,
              executor_ref, terminal_result_json
         FROM executions
        WHERE execution_id = ?`,
    )
    .get(executionId) as StoredExecutionRow | null | undefined;
  return row ?? undefined;
}

function mapExecutionRow(row: StoredExecutionRow): StoredExecution {
  const intent = decodeIntent(row.intent_json);
  if (!validateIntentAgainstRow(intent, row)) {
    throw new Error("MALFORMED_ORCHESTRATION_STATE");
  }
  if (!isExecutionStatus(row.status)) {
    throw new Error("MALFORMED_ORCHESTRATION_STATE");
  }

  const leaseValue = asLease(row);
  if (
    leaseValue !== undefined &&
    Date.parse(leaseValue.expiresAt) <= Date.parse(leaseValue.claimedAt)
  ) {
    throw new Error("MALFORMED_ORCHESTRATION_STATE");
  }

  const executorRef = asExecutorReference(row.executor_ref);
  const terminalResult =
    row.terminal_result_json === null ? undefined : decodeResult(row.terminal_result_json);

  if (terminalResult !== undefined && terminalResult.executionId !== intent.executionId) {
    throw new Error("MALFORMED_ORCHESTRATION_STATE");
  }
  if (row.status === "PENDING" && leaseValue !== undefined) {
    throw new Error("MALFORMED_ORCHESTRATION_STATE");
  }
  if ((row.status === "CLAIMED" || row.status === "RUNNING") && leaseValue === undefined) {
    throw new Error("MALFORMED_ORCHESTRATION_STATE");
  }
  if (row.status === "RUNNING" && executorRef === undefined) {
    throw new Error("MALFORMED_ORCHESTRATION_STATE");
  }
  if (row.status === "SUCCEEDED" || row.status === "FAILED") {
    if (terminalResult === undefined || terminalResult.outcome !== row.status) {
      throw new Error("MALFORMED_ORCHESTRATION_STATE");
    }
  } else if (terminalResult !== undefined) {
    throw new Error("MALFORMED_ORCHESTRATION_STATE");
  }

  return {
    intent,
    status: row.status,
    ...(leaseValue !== undefined ? { lease: leaseValue } : {}),
    ...(executorRef !== undefined ? { executorRef } : {}),
    ...(terminalResult !== undefined ? { terminalResult } : {}),
  };
}

function validateProjectionRequest(
  request: ProjectJournalEntryRequest,
): OrchestrationFailureCode | undefined {
  const sequence = Number(request.entry.sequence);
  if (!Number.isInteger(sequence) || sequence < 0) return "PROJECTION_INTEGRITY_FAILURE";
  if (
    request.graph.graphId !== request.entry.graphId ||
    request.graph.graphVersion !== request.entry.graphVersion
  ) {
    return "PROJECTION_INTEGRITY_FAILURE";
  }

  for (const intent of request.derivedIntents) {
    if (
      intent.runId !== request.entry.runId ||
      intent.graphId !== request.entry.graphId ||
      intent.graphVersion !== request.entry.graphVersion ||
      Number(intent.sourceJournalSequence) !== sequence ||
      intent.sourceOperationId !== request.entry.operationId ||
      intent.status !== "PENDING" ||
      !Number.isInteger(intent.attempt) ||
      intent.attempt < 1 ||
      !isIsoTimestamp(intent.createdAt)
    ) {
      return "PROJECTION_INTEGRITY_FAILURE";
    }
  }
  return undefined;
}

function leaseIsValid(request: ClaimExecutionRequest): boolean {
  const { lease, now } = request;
  return (
    lease.leaseId.length > 0 &&
    lease.workerId.length > 0 &&
    isIsoTimestamp(lease.claimedAt) &&
    isIsoTimestamp(lease.expiresAt) &&
    isIsoTimestamp(now) &&
    Date.parse(lease.expiresAt) > Date.parse(lease.claimedAt) &&
    Date.parse(now) >= Date.parse(lease.claimedAt) &&
    Date.parse(now) < Date.parse(lease.expiresAt)
  );
}

function sameTerminalResult(a: ExecutionResult, b: ExecutionResult): boolean {
  return encodeResult(a) === encodeResult(b);
}

export async function createSqliteExecutionStore(
  options: SqliteExecutionStoreOptions,
): Promise<ClosableExecutionStore> {
  assertOptions(options);

  const db = new Database(options.databasePath, {
    create: true,
    readwrite: true,
    strict: true,
    safeIntegers: false,
  });
  configureExecutionSqlite(db, options.busyTimeoutMs);
  initializeExecutionSchema(db);

  let closed = false;
  const ensureOpen = (): void => {
    if (closed) throw new Error("SQLite execution store is closed");
  };

  const projectTransaction = db.transaction(
    (request: ProjectJournalEntryRequest): ProjectJournalEntryResult => {
      const validationError = validateProjectionRequest(request);
      if (validationError) return integrity(validationError);

      const sequence = Number(request.entry.sequence);
      const projectorId = request.projectorId;
      const runId = request.entry.runId;
      const effectsJson = encodeIntentEffects(request.derivedIntents);
      const existingBatch = readBatch(db, projectorId, runId, sequence);

      if (existingBatch) {
        if (
          existingBatch.source_operation_id !== request.entry.operationId ||
          existingBatch.graph_id !== request.entry.graphId ||
          existingBatch.graph_version !== request.entry.graphVersion ||
          existingBatch.effects_json !== effectsJson
        ) {
          return integrity("EXECUTION_INTENT_CONFLICT");
        }
        for (const intent of request.derivedIntents) {
          const existing = readExecutionRow(db, intent.executionId);
          if (!existing || existing.intent_json !== encodeIntent(intent)) {
            return integrity("EXECUTION_INTENT_CONFLICT");
          }
        }
        const checkpointRow = readCheckpointRow(db, projectorId, runId);
        if (!checkpointRow || Number(checkpointRow.processed_through_sequence) < sequence) {
          return integrity("PROJECTION_INTEGRITY_FAILURE");
        }
        return {
          status: "REPLAYED",
          checkpoint: toCheckpoint(checkpointRow),
          executionIds: request.derivedIntents.map((intent) => intent.executionId),
        };
      }

      const checkpointRow = readCheckpointRow(db, projectorId, runId);
      if (!checkpointRow) {
        if (sequence !== 0 || request.expectedCheckpoint !== undefined) {
          return { status: "CHECKPOINT_CONFLICT" };
        }
      } else {
        const current = Number(checkpointRow.processed_through_sequence);
        if (
          sequence !== current + 1 ||
          request.expectedCheckpoint === undefined ||
          Number(request.expectedCheckpoint) !== current
        ) {
          return {
            status: "CHECKPOINT_CONFLICT",
            currentCheckpoint: toCheckpoint(checkpointRow),
          };
        }
      }

      for (const intent of request.derivedIntents) {
        const existing = readExecutionRow(db, intent.executionId);
        if (existing) return integrity("EXECUTION_INTENT_CONFLICT");
      }

      for (const intent of request.derivedIntents) {
        db.query(
          `INSERT INTO executions
             (execution_id, run_id, graph_id, graph_version, node_id,
              source_journal_sequence, source_operation_id, attempt,
              intent_json, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        ).run(
          intent.executionId,
          intent.runId,
          intent.graphId,
          intent.graphVersion,
          intent.nodeId,
          Number(intent.sourceJournalSequence),
          intent.sourceOperationId,
          intent.attempt,
          encodeIntent(intent),
        );
      }

      db.query(
        `INSERT INTO projection_batches
           (projector_id, run_id, source_sequence, source_operation_id,
            graph_id, graph_version, effects_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        projectorId,
        runId,
        sequence,
        request.entry.operationId,
        request.entry.graphId,
        request.entry.graphVersion,
        effectsJson,
      );

      if (!checkpointRow) {
        db.query(
          `INSERT INTO projection_checkpoints
             (projector_id, run_id, processed_through_sequence)
           VALUES (?, ?, ?)`,
        ).run(projectorId, runId, sequence);
      } else {
        db.query(
          `UPDATE projection_checkpoints
              SET processed_through_sequence = ?
            WHERE projector_id = ? AND run_id = ?`,
        ).run(sequence, projectorId, runId);
      }

      const checkpoint: ProjectionCheckpoint = {
        projectorId,
        runId,
        processedThroughSequence: asSequence(sequence),
      };
      return {
        status: "PROJECTED",
        checkpoint,
        executionIds: request.derivedIntents.map((intent) => intent.executionId),
      };
    },
  );

  const claimTransaction = db.transaction(
    (request: ClaimExecutionRequest): ClaimExecutionResult => {
      if (!leaseIsValid(request)) return integrity("INVALID_EXECUTION_TRANSITION");
      const row = readExecutionRow(db, request.executionId);
      if (!row) return { status: "NOT_FOUND" };
      const current = mapExecutionRow(row);

      if (current.status === "SUCCEEDED" || current.status === "FAILED") {
        return integrity("INVALID_EXECUTION_TRANSITION");
      }
      if (current.lease !== undefined) {
        if (Date.parse(current.lease.expiresAt) > Date.parse(request.now)) {
          return { status: "CLAIM_CONFLICT", currentLease: current.lease };
        }
      } else if (current.status !== "PENDING") {
        return integrity("INVALID_EXECUTION_TRANSITION");
      }

      db.query(
        `UPDATE executions
            SET status = 'CLAIMED',
                lease_id = ?, worker_id = ?, claimed_at = ?, expires_at = ?
          WHERE execution_id = ?`,
      ).run(
        request.lease.leaseId,
        request.lease.workerId,
        request.lease.claimedAt,
        request.lease.expiresAt,
        request.executionId,
      );

      const updated = readExecutionRow(db, request.executionId);
      if (!updated) return integrity("INVALID_EXECUTION_TRANSITION");
      return { status: "CLAIMED", execution: mapExecutionRow(updated) };
    },
  );

  const markRunningTransaction = db.transaction(
    (request: MarkRunningRequest): MarkRunningResult => {
      if (!isIsoTimestamp(request.now) || request.executorRef.length === 0) {
        return integrity("INVALID_EXECUTION_TRANSITION");
      }
      const row = readExecutionRow(db, request.executionId);
      if (!row) return { status: "NOT_FOUND" };
      const current = mapExecutionRow(row);
      if (current.status !== "CLAIMED" || current.lease === undefined) {
        return integrity("INVALID_EXECUTION_TRANSITION");
      }
      if (current.lease.leaseId !== request.leaseId) return { status: "STALE_LEASE" };
      if (Date.parse(request.now) >= Date.parse(current.lease.expiresAt)) {
        return { status: "LEASE_EXPIRED" };
      }

      db.query(
        `UPDATE executions
            SET status = 'RUNNING', executor_ref = ?
          WHERE execution_id = ?`,
      ).run(request.executorRef, request.executionId);
      const updated = readExecutionRow(db, request.executionId);
      if (!updated) return integrity("INVALID_EXECUTION_TRANSITION");
      return { status: "RUNNING", execution: mapExecutionRow(updated) };
    },
  );

  const recordResultTransaction = db.transaction(
    (request: RecordExecutionResultRequest): RecordExecutionResultResult => {
      if (!isIsoTimestamp(request.now) || request.result.executionId !== request.executionId) {
        return integrity("INVALID_EXECUTION_TRANSITION");
      }
      const row = readExecutionRow(db, request.executionId);
      if (!row) return { status: "NOT_FOUND" };
      const current = mapExecutionRow(row);

      if (current.status === "SUCCEEDED" || current.status === "FAILED") {
        if (
          current.terminalResult !== undefined &&
          sameTerminalResult(current.terminalResult, request.result)
        ) {
          return { status: "REPLAYED", execution: current };
        }
        return { status: "RESULT_CONFLICT" };
      }

      if (
        (current.status !== "RUNNING" && current.status !== "CLAIMED") ||
        current.lease === undefined
      ) {
        return integrity("INVALID_EXECUTION_TRANSITION");
      }
      if (current.lease.leaseId !== request.leaseId) return { status: "STALE_LEASE" };
      if (Date.parse(request.now) >= Date.parse(current.lease.expiresAt)) {
        return { status: "LEASE_EXPIRED" };
      }

      db.query(
        `UPDATE executions
            SET status = ?, terminal_result_json = ?
          WHERE execution_id = ?`,
      ).run(request.result.outcome, encodeResult(request.result), request.executionId);
      const updated = readExecutionRow(db, request.executionId);
      if (!updated) return integrity("INVALID_EXECUTION_TRANSITION");
      return { status: "RECORDED", execution: mapExecutionRow(updated) };
    },
  );

  return {
    async projectJournalEntry(request) {
      ensureOpen();
      return projectTransaction.immediate(request) as ProjectJournalEntryResult;
    },

    async getCheckpoint(request): Promise<GetCheckpointResult> {
      ensureOpen();
      const row = readCheckpointRow(db, request.projectorId, request.runId);
      return row === undefined
        ? { status: "NOT_FOUND" }
        : { status: "FOUND", checkpoint: toCheckpoint(row) };
    },

    async getExecution(executionId): Promise<StoredExecution | undefined> {
      ensureOpen();
      const row = readExecutionRow(db, executionId);
      return row === undefined ? undefined : mapExecutionRow(row);
    },

    async listPending(request): Promise<readonly StoredExecution[]> {
      ensureOpen();
      if (!validLimit(request.limit)) throw new Error("limit must be a positive integer");
      const rows = db
        .query(
          `SELECT execution_id, run_id, graph_id, graph_version, node_id,
                  source_journal_sequence, source_operation_id, attempt, intent_json,
                  status, lease_id, worker_id, claimed_at, expires_at,
                  executor_ref, terminal_result_json
             FROM executions
            WHERE status = 'PENDING'
            ORDER BY source_journal_sequence ASC, execution_id ASC
            LIMIT ?`,
        )
        .all(request.limit) as StoredExecutionRow[];
      return rows.map(mapExecutionRow);
    },

    async listRecoverable(request: ListRecoverableRequest): Promise<readonly StoredExecution[]> {
      ensureOpen();
      if (!validLimit(request.limit) || !isIsoTimestamp(request.now)) {
        throw new Error("invalid recoverable query");
      }
      const rows = db
        .query(
          `SELECT execution_id, run_id, graph_id, graph_version, node_id,
                  source_journal_sequence, source_operation_id, attempt, intent_json,
                  status, lease_id, worker_id, claimed_at, expires_at,
                  executor_ref, terminal_result_json
             FROM executions
            WHERE status IN ('CLAIMED','RUNNING')
            ORDER BY execution_id ASC`,
        )
        .all() as StoredExecutionRow[];
      return rows
        .map(mapExecutionRow)
        .filter(
          (execution) =>
            execution.lease !== undefined &&
            Date.parse(execution.lease.expiresAt) <= Date.parse(request.now),
        )
        .slice(0, request.limit);
    },

    async claim(request) {
      ensureOpen();
      return claimTransaction.immediate(request) as ClaimExecutionResult;
    },

    async markRunning(request) {
      ensureOpen();
      return markRunningTransaction.immediate(request) as MarkRunningResult;
    },

    async recordResult(request) {
      ensureOpen();
      return recordResultTransaction.immediate(request) as RecordExecutionResultResult;
    },

    async close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
