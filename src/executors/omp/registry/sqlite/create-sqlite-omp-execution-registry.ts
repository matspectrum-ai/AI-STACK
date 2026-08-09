import { isAbsolute, normalize } from "node:path";
import { Database } from "bun:sqlite";
import type {
  GetOmpExecutionResult,
  OmpExecutionRecord,
  OmpStructuredTerminalOutput,
  PrepareOmpExecutionRequest,
  PrepareOmpExecutionResult,
  UpdateOmpExecutionResult,
} from "../../../../../contracts/omp-executor";
import type {
  ClosableOmpExecutionRegistry,
  SqliteOmpExecutionRegistryOptions,
} from "../../../../../contracts/sqlite-omp-execution-registry";
import {
  canonicalLaunchSpecJson,
  decodeRecord,
  encodeExecutionResult,
  encodeLaunchSpec,
  encodeTerminalOutput,
  isIsoTimestamp,
  type OmpExecutionRow,
} from "./codec";
import {
  configureOmpRegistrySqlite,
  initializeOmpRegistrySchema,
} from "./schema";

function assertOptions(options: SqliteOmpExecutionRegistryOptions): void {
  if (
    typeof options.databasePath !== "string" ||
    options.databasePath.length === 0 ||
    options.databasePath === ":memory:"
  ) {
    throw new Error("SQLite OMP registry requires a file-backed databasePath");
  }
  if (
    !Number.isFinite(options.busyTimeoutMs) ||
    !Number.isInteger(options.busyTimeoutMs) ||
    options.busyTimeoutMs < 0
  ) {
    throw new Error("busyTimeoutMs must be a finite non-negative integer");
  }
}

