import type {
  ApprovalId,
  ArtifactId,
  EvidenceId,
  GraphId,
  NodeId,
  RunId,
} from "../../contracts/domain";
import type {
  ExecutionId,
  ExecutionResult,
  ExecutionResultReference,
  ExecutorStartRequest,
} from "../../contracts/execution";
import type { ExecutionLaunchSpec } from "../../contracts/execution-launch";
import type {
  OmpStructuredTerminalOutput,
  PrepareOmpExecutionRequest,
} from "../../contracts/omp-executor";

export const IDS = {
  execution: "execution:omp:1" as ExecutionId,
  run: "run:omp:1" as RunId,
  graph: "graph:omp" as GraphId,
  node: "node:implementation" as NodeId,
  artifact: "artifact:spec" as ArtifactId,
  evidence: "evidence:red" as EvidenceId,
  approval: "approval:review" as ApprovalId,
} as const;

export const TIMES = {
  prepared: "2026-08-09T08:00:00.000Z",
  active: "2026-08-09T08:00:01.000Z",
  settled: "2026-08-09T08:00:02.000Z",
  interrupted: "2026-08-09T08:00:03.000Z",
} as const;

export function startRequest(
  overrides: Partial<ExecutorStartRequest> = {},
): ExecutorStartRequest {
  return {
    executionId: IDS.execution,
    runId: IDS.run,
    graphId: IDS.graph,
    graphVersion: "1",
    nodeId: IDS.node,
    attempt: 1,
    boundArtifactIds: [IDS.artifact],
    boundEvidenceIds: [IDS.evidence],
    boundApprovalIds: [IDS.approval],
    ...overrides,
  };
}

export function launchSpec(
  overrides: Partial<ExecutionLaunchSpec> = {},
): ExecutionLaunchSpec {
  return {
    executionId: IDS.execution,
    runId: IDS.run,
    graphId: IDS.graph,
    graphVersion: "1",
    nodeId: IDS.node,
    attempt: 1,
    boundArtifactIds: [IDS.artifact],
    boundEvidenceIds: [IDS.evidence],
    boundApprovalIds: [IDS.approval],
    workspace: {
      cwd: "/workspace/ai-stack-execution",
      additionalDirectories: ["/workspace/shared-contracts"],
    },
    instruction: "Implement the contracted change and return structured evidence.",
    model: {
      selector: "openai/gpt-5.6",
      reasoningProfile: "high",
    },
    tools: {
      mode: "ALLOWLIST",
      toolNames: ["read", "write", "bash"],
    },
    output: {
      mode: "STRUCTURED",
      schemaRef: "schema://ai-stack/execution-result/v1",
      jsonSchema: {
        type: "object",
        required: ["summary"],
        properties: {
          summary: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    deadlineEpochMs: 1_800_000_000_000,
    ...overrides,
  };
}

export function prepareRequest(
  overrides: Partial<PrepareOmpExecutionRequest> = {},
): PrepareOmpExecutionRequest {
  return {
    executionId: IDS.execution,
    launchSpec: launchSpec(),
    sessionId: "omp-session-1",
    sessionFile: "/var/lib/ai-stack/omp/execution-1/session.jsonl",
    preparedAt: TIMES.prepared,
    ...overrides,
  };
}

export function executionResult(
  outcome: "SUCCEEDED" | "FAILED" = "SUCCEEDED",
  suffix = "1",
): ExecutionResult {
  return {
    executionId: IDS.execution,
    outcome,
    resultRef: `omp-result:${suffix}` as ExecutionResultReference,
    ...(outcome === "FAILED" ? { errorCode: `OMP_FAILED_${suffix}` } : {}),
    completedAt: TIMES.settled,
  };
}

export function terminalOutput(
  overrides: Partial<OmpStructuredTerminalOutput> = {},
): OmpStructuredTerminalOutput {
  return {
    schemaRef: launchSpec().output.schemaRef,
    value: { summary: "Completed" },
    ...overrides,
  };
}
