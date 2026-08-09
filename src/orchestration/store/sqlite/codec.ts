import type {
  ExecutionId,
  ExecutionIntent,
  ExecutionResult,
  ExecutionResultReference,
  ProjectorId,
  WorkerId,
  LeaseId,
  ExecutorReference,
  ExecutionStatus,
} from "../../../../contracts/execution";
import type {
  ApprovalId,
  ArtifactId,
  EvidenceId,
  GraphId,
  NodeId,
  PolicyId,
  RunId,
} from "../../../../contracts/domain";
import type {
  JournalSequence,
  OperationId,
} from "../../../../contracts/persistence";

interface Envelope {
  readonly schemaVersion: 1;
  readonly payload: unknown;
}

export interface StoredExecutionRow {
  readonly execution_id: string;
  readonly run_id: string;
  readonly graph_id: string;
  readonly graph_version: string;
  readonly node_id: string;
  readonly source_journal_sequence: number;
  readonly source_operation_id: string;
  readonly attempt: number;
  readonly intent_json: string;
  readonly status: string;
  readonly lease_id: string | null;
  readonly worker_id: string | null;
  readonly claimed_at: string | null;
  readonly expires_at: string | null;
  readonly executor_ref: string | null;
  readonly terminal_result_json: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function parseEnvelope(raw: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("MALFORMED_ORCHESTRATION_STATE");
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !("payload" in parsed)) {
    throw new Error("MALFORMED_ORCHESTRATION_STATE");
  }
  return (parsed as unknown as Envelope).payload;
}

export function encodeEnvelope(payload: unknown): string {
  return JSON.stringify({ schemaVersion: 1, payload });
}

function normalizeIntent(intent: ExecutionIntent) {
  return {
    executionId: intent.executionId,
    runId: intent.runId,
    graphId: intent.graphId,
    graphVersion: intent.graphVersion,
    nodeId: intent.nodeId,
    sourceJournalSequence: Number(intent.sourceJournalSequence),
    sourceOperationId: intent.sourceOperationId,
    attempt: intent.attempt,
    status: "PENDING" as const,
    boundArtifactIds: [...intent.boundArtifactIds],
    boundEvidenceIds: [...intent.boundEvidenceIds],
    boundApprovalIds: [...intent.boundApprovalIds],
    ...(intent.executorPolicyId !== undefined
      ? { executorPolicyId: intent.executorPolicyId }
      : {}),
    createdAt: intent.createdAt,
  };
}

export function encodeIntent(intent: ExecutionIntent): string {
  return encodeEnvelope(normalizeIntent(intent));
}

export function encodeIntentEffects(intents: readonly ExecutionIntent[]): string {
  return encodeEnvelope(intents.map(normalizeIntent));
}

export function decodeIntent(raw: string): ExecutionIntent {
  const value = parseEnvelope(raw);
  if (!isRecord(value)) throw new Error("MALFORMED_ORCHESTRATION_STATE");
  if (!isNonEmptyString(value.executionId)) throw new Error("MALFORMED_ORCHESTRATION_STATE");
  if (!isNonEmptyString(value.runId)) throw new Error("MALFORMED_ORCHESTRATION_STATE");
  if (!isNonEmptyString(value.graphId)) throw new Error("MALFORMED_ORCHESTRATION_STATE");
  if (!isNonEmptyString(value.graphVersion)) throw new Error("MALFORMED_ORCHESTRATION_STATE");
  if (!isNonEmptyString(value.nodeId)) throw new Error("MALFORMED_ORCHESTRATION_STATE");
  if (!isNonNegativeInteger(value.sourceJournalSequence)) throw new Error("MALFORMED_ORCHESTRATION_STATE");
  if (!isNonEmptyString(value.sourceOperationId)) throw new Error("MALFORMED_ORCHESTRATION_STATE");
  if (!isPositiveInteger(value.attempt)) throw new Error("MALFORMED_ORCHESTRATION_STATE");
  if (value.status !== "PENDING") throw new Error("MALFORMED_ORCHESTRATION_STATE");
  if (!isStringArray(value.boundArtifactIds)) throw new Error("MALFORMED_ORCHESTRATION_STATE");
  if (!isStringArray(value.boundEvidenceIds)) throw new Error("MALFORMED_ORCHESTRATION_STATE");
  if (!isStringArray(value.boundApprovalIds)) throw new Error("MALFORMED_ORCHESTRATION_STATE");
  if (value.executorPolicyId !== undefined && !isNonEmptyString(value.executorPolicyId)) {
    throw new Error("MALFORMED_ORCHESTRATION_STATE");
  }
  if (!isIsoTimestamp(value.createdAt)) throw new Error("MALFORMED_ORCHESTRATION_STATE");

  return {
    executionId: value.executionId as ExecutionId,
    runId: value.runId as RunId,
    graphId: value.graphId as GraphId,
    graphVersion: value.graphVersion,
    nodeId: value.nodeId as NodeId,
    sourceJournalSequence: value.sourceJournalSequence as JournalSequence,
    sourceOperationId: value.sourceOperationId as OperationId,
    attempt: value.attempt,
    status: "PENDING",
    boundArtifactIds: value.boundArtifactIds as ArtifactId[],
    boundEvidenceIds: value.boundEvidenceIds as EvidenceId[],
    boundApprovalIds: value.boundApprovalIds as ApprovalId[],
    ...(value.executorPolicyId !== undefined
      ? { executorPolicyId: value.executorPolicyId as PolicyId }
      : {}),
    createdAt: value.createdAt,
  };
}