function nonEmpty(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function validAbsoluteNormalizedPath(value: string): boolean {
  return nonEmpty(value) && isAbsolute(value) && normalize(value) === value;
}

function readRow(db: Database, executionId: string): OmpExecutionRow | undefined {
  const row = db
    .query(
      `SELECT execution_id, launch_spec_json, launch_spec_canonical_json,
              session_id, session_file, phase, prepared_at, activated_at,
              settled_at, terminal_result_json, terminal_output_json,
              interruption_reason
         FROM omp_executions
        WHERE execution_id = ?`,
    )
    .get(executionId) as OmpExecutionRow | null | undefined;
  return row ?? undefined;
}

function safeDecode(row: OmpExecutionRow): OmpExecutionRecord | undefined {
  try {
    return decodeRecord(row);
  } catch {
    return undefined;
  }
}

function samePrepare(
  record: OmpExecutionRecord,
  request: PrepareOmpExecutionRequest,
): boolean {
  return (
    record.executionId === request.executionId &&
    record.sessionId === request.sessionId &&
    record.sessionFile === request.sessionFile &&
    record.preparedAt === request.preparedAt &&
    canonicalLaunchSpecJson(record.launchSpec) ===
      canonicalLaunchSpecJson(request.launchSpec)
  );
}

function sameOutput(
  left: OmpStructuredTerminalOutput | undefined,
  right: OmpStructuredTerminalOutput | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return encodeTerminalOutput(left) === encodeTerminalOutput(right);
}

export async function createSqliteOmpExecutionRegistry(
  options: SqliteOmpExecutionRegistryOptions,
): Promise<ClosableOmpExecutionRegistry> {
  assertOptions(options);

  const db = new Database(options.databasePath, {
    create: true,
    readwrite: true,
    strict: true,
    safeIntegers: false,
  });
  configureOmpRegistrySqlite(db, options.busyTimeoutMs);
  initializeOmpRegistrySchema(db);

  let closed = false;
  const ensureOpen = (): void => {
    if (closed) throw new Error("SQLite OMP execution registry is closed");
  };

  const prepareTransaction = db.transaction(
    (request: PrepareOmpExecutionRequest): PrepareOmpExecutionResult => {
      if (
        request.executionId !== request.launchSpec.executionId ||
        !nonEmpty(request.sessionId) ||
        !validAbsoluteNormalizedPath(request.sessionFile) ||
        !isIsoTimestamp(request.preparedAt)
      ) {
        return { status: "INTEGRITY_ERROR" };
      }

      const canonical = canonicalLaunchSpecJson(request.launchSpec);
      const existing = readRow(db, request.executionId);
      if (existing) {
        const record = safeDecode(existing);
        if (!record) return { status: "INTEGRITY_ERROR" };
        return samePrepare(record, request)
          ? { status: "REPLAYED", record }
          : { status: "CONFLICT" };
      }

      // Round-trip through persisted decoder before writing so malformed launch
      // material never becomes a durable PREPARED mapping.
      let encoded: string;
      try {
        encoded = encodeLaunchSpec(request.launchSpec);
        const probeRow: OmpExecutionRow = {
          execution_id: request.executionId,
          launch_spec_json: encoded,
          launch_spec_canonical_json: canonical,
          session_id: request.sessionId,
          session_file: request.sessionFile,
          phase: "PREPARED",
          prepared_at: request.preparedAt,
          activated_at: null,
          settled_at: null,
          terminal_result_json: null,
          terminal_output_json: null,
          interruption_reason: null,
        };
        if (!safeDecode(probeRow)) return { status: "INTEGRITY_ERROR" };
      } catch {
        return { status: "INTEGRITY_ERROR" };
      }

      db.query(
        `INSERT INTO omp_executions
           (execution_id, launch_spec_json, launch_spec_canonical_json,
            session_id, session_file, phase, prepared_at)
         VALUES (?, ?, ?, ?, ?, 'PREPARED', ?)`,
      ).run(
        request.executionId,
        encoded,
        canonical,
        request.sessionId,
        request.sessionFile,
        request.preparedAt,
      );

      const inserted = readRow(db, request.executionId);
      const record = inserted ? safeDecode(inserted) : undefined;
      return record
        ? { status: "PREPARED", record }
        : { status: "INTEGRITY_ERROR" };
    },
  );

  const activeTransaction = db.transaction(
    (executionId: string, activatedAt: string): UpdateOmpExecutionResult => {
      if (!isIsoTimestamp(activatedAt)) return { status: "INTEGRITY_ERROR" };
      const row = readRow(db, executionId);
      if (!row) return { status: "NOT_FOUND" };
      const current = safeDecode(row);
      if (!current) return { status: "INTEGRITY_ERROR" };

      if (current.phase === "ACTIVE") {
        return current.activatedAt === activatedAt
          ? { status: "REPLAYED", record: current }
          : { status: "CONFLICT" };
      }
      if (current.phase !== "PREPARED") return { status: "CONFLICT" };
      if (Date.parse(activatedAt) < Date.parse(current.preparedAt)) {
        return { status: "INTEGRITY_ERROR" };
      }

      db.query(
        `UPDATE omp_executions
            SET phase = 'ACTIVE', activated_at = ?
          WHERE execution_id = ? AND phase = 'PREPARED'`,
      ).run(activatedAt, executionId);

      const updated = readRow(db, executionId);
      const record = updated ? safeDecode(updated) : undefined;
      return record
        ? { status: "UPDATED", record }
        : { status: "INTEGRITY_ERROR" };
    },
  );

  const terminalTransaction = db.transaction(
    (request: Parameters<ClosableOmpExecutionRegistry["markTerminal"]>[0]): UpdateOmpExecutionResult => {
      if (!isIsoTimestamp(request.settledAt)) return { status: "INTEGRITY_ERROR" };
      const row = readRow(db, request.executionId);
      if (!row) return { status: "NOT_FOUND" };
      const current = safeDecode(row);
      if (!current) return { status: "INTEGRITY_ERROR" };

      if (current.phase === "SUCCEEDED" || current.phase === "FAILED") {
        if (
          current.settledAt === request.settledAt &&
          current.terminalResult !== undefined &&
          encodeExecutionResult(current.terminalResult) === encodeExecutionResult(request.result) &&
          sameOutput(current.terminalOutput, request.output)
        ) {
          return { status: "REPLAYED", record: current };
        }
        return { status: "CONFLICT" };
      }
      if (current.phase !== "ACTIVE" || current.activatedAt === undefined) {
        return { status: "CONFLICT" };
      }
      if (
        request.result.executionId !== request.executionId ||
        !isIsoTimestamp(request.result.completedAt) ||
        Date.parse(request.settledAt) < Date.parse(current.activatedAt) ||
        Date.parse(request.result.completedAt) > Date.parse(request.settledAt)
      ) {
        return { status: "INTEGRITY_ERROR" };
      }
      if (request.result.outcome === "SUCCEEDED" && request.output === undefined) {
        return { status: "INTEGRITY_ERROR" };
      }
      if (
        request.output !== undefined &&
        request.output.schemaRef !== current.launchSpec.output.schemaRef
      ) {
        return { status: "INTEGRITY_ERROR" };
      }

      const outputJson = request.output === undefined
        ? null
        : encodeTerminalOutput(request.output);
      db.query(
        `UPDATE omp_executions
            SET phase = ?, settled_at = ?, terminal_result_json = ?,
                terminal_output_json = ?
          WHERE execution_id = ? AND phase = 'ACTIVE'`,
      ).run(
        request.result.outcome,
        request.settledAt,
        encodeExecutionResult(request.result),
        outputJson,
        request.executionId,
      );

      const updated = readRow(db, request.executionId);
      const record = updated ? safeDecode(updated) : undefined;
      return record
        ? { status: "UPDATED", record }
        : { status: "INTEGRITY_ERROR" };
    },
  );

  const interruptTransaction = db.transaction(
    (request: Parameters<ClosableOmpExecutionRegistry["markInterrupted"]>[0]): UpdateOmpExecutionResult => {
      if (!nonEmpty(request.reason) || !isIsoTimestamp(request.observedAt)) {
        return { status: "INTEGRITY_ERROR" };
      }
      const row = readRow(db, request.executionId);
      if (!row) return { status: "NOT_FOUND" };
      const current = safeDecode(row);
      if (!current) return { status: "INTEGRITY_ERROR" };

      if (current.phase === "INTERRUPTED") {
        return current.interruptionReason === request.reason &&
          current.settledAt === request.observedAt
          ? { status: "REPLAYED", record: current }
          : { status: "CONFLICT" };
      }
      if (current.phase === "SUCCEEDED" || current.phase === "FAILED") {
        return { status: "CONFLICT" };
      }
      if (Date.parse(request.observedAt) < Date.parse(current.preparedAt)) {
        return { status: "INTEGRITY_ERROR" };
      }
      if (
        current.activatedAt !== undefined &&
        Date.parse(request.observedAt) < Date.parse(current.activatedAt)
      ) {
        return { status: "INTEGRITY_ERROR" };
      }

      db.query(
        `UPDATE omp_executions
            SET phase = 'INTERRUPTED', settled_at = ?, interruption_reason = ?
          WHERE execution_id = ? AND phase IN ('PREPARED','ACTIVE')`,
      ).run(request.observedAt, request.reason, request.executionId);

      const updated = readRow(db, request.executionId);
      const record = updated ? safeDecode(updated) : undefined;
      return record
        ? { status: "UPDATED", record }
        : { status: "INTEGRITY_ERROR" };
    },
  );

  return {
    async prepare(request) {
      ensureOpen();
      return prepareTransaction.immediate(request) as PrepareOmpExecutionResult;
    },

    async get(executionId): Promise<GetOmpExecutionResult> {
      ensureOpen();
      const row = readRow(db, executionId);
      if (!row) return { status: "NOT_FOUND" };
      const record = safeDecode(row);
      return record
        ? { status: "FOUND", record }
        : { status: "INTEGRITY_ERROR" };
    },

    async markActive(request) {
      ensureOpen();
      return activeTransaction.immediate(
        request.executionId,
        request.activatedAt,
      ) as UpdateOmpExecutionResult;
    },

    async markTerminal(request) {
      ensureOpen();
      return terminalTransaction.immediate(request) as UpdateOmpExecutionResult;
    },

    async markInterrupted(request) {
      ensureOpen();
      return interruptTransaction.immediate(request) as UpdateOmpExecutionResult;
    },

    async close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
