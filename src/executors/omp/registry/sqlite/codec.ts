import type {
  ApprovalId,
  ArtifactId,
  EvidenceId,
  GraphId,
  NodeId,
  RunId,
} from "../../../../../contracts/domain";
import type {
  ExecutionId,
  ExecutionResult,
  ExecutionResultReference,
  ExecutorStartRequest,
} from "../../../../../contracts/execution";
import type {
  ExecutionLaunchSpec,
  ReasoningProfile,
} from "../../../../../contracts/execution-launch";
import type {
  OmpExecutionPhase,
  OmpExecutionRecord,
  OmpStructuredTerminalOutput,
} from "../../../../../contracts/omp-executor";
import { createExecutionLaunchSpecValidator } from "../../../launch/create-execution-launch-spec-validator";

interface Envelope {
  readonly schemaVersion: 1;
  readonly payload: unknown;
}

export interface OmpExecutionRow {
  readonly execution_id: string;
  readonly launch_spec_json: string;
  readonly launch_spec_canonical_json: string;
  readonly session_id: string;
  readonly session_file: string;
  readonly phase: string;
  readonly prepared_at: string;
  readonly activated_at: string | null;
  readonly settled_at: string | null;
  readonly terminal_result_json: string | null;
  readonly terminal_output_json: string | null;
  readonly interruption_reason: string | null;
}

const validator = createExecutionLaunchSpecValidator();
const REASONING = new Set<string>(["minimal", "low", "medium", "high", "max"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmpty);
}

export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function parseEnvelope(raw: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !("payload" in parsed)) {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }
  return (parsed as unknown as Envelope).payload;
}

export function encodeEnvelope(payload: unknown): string {
  return JSON.stringify({ schemaVersion: 1, payload });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
    return out;
  }
  return value;
}

export function canonicalLaunchSpecJson(spec: ExecutionLaunchSpec): string {
  return JSON.stringify(stableValue(spec));
}

function startRequestFromSpec(spec: ExecutionLaunchSpec): ExecutorStartRequest {
  return {
    executionId: spec.executionId,
    runId: spec.runId,
    graphId: spec.graphId,
    graphVersion: spec.graphVersion,
    nodeId: spec.nodeId,
    attempt: spec.attempt,
    boundArtifactIds: [...spec.boundArtifactIds],
    boundEvidenceIds: [...spec.boundEvidenceIds],
    boundApprovalIds: [...spec.boundApprovalIds],
  };
}

export function encodeLaunchSpec(spec: ExecutionLaunchSpec): string {
  return encodeEnvelope(spec);
}

