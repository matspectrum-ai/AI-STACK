import type {
  ApprovalId,
  ApprovalPresentGateDefinition,
  ApprovalRecord,
  ArtifactId,
  ArtifactKind,
  ArtifactRecord,
  ContentDigest,
  EdgeId,
  EvidenceId,
  EvidenceRecord,
  ExecutorId,
  FailureId,
  FailureRecord,
  GateId,
  GateResult,
  GraphDefinition,
  GraphId,
  GraphRunState,
  NodeExecutionId,
  NodeId,
  PolicyId,
  PolicyResult,
  RetryPolicy,
  RetryPolicyId,
  StateRevision,
  TransitionEvaluationContext,
  TransitionRequest,
} from "../../contracts/domain";

export const asGraphId = (value: string) => value as GraphId;
export const asNodeId = (value: string) => value as NodeId;
export const asEdgeId = (value: string) => value as EdgeId;
export const asGateId = (value: string) => value as GateId;
export const asPolicyId = (value: string) => value as PolicyId;
export const asArtifactId = (value: string) => value as ArtifactId;
export const asEvidenceId = (value: string) => value as EvidenceId;
export const asExecutorId = (value: string) => value as ExecutorId;
export const asApprovalId = (value: string) => value as ApprovalId;
export const asFailureId = (value: string) => value as FailureId;
export const asExecutionId = (value: string) => value as NodeExecutionId;
export const asRetryPolicyId = (value: string) => value as RetryPolicyId;
export const asDigest = (value: string) => value as ContentDigest;
export const asRevision = (value: number) => value as StateRevision;

export const IDS = {
  graph: asGraphId("graph:test"),
  redNode: asNodeId("node:red"),
  implementationNode: asNodeId("node:implementation"),
  releaseNode: asNodeId("node:release"),
  verificationNode: asNodeId("node:verification"),
  redToImplementation: asEdgeId("edge:red-to-implementation"),
  verificationToRelease: asEdgeId("edge:verification-to-release"),
  redGate: asGateId("gate:red"),
  verificationGate: asGateId("gate:verification"),
  approvalGate: asGateId("gate:approval"),
  policy: asPolicyId("policy:executor"),
  requester: asExecutorId("executor:requester"),
  worker: asExecutorId("executor:worker"),
  reviewer: asExecutorId("executor:reviewer"),
  spec: asArtifactId("artifact:spec"),
  contract: asArtifactId("artifact:contract"),
  test: asArtifactId("artifact:test"),
  verification: asEvidenceId("evidence:verification"),
  redEvidence: asEvidenceId("evidence:red"),
  approval: asApprovalId("approval:review"),
} as const;

export function artifact(
  artifactId: ArtifactId,
  artifactKind: ArtifactKind,
  parentArtifactIds: readonly ArtifactId[] = [],
): ArtifactRecord {
  return {
    artifactId,
    artifactKind,
    artifactVersion: "1",
    contentRef: `memory://${artifactId}`,
    contentDigest: asDigest(`sha256:${artifactId}`),
    producerExecutionId: asExecutionId(`execution:${artifactId}`),
    parentArtifactIds,
  };
}

export function evidence(
  evidenceId: EvidenceId,
  evidenceType: string,
  subjectRef: string,
  verificationStatus: EvidenceRecord["verificationStatus"] = "VALID",
): EvidenceRecord {
  return {
    evidenceId,
    evidenceType,
    producerExecutorId: IDS.worker,
    subjectRef,
    observedAt: "2026-08-09T04:00:00.000Z",
    payloadRef: `memory://${evidenceId}`,
    payloadDigest: asDigest(`sha256:${evidenceId}`),
    verificationStatus,
    verifierRef: "test-verifier",
  };
}

export function approval(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    approvalId: IDS.approval,
    approverExecutorId: IDS.reviewer,
    subjectRef: IDS.spec,
    action: "approve",
    scope: "specification",
    grantedAt: "2026-08-09T04:00:00.000Z",
    requiredByPolicyId: IDS.policy,
    ...overrides,
  };
}

export function state(overrides: Partial<GraphRunState> = {}): GraphRunState {
  return {
    runId: "run:test" as GraphRunState["runId"],
    graphId: IDS.graph,
    graphVersion: "1",
    revision: asRevision(1),
    activeNodeIds: [IDS.redNode],
    completedExecutionIds: [],
    artifactRefs: [],
    evidenceRefs: [],
    approvalRefs: [],
    failureRefs: [],
    retryCounters: {},
    ...overrides,
  };
}