export function encodeResult(result: ExecutionResult): string {
  const payload = {
    executionId: result.executionId,
    outcome: result.outcome,
    ...(result.resultRef !== undefined ? { resultRef: result.resultRef } : {}),
    ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
    completedAt: result.completedAt,
  };
  return encodeEnvelope(payload);
}

export function decodeResult(raw: string): ExecutionResult {
  const value = parseEnvelope(raw);
  if (!isRecord(value)) throw new Error("MALFORMED_ORCHESTRATION_STATE");
  if (!isNonEmptyString(value.executionId)) throw new Error("MALFORMED_ORCHESTRATION_STATE");
  if (value.outcome !== "SUCCEEDED" && value.outcome !== "FAILED") {
    throw new Error("MALFORMED_ORCHESTRATION_STATE");
  }
  if (value.resultRef !== undefined && !isNonEmptyString(value.resultRef)) {
    throw new Error("MALFORMED_ORCHESTRATION_STATE");
  }
  if (value.errorCode !== undefined && !isNonEmptyString(value.errorCode)) {
    throw new Error("MALFORMED_ORCHESTRATION_STATE");
  }
  if (!isIsoTimestamp(value.completedAt)) throw new Error("MALFORMED_ORCHESTRATION_STATE");

  return {
    executionId: value.executionId as ExecutionId,
    outcome: value.outcome,
    ...(value.resultRef !== undefined
      ? { resultRef: value.resultRef as ExecutionResultReference }
      : {}),
    ...(value.errorCode !== undefined ? { errorCode: value.errorCode } : {}),
    completedAt: value.completedAt,
  };
}

export function validateIntentAgainstRow(
  intent: ExecutionIntent,
  row: StoredExecutionRow,
): boolean {
  return (
    intent.executionId === row.execution_id &&
    intent.runId === row.run_id &&
    intent.graphId === row.graph_id &&
    intent.graphVersion === row.graph_version &&
    intent.nodeId === row.node_id &&
    Number(intent.sourceJournalSequence) === Number(row.source_journal_sequence) &&
    intent.sourceOperationId === row.source_operation_id &&
    intent.attempt === Number(row.attempt)
  );
}

export function isExecutionStatus(value: string): value is ExecutionStatus {
  return ["PENDING", "CLAIMED", "RUNNING", "SUCCEEDED", "FAILED"].includes(value);
}

export function asLease(value: {
  lease_id: string | null;
  worker_id: string | null;
  claimed_at: string | null;
  expires_at: string | null;
}) {
  if (
    value.lease_id === null &&
    value.worker_id === null &&
    value.claimed_at === null &&
    value.expires_at === null
  ) {
    return undefined;
  }
  if (
    !isNonEmptyString(value.lease_id) ||
    !isNonEmptyString(value.worker_id) ||
    !isIsoTimestamp(value.claimed_at) ||
    !isIsoTimestamp(value.expires_at)
  ) {
    throw new Error("MALFORMED_ORCHESTRATION_STATE");
  }
  return {
    leaseId: value.lease_id as LeaseId,
    workerId: value.worker_id as WorkerId,
    claimedAt: value.claimed_at,
    expiresAt: value.expires_at,
  };
}

export function asExecutorReference(value: string | null): ExecutorReference | undefined {
  if (value === null) return undefined;
  if (!isNonEmptyString(value)) throw new Error("MALFORMED_ORCHESTRATION_STATE");
  return value as ExecutorReference;
}

export function asProjectorId(value: string): ProjectorId {
  return value as ProjectorId;
}
