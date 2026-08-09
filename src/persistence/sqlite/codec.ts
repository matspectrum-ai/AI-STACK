import type {
  ApprovalId,
  ArtifactId,
  EvidenceId,
  FailureId,
  FailureRecord,
  GraphId,
  GraphRunState,
  NodeExecutionId,
  NodeId,
  ReasonCode,
  RunId,
  StateRevision,
  TransitionDecision,
  TransitionId,
} from "../../../contracts/domain";
import type {
  JournalOperation,
  JournalSequence,
} from "../../../contracts/persistence";

interface Envelope {
  readonly schemaVersion: 1;
  readonly payload: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseEnvelope(raw: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("MALFORMED_PERSISTED_STATE");
  }

  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !("payload" in parsed)) {
    throw new Error("MALFORMED_PERSISTED_STATE");
  }

  return (parsed as unknown as Envelope).payload;
}

export function encodeEnvelope(payload: unknown): string {
  return JSON.stringify({ schemaVersion: 1, payload });
}

export function decodeGraphRunState(raw: string): GraphRunState {
  const value = parseEnvelope(raw);
  if (!isRecord(value)) throw new Error("MALFORMED_PERSISTED_STATE");

  const requiredStrings = ["runId", "graphId", "graphVersion"] as const;
  if (requiredStrings.some((key) => typeof value[key] !== "string" || value[key] === "")) {
    throw new Error("MALFORMED_PERSISTED_STATE");
  }
  if (!isNonNegativeInteger(value.revision)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (!isStringArray(value.activeNodeIds)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (!isStringArray(value.completedExecutionIds)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (!isStringArray(value.artifactRefs)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (!isStringArray(value.evidenceRefs)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (!isStringArray(value.approvalRefs)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (!isStringArray(value.failureRefs)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (!isRecord(value.retryCounters)) throw new Error("MALFORMED_PERSISTED_STATE");

  const retryCounters: Record<string, number> = {};
  for (const [key, counter] of Object.entries(value.retryCounters)) {
    if (!isNonNegativeInteger(counter)) throw new Error("MALFORMED_PERSISTED_STATE");
    retryCounters[key] = counter;
  }

  if (
    value.lastTransitionId !== undefined &&
    (typeof value.lastTransitionId !== "string" || value.lastTransitionId === "")
  ) {
    throw new Error("MALFORMED_PERSISTED_STATE");
  }

  return {
    runId: value.runId as RunId,
    graphId: value.graphId as GraphId,
    graphVersion: value.graphVersion,
    revision: value.revision as StateRevision,
    activeNodeIds: value.activeNodeIds as NodeId[],
    completedExecutionIds: value.completedExecutionIds as NodeExecutionId[],
    artifactRefs: value.artifactRefs as ArtifactId[],
    evidenceRefs: value.evidenceRefs as EvidenceId[],
    approvalRefs: value.approvalRefs as ApprovalId[],
    failureRefs: value.failureRefs as FailureId[],
    retryCounters,
    ...(value.lastTransitionId !== undefined
      ? { lastTransitionId: value.lastTransitionId as TransitionId }
      : {}),
  };
}

const TRANSITION_OUTCOMES = new Set(["ALLOW", "DENY", "PAUSE"]);
const EVIDENCE_STATUSES = new Set(["UNVERIFIED", "VALID", "INVALID", "EXPIRED"]);
const FAILURE_CLASSES = new Set([
  "EXECUTION_FAILURE",
  "CONTRACT_VIOLATION",
  "GATE_FAILURE",
  "POLICY_DENIAL",
  "EVIDENCE_INVALID",
  "TIMEOUT",
  "RESOURCE_FAILURE",
  "INTERNAL_ERROR",
]);
const RETRYABILITY = new Set(["RETRYABLE", "NON_RETRYABLE", "POLICY_DEPENDENT"]);

function decodeTransitionDecisionValue(value: unknown): TransitionDecision {
  if (!isRecord(value)) throw new Error("MALFORMED_PERSISTED_STATE");
  const requiredStringKeys = [
    "transitionId",
    "runId",
    "graphId",
    "graphVersion",
    "edgeId",
    "decision",
  ] as const;
  if (requiredStringKeys.some((key) => typeof value[key] !== "string" || value[key] === "")) {
    throw new Error("MALFORMED_PERSISTED_STATE");
  }
  if (!TRANSITION_OUTCOMES.has(value.decision as string)) {
    throw new Error("MALFORMED_PERSISTED_STATE");
  }
  if (!isStringArray(value.reasonCodes)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (!Array.isArray(value.evaluatedGateResults)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (!Array.isArray(value.evaluatedPolicyResults)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (!isStringArray(value.boundArtifactIds)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (!isStringArray(value.boundApprovalIds)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (!isStringArray(value.boundEvidenceIds)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (!isNonNegativeInteger(value.evaluatedStateRevision)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (!isNonNegativeInteger(value.stateRevisionBefore)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (value.stateRevisionAfter !== undefined && !isNonNegativeInteger(value.stateRevisionAfter)) {
    throw new Error("MALFORMED_PERSISTED_STATE");
  }

  return value as unknown as TransitionDecision;
}

function decodeFailureRecordValue(value: unknown): FailureRecord {
  if (!isRecord(value)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (typeof value.failureId !== "string" || value.failureId === "") {
    throw new Error("MALFORMED_PERSISTED_STATE");
  }
  if (typeof value.failureClass !== "string" || !FAILURE_CLASSES.has(value.failureClass)) {
    throw new Error("MALFORMED_PERSISTED_STATE");
  }
  if (typeof value.subjectRef !== "string" || value.subjectRef === "") {
    throw new Error("MALFORMED_PERSISTED_STATE");
  }
  if (typeof value.reasonCode !== "string" || value.reasonCode === "") {
    throw new Error("MALFORMED_PERSISTED_STATE");
  }
  if (typeof value.retryability !== "string" || !RETRYABILITY.has(value.retryability)) {
    throw new Error("MALFORMED_PERSISTED_STATE");
  }
  if (!isStringArray(value.evidenceIds)) throw new Error("MALFORMED_PERSISTED_STATE");
  if (typeof value.observedAt !== "string" || Number.isNaN(Date.parse(value.observedAt))) {
    throw new Error("MALFORMED_PERSISTED_STATE");
  }
  return value as unknown as FailureRecord;
}

export function decodeJournalOperation(raw: string): JournalOperation {
  const value = parseEnvelope(raw);
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error("MALFORMED_PERSISTED_STATE");
  }

  switch (value.kind) {
    case "run_created":
      return { kind: "run_created" };
    case "transition_committed":
      return {
        kind: "transition_committed",
        decision: decodeTransitionDecisionValue(value.decision),
      };
    case "failure_recorded":
      return {
        kind: "failure_recorded",
        failure: decodeFailureRecordValue(value.failure),
      };
    case "retry_activated": {
      if (
        typeof value.governingFailureId !== "string" ||
        typeof value.retryPolicyId !== "string" ||
        typeof value.retryCounterKey !== "string" ||
        !isNonNegativeInteger(value.nextAttempt) ||
        value.nextAttempt < 1 ||
        typeof value.activationNodeId !== "string"
      ) {
        throw new Error("MALFORMED_PERSISTED_STATE");
      }
      return value as unknown as JournalOperation;
    }
    case "recovery_activated": {
      if (
        typeof value.governingFailureId !== "string" ||
        typeof value.recoveryEdgeId !== "string" ||
        typeof value.recoveryNodeId !== "string"
      ) {
        throw new Error("MALFORMED_PERSISTED_STATE");
      }
      return value as unknown as JournalOperation;
    }
    default:
      throw new Error("MALFORMED_PERSISTED_STATE");
  }
}

export function decodeJournalSequence(value: unknown): JournalSequence {
  if (!isNonNegativeInteger(value)) throw new Error("MALFORMED_PERSISTED_STATE");
  return value as JournalSequence;
}
