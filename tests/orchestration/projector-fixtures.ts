import type {
  ApprovalId,
  ArtifactId,
  ContentDigest,
  EdgeId,
  EvidenceId,
  FailureId,
  FailureRecord,
  GateId,
  GraphId,
  NodeId,
  PolicyId,
  RetryPolicyId,
  RunId,
  StateRevision,
  TransitionDecision,
  TransitionId,
} from "../../contracts/domain";
import type {
  ExecutionGraphDefinition,
  ExecutionNodeDefinition,
} from "../../contracts/execution";
import type {
  JournalEntry,
  JournalSequence,
  OperationId,
} from "../../contracts/persistence";

export const asGraphId = (value: string) => value as GraphId;
export const asRunId = (value: string) => value as RunId;
export const asNodeId = (value: string) => value as NodeId;
export const asEdgeId = (value: string) => value as EdgeId;
export const asGateId = (value: string) => value as GateId;
export const asPolicyId = (value: string) => value as PolicyId;
export const asArtifactId = (value: string) => value as ArtifactId;
export const asEvidenceId = (value: string) => value as EvidenceId;
export const asApprovalId = (value: string) => value as ApprovalId;
export const asFailureId = (value: string) => value as FailureId;
export const asTransitionId = (value: string) => value as TransitionId;
export const asOperationId = (value: string) => value as OperationId;
export const asSequence = (value: number) => value as JournalSequence;
export const asRevision = (value: number) => value as StateRevision;
export const asDigest = (value: string) => value as ContentDigest;
export const asRetryPolicyId = (value: string) => value as RetryPolicyId;

export const IDS = {
  graph: asGraphId("graph:orchestration"),
  run: asRunId("run:orchestration"),
  source: asNodeId("node:source"),
  dispatch: asNodeId("node:dispatch"),
  control: asNodeId("node:control"),
  retry: asNodeId("node:retry"),
  recovery: asNodeId("node:recovery"),
  transitionEdge: asEdgeId("edge:source-dispatch"),
  controlEdge: asEdgeId("edge:source-control"),
  executorPolicy: asPolicyId("policy:executor"),
  transition: asTransitionId("transition:1"),
  artifact: asArtifactId("artifact:input"),
  evidence: asEvidenceId("evidence:input"),
  approval: asApprovalId("approval:input"),
  failure: asFailureId("failure:input"),
  retryPolicy: asRetryPolicyId("retry:policy"),
} as const;

export function node(
  nodeId: NodeId,
  executionMode: "control" | "dispatch",
  overrides: Partial<ExecutionNodeDefinition> = {},
): ExecutionNodeDefinition {
  return {
    nodeId,
    kind: "implementation",
    executionMode,
    requiredArtifactKinds: [],
    requiredGateIds: [],
    outputContracts: [],
    ...overrides,
  };
}

export function graph(
  overrides: Partial<ExecutionGraphDefinition> = {},
): ExecutionGraphDefinition {
  return {
    graphId: IDS.graph,
    graphVersion: "1",
    nodes: [
      node(IDS.source, "control"),
      node(IDS.dispatch, "dispatch", { executorPolicyId: IDS.executorPolicy }),
      node(IDS.control, "control"),
      node(IDS.retry, "dispatch"),
      node(IDS.recovery, "dispatch"),
    ],
    edges: [
      {
        edgeId: IDS.transitionEdge,
        fromNodeId: IDS.source,
        toNodeId: IDS.dispatch,
        kind: "forward",
        gateIds: [],
        policyIds: [],
      },
      {
        edgeId: IDS.controlEdge,
        fromNodeId: IDS.source,
        toNodeId: IDS.control,
        kind: "forward",
        gateIds: [],
        policyIds: [],
      },
    ],
    entryNodeIds: [IDS.source, IDS.retry, IDS.recovery],
    terminalNodeIds: [IDS.dispatch, IDS.control],
    ...overrides,
  };
}

export function transitionDecision(
  edgeId: EdgeId = IDS.transitionEdge,
  overrides: Partial<TransitionDecision> = {},
): TransitionDecision {
  return {
    transitionId: IDS.transition,
    runId: IDS.run,
    graphId: IDS.graph,
    graphVersion: "1",
    edgeId,
    decision: "ALLOW",
    reasonCodes: [],
    evaluatedGateResults: [],
    evaluatedPolicyResults: [],
    boundArtifactIds: [IDS.artifact],
    boundApprovalIds: [IDS.approval],
    boundEvidenceIds: [IDS.evidence],
    evaluatedStateRevision: asRevision(0),
    stateRevisionBefore: asRevision(0),
    stateRevisionAfter: asRevision(1),
    ...overrides,
  };
}

export function journalEntry(
  operation: JournalEntry["operation"],
  overrides: Partial<JournalEntry> = {},
): JournalEntry {
  return {
    sequence: asSequence(1),
    operationId: asOperationId("op:1"),
    operationDigest: asDigest("sha256:op:1"),
    runId: IDS.run,
    resultingStateRevision: asRevision(1),
    graphId: IDS.graph,
    graphVersion: "1",
    operation,
    committedAt: "2026-08-09T06:00:00.000Z",
    ...overrides,
  };
}

export function transitionEntry(
  edgeId: EdgeId = IDS.transitionEdge,
  overrides: Partial<JournalEntry> = {},
): JournalEntry {
  return journalEntry(
    { kind: "transition_committed", decision: transitionDecision(edgeId) },
    overrides,
  );
}

export function retryEntry(
  nextAttempt = 2,
  activationNodeId: NodeId = IDS.retry,
): JournalEntry {
  return journalEntry({
    kind: "retry_activated",
    governingFailureId: IDS.failure,
    retryPolicyId: IDS.retryPolicy,
    retryCounterKey: "implementation",
    nextAttempt,
    activationNodeId,
  });
}

export function recoveryEntry(
  recoveryNodeId: NodeId = IDS.recovery,
): JournalEntry {
  return journalEntry({
    kind: "recovery_activated",
    governingFailureId: IDS.failure,
    recoveryEdgeId: asEdgeId("edge:recovery"),
    recoveryNodeId,
  });
}

export function runCreatedEntry(): JournalEntry {
  return journalEntry(
    { kind: "run_created" },
    { sequence: asSequence(0), resultingStateRevision: asRevision(0) },
  );
}

export function failureEntry(): JournalEntry {
  const failure: FailureRecord = {
    failureId: IDS.failure,
    failureClass: "EXECUTION_FAILURE",
    subjectRef: IDS.dispatch,
    reasonCode: "GATE_FAILED",
    retryability: "RETRYABLE",
    evidenceIds: [],
    observedAt: "2026-08-09T06:00:00.000Z",
  };
  return journalEntry({ kind: "failure_recorded", failure });
}