export function decodeLaunchSpec(raw: string): ExecutionLaunchSpec {
  const value = parseEnvelope(raw);
  if (!isRecord(value)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!nonEmpty(value.executionId)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!nonEmpty(value.runId)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!nonEmpty(value.graphId)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!nonEmpty(value.graphVersion)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!nonEmpty(value.nodeId)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (typeof value.attempt !== "number" || !Number.isInteger(value.attempt) || value.attempt < 1) {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }
  if (!stringArray(value.boundArtifactIds)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!stringArray(value.boundEvidenceIds)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!stringArray(value.boundApprovalIds)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!isRecord(value.workspace)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!nonEmpty(value.workspace.cwd)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!stringArray(value.workspace.additionalDirectories)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!nonEmpty(value.instruction)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!isRecord(value.model)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!nonEmpty(value.model.selector)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!nonEmpty(value.model.reasoningProfile) || !REASONING.has(value.model.reasoningProfile)) {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }
  if (!isRecord(value.tools) || value.tools.mode !== "ALLOWLIST") {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }
  if (!stringArray(value.tools.toolNames)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!isRecord(value.output) || value.output.mode !== "STRUCTURED") {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }
  if (!nonEmpty(value.output.schemaRef)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!isRecord(value.output.jsonSchema)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (
    typeof value.deadlineEpochMs !== "number" ||
    !Number.isInteger(value.deadlineEpochMs) ||
    !Number.isFinite(value.deadlineEpochMs) ||
    value.deadlineEpochMs <= 0
  ) {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }

  const spec: ExecutionLaunchSpec = {
    executionId: value.executionId as ExecutionId,
    runId: value.runId as RunId,
    graphId: value.graphId as GraphId,
    graphVersion: value.graphVersion,
    nodeId: value.nodeId as NodeId,
    attempt: value.attempt,
    boundArtifactIds: value.boundArtifactIds as ArtifactId[],
    boundEvidenceIds: value.boundEvidenceIds as EvidenceId[],
    boundApprovalIds: value.boundApprovalIds as ApprovalId[],
    workspace: {
      cwd: value.workspace.cwd,
      additionalDirectories: value.workspace.additionalDirectories,
    },
    instruction: value.instruction,
    model: {
      selector: value.model.selector,
      reasoningProfile: value.model.reasoningProfile as ReasoningProfile,
    },
    tools: {
      mode: "ALLOWLIST",
      toolNames: value.tools.toolNames,
    },
    output: {
      mode: "STRUCTURED",
      schemaRef: value.output.schemaRef,
      jsonSchema: value.output.jsonSchema,
    },
    deadlineEpochMs: value.deadlineEpochMs,
  };

  if (validator.validate(startRequestFromSpec(spec), spec).status !== "VALID") {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }
  return spec;
}

export function encodeExecutionResult(result: ExecutionResult): string {
  return encodeEnvelope(result);
}

export function decodeExecutionResult(raw: string): ExecutionResult {
  const value = parseEnvelope(raw);
  if (!isRecord(value)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (!nonEmpty(value.executionId)) throw new Error("OMP_REGISTRY_CORRUPT");
  if (value.outcome !== "SUCCEEDED" && value.outcome !== "FAILED") {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }
  if (value.resultRef !== undefined && !nonEmpty(value.resultRef)) {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }
  if (value.errorCode !== undefined && !nonEmpty(value.errorCode)) {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }
  if (!isIsoTimestamp(value.completedAt)) throw new Error("OMP_REGISTRY_CORRUPT");
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

export function encodeTerminalOutput(output: OmpStructuredTerminalOutput): string {
  return encodeEnvelope(output);
}

export function decodeTerminalOutput(raw: string): OmpStructuredTerminalOutput {
  const value = parseEnvelope(raw);
  if (!isRecord(value) || !nonEmpty(value.schemaRef) || !("value" in value)) {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }
  return { schemaRef: value.schemaRef, value: value.value };
}

function validPhase(value: string): value is OmpExecutionPhase {
  return ["PREPARED", "ACTIVE", "SUCCEEDED", "FAILED", "INTERRUPTED"].includes(value);
}

export function decodeRecord(row: OmpExecutionRow): OmpExecutionRecord {
  if (!nonEmpty(row.execution_id) || !nonEmpty(row.session_id) || !nonEmpty(row.session_file)) {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }
  if (!validPhase(row.phase) || !isIsoTimestamp(row.prepared_at)) {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }
  const spec = decodeLaunchSpec(row.launch_spec_json);
  if (
    spec.executionId !== row.execution_id ||
    canonicalLaunchSpecJson(spec) !== row.launch_spec_canonical_json
  ) {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }

  const base = {
    executionId: row.execution_id as ExecutionId,
    launchSpec: spec,
    sessionId: row.session_id,
    sessionFile: row.session_file,
    phase: row.phase,
    preparedAt: row.prepared_at,
  } as const;

  if (row.phase === "PREPARED") {
    if (
      row.activated_at !== null || row.settled_at !== null ||
      row.terminal_result_json !== null || row.terminal_output_json !== null ||
      row.interruption_reason !== null
    ) throw new Error("OMP_REGISTRY_CORRUPT");
    return base;
  }

  if (row.phase === "ACTIVE") {
    if (
      !isIsoTimestamp(row.activated_at) ||
      Date.parse(row.activated_at) < Date.parse(row.prepared_at) ||
      row.settled_at !== null || row.terminal_result_json !== null ||
      row.terminal_output_json !== null || row.interruption_reason !== null
    ) throw new Error("OMP_REGISTRY_CORRUPT");
    return { ...base, activatedAt: row.activated_at };
  }

  if (row.phase === "INTERRUPTED") {
    if (
      !isIsoTimestamp(row.settled_at) ||
      Date.parse(row.settled_at) < Date.parse(row.prepared_at) ||
      row.terminal_result_json !== null || row.terminal_output_json !== null ||
      !nonEmpty(row.interruption_reason)
    ) throw new Error("OMP_REGISTRY_CORRUPT");
    if (
      row.activated_at !== null &&
      (!isIsoTimestamp(row.activated_at) || Date.parse(row.activated_at) < Date.parse(row.prepared_at))
    ) throw new Error("OMP_REGISTRY_CORRUPT");
    return {
      ...base,
      ...(row.activated_at !== null ? { activatedAt: row.activated_at } : {}),
      settledAt: row.settled_at,
      interruptionReason: row.interruption_reason,
    };
  }

  if (
    !isIsoTimestamp(row.activated_at) ||
    !isIsoTimestamp(row.settled_at) ||
    Date.parse(row.activated_at) < Date.parse(row.prepared_at) ||
    Date.parse(row.settled_at) < Date.parse(row.activated_at) ||
    row.terminal_result_json === null ||
    row.interruption_reason !== null
  ) throw new Error("OMP_REGISTRY_CORRUPT");

  const result = decodeExecutionResult(row.terminal_result_json);
  if (result.executionId !== row.execution_id || result.outcome !== row.phase) {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }
  const output = row.terminal_output_json === null
    ? undefined
    : decodeTerminalOutput(row.terminal_output_json);
  if (row.phase === "SUCCEEDED" && output === undefined) {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }
  if (output !== undefined && output.schemaRef !== spec.output.schemaRef) {
    throw new Error("OMP_REGISTRY_CORRUPT");
  }

  return {
    ...base,
    activatedAt: row.activated_at,
    settledAt: row.settled_at,
    terminalResult: result,
    ...(output !== undefined ? { terminalOutput: output } : {}),
  };
}