export function graph(overrides: Partial<GraphDefinition> = {}): GraphDefinition {
  return {
    graphId: IDS.graph,
    graphVersion: "1",
    nodes: [
      {
        nodeId: IDS.redNode,
        kind: "red_verification",
        requiredArtifactKinds: [],
        requiredGateIds: [],
        outputContracts: [],
      },
      {
        nodeId: IDS.implementationNode,
        kind: "implementation",
        requiredArtifactKinds: ["specification", "contract"],
        requiredGateIds: [IDS.redGate],
        outputContracts: [],
      },
      {
        nodeId: IDS.verificationNode,
        kind: "verification",
        requiredArtifactKinds: [],
        requiredGateIds: [],
        outputContracts: [],
      },
      {
        nodeId: IDS.releaseNode,
        kind: "release",
        requiredArtifactKinds: [],
        requiredGateIds: [IDS.verificationGate],
        outputContracts: [],
      },
    ],
    edges: [
      {
        edgeId: IDS.redToImplementation,
        fromNodeId: IDS.redNode,
        toNodeId: IDS.implementationNode,
        kind: "forward",
        gateIds: [IDS.redGate],
        policyIds: [],
      },
      {
        edgeId: IDS.verificationToRelease,
        fromNodeId: IDS.verificationNode,
        toNodeId: IDS.releaseNode,
        kind: "forward",
        gateIds: [IDS.verificationGate],
        policyIds: [],
      },
    ],
    entryNodeIds: [IDS.redNode, IDS.verificationNode],
    terminalNodeIds: [IDS.implementationNode, IDS.releaseNode],
    ...overrides,
  };
}

export function gateResult(
  gateId: GateId,
  outcome: GateResult["outcome"] = "PASS",
  reasonCodes: GateResult["reasonCodes"] = [],
): GateResult {
  return {
    gateId,
    outcome,
    reasonCodes,
    evaluatedInputRefs: [],
    boundArtifactIds: [],
    boundEvidenceIds: [],
    boundApprovalIds: [],
  };
}

export function policyResult(
  outcome: PolicyResult["outcome"] = "ALLOW",
  reasonCodes: PolicyResult["reasonCodes"] = [],
): PolicyResult {
  return {
    policyId: IDS.policy,
    policyVersion: "1",
    outcome,
    reasonCodes,
  };
}

export function transitionRequest(
  overrides: Partial<TransitionRequest> = {},
): TransitionRequest {
  return {
    runId: state().runId,
    edgeId: IDS.redToImplementation,
    requestedByExecutorId: IDS.requester,
    expectedStateRevision: asRevision(1),
    ...overrides,
  };
}

export function transitionContext(
  overrides: Partial<TransitionEvaluationContext> = {},
): TransitionEvaluationContext {
  return {
    graph: graph(),
    state: state(),
    artifacts: [],
    gateResults: [],
    policyResults: [],
    ...overrides,
  };
}

export function approvalGate(
  overrides: Partial<ApprovalPresentGateDefinition> = {},
): ApprovalPresentGateDefinition {
  return {
    gateId: IDS.approvalGate,
    gateType: "approval_present",
    action: "approve",
    scope: "specification",
    subject: { kind: "exact", subjectRef: IDS.spec },
    requireIndependentApprover: true,
    missingReason: "APPROVAL_REQUIRED",
    expiredReason: "APPROVAL_EXPIRED",
    selfApprovalReason: "SELF_APPROVAL_FORBIDDEN",
    ...overrides,
  };
}

export function failure(overrides: Partial<FailureRecord> = {}): FailureRecord {
  return {
    failureId: asFailureId("failure:test"),
    failureClass: "EXECUTION_FAILURE",
    subjectRef: IDS.implementationNode,
    reasonCode: "GATE_FAILED",
    retryability: "RETRYABLE",
    evidenceIds: [],
    observedAt: "2026-08-09T04:00:00.000Z",
    ...overrides,
  };
}

export function retryPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    retryPolicyId: asRetryPolicyId("retry:test"),
    maxAttempts: 3,
    allowedFailureClasses: ["EXECUTION_FAILURE"],
    contextStrategy: "fresh",
    exhaustionEdgeId: asEdgeId("edge:retry-exhausted"),
    ...overrides,
  };
}
