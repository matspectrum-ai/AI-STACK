export type GraphId = string & { readonly __brand: "GraphId" };
export type RunId = string & { readonly __brand: "RunId" };
export type NodeId = string & { readonly __brand: "NodeId" };
export type NodeExecutionId = string & { readonly __brand: "NodeExecutionId" };
export type EdgeId = string & { readonly __brand: "EdgeId" };
export type TransitionId = string & { readonly __brand: "TransitionId" };
export type GateId = string & { readonly __brand: "GateId" };
export type PolicyId = string & { readonly __brand: "PolicyId" };
export type ArtifactId = string & { readonly __brand: "ArtifactId" };
export type EvidenceId = string & { readonly __brand: "EvidenceId" };
export type ExecutorId = string & { readonly __brand: "ExecutorId" };
export type ApprovalId = string & { readonly __brand: "ApprovalId" };
export type FailureId = string & { readonly __brand: "FailureId" };
export type RetryPolicyId = string & { readonly __brand: "RetryPolicyId" };
export type ContentDigest = string & { readonly __brand: "ContentDigest" };
export type StateRevision = number & { readonly __brand: "StateRevision" };

export type NodeKind =
  | "discovery"
  | "product"
  | "design"
  | "architecture"
  | "specification"
  | "contract"
  | "test_design"
  | "red_verification"
  | "implementation"
  | "green_verification"
  | "refactor"
  | "review"
  | "security"
  | "eval"
  | "qa"
  | "verification"
  | "release"
  | "observability"
  | "feedback"
  | "approval"
  | "recovery";

export type EdgeKind =
  | "forward"
  | "conditional"
  | "retry"
  | "recovery"
  | "feedback"
  | "fan_out"
  | "join";

export type ArtifactKind =
  | "brief"
  | "prd"
  | "design"
  | "rfc"
  | "adr"
  | "specification"
  | "contract"
  | "test_plan"
  | "test_definition"
  | "source_change"
  | "review_report"
  | "security_report"
  | "eval_report"
  | "qa_report"
  | "release_manifest";

export type EvidenceStatus = "UNVERIFIED" | "VALID" | "INVALID" | "EXPIRED";
export type ExecutorKind = "agent" | "human" | "deterministic_tool" | "ci_job";
export type GateOutcome = "PASS" | "FAIL" | "INDETERMINATE";
export type PolicyOutcome = "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "INDETERMINATE";
export type TransitionOutcome = "ALLOW" | "DENY" | "PAUSE";
export type Retryability = "RETRYABLE" | "NON_RETRYABLE" | "POLICY_DEPENDENT";
export type RetryContextStrategy = "reuse" | "fresh" | "policy_defined";

export type FailureClass =
  | "EXECUTION_FAILURE"
  | "CONTRACT_VIOLATION"
  | "GATE_FAILURE"
  | "POLICY_DENIAL"
  | "EVIDENCE_INVALID"
  | "TIMEOUT"
  | "RESOURCE_FAILURE"
  | "INTERNAL_ERROR";

export type ReasonCode =
  | "MISSING_REQUIRED_SPECIFICATION"
  | "MISSING_REQUIRED_CONTRACT"
  | "MISSING_VALID_RED_EVIDENCE"
  | "INVALID_RED_EVIDENCE"
  | "MISSING_VERIFICATION_EVIDENCE"
  | "SELF_APPROVAL_FORBIDDEN"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_EXPIRED"
  | "POLICY_DENIED"
  | "POLICY_INDETERMINATE"
  | "GATE_FAILED"
  | "GATE_INDETERMINATE"
  | "EDGE_NOT_ALLOWED"
  | "STALE_STATE_REVISION"
  | "RETRY_BUDGET_EXHAUSTED"
  | "NON_RETRYABLE_FAILURE"
  | "MALFORMED_AUTHORITATIVE_STATE"
  | "UNAUTHORIZED_EXECUTOR"
  | "IMPLICIT_SHELL_EXECUTION_FORBIDDEN"
  | "INVALID_GRAPH_DEFINITION"
  | "INVALID_ARTIFACT_LINEAGE"
  | "INVALID_OUTPUT_CONTRACT";

export interface GraphDefinition {
  readonly graphId: GraphId;
  readonly graphVersion: string;
  readonly nodes: readonly NodeDefinition[];
  readonly edges: readonly EdgeDefinition[];
  readonly entryNodeIds: readonly NodeId[];
  readonly terminalNodeIds: readonly NodeId[];
}

export interface NodeDefinition {
  readonly nodeId: NodeId;
  readonly kind: NodeKind;
  readonly requiredArtifactKinds: readonly ArtifactKind[];
  readonly requiredGateIds: readonly GateId[];
  readonly executorPolicyId?: PolicyId;
  readonly retryPolicyId?: RetryPolicyId;
  readonly outputContracts: readonly OutputContract[];
}

export interface OutputContract {
  readonly contractId: string;
  readonly artifactKind: ArtifactKind;
  readonly schemaRef: string;
}

export interface EdgeDefinition {
  readonly edgeId: EdgeId;
  readonly fromNodeId: NodeId;
  readonly toNodeId: NodeId;
  readonly kind: EdgeKind;
  readonly gateIds: readonly GateId[];
  readonly policyIds: readonly PolicyId[];
}

export interface GraphRunState {
  readonly runId: RunId;
  readonly graphId: GraphId;
  readonly graphVersion: string;
  readonly revision: StateRevision;
  readonly activeNodeIds: readonly NodeId[];
  readonly completedExecutionIds: readonly NodeExecutionId[];
  readonly artifactRefs: readonly ArtifactId[];
  readonly evidenceRefs: readonly EvidenceId[];
  readonly approvalRefs: readonly ApprovalId[];
  readonly failureRefs: readonly FailureId[];
  readonly retryCounters: Readonly<Record<string, number>>;
  readonly lastTransitionId?: TransitionId;
}

export interface TransitionRequest {
  readonly runId: RunId;
  readonly edgeId: EdgeId;
  readonly requestedByExecutorId: ExecutorId;
  readonly expectedStateRevision: StateRevision;
}

export interface TransitionDecision {
  readonly transitionId: TransitionId;
  readonly runId: RunId;
  readonly graphId: GraphId;
  readonly graphVersion: string;
  readonly edgeId: EdgeId;
  readonly decision: TransitionOutcome;
  readonly reasonCodes: readonly ReasonCode[];
  readonly evaluatedGateResults: readonly GateResult[];
  readonly evaluatedPolicyResults: readonly PolicyResult[];
  readonly boundArtifactIds: readonly ArtifactId[];
  readonly boundApprovalIds: readonly ApprovalId[];
  readonly boundEvidenceIds: readonly EvidenceId[];
  readonly stateRevisionBefore: StateRevision;
  readonly stateRevisionAfter?: StateRevision;
}

export type SubjectSelector =
  | { readonly kind: "exact"; readonly subjectRef: string }
  | { readonly kind: "artifact_kind"; readonly artifactKind: ArtifactKind };

export type GateDefinition =
  | ArtifactPresentGateDefinition
  | EvidenceValidGateDefinition
  | ApprovalPresentGateDefinition;

export interface ArtifactPresentGateDefinition {
  readonly gateId: GateId;
  readonly gateType: "artifact_present";
  readonly artifactKind: ArtifactKind;
  readonly missingReason: ReasonCode;
}

export interface EvidenceValidGateDefinition {
  readonly gateId: GateId;
  readonly gateType: "evidence_valid";
  readonly evidenceType: string;
  readonly subject: SubjectSelector;
  readonly missingReason: ReasonCode;
  readonly invalidReason: ReasonCode;
}

export interface ApprovalPresentGateDefinition {
  readonly gateId: GateId;
  readonly gateType: "approval_present";
  readonly action: string;
  readonly scope: string;
  readonly subject: SubjectSelector;
  readonly requireIndependentApprover: boolean;
  readonly missingReason: ReasonCode;
  readonly expiredReason: ReasonCode;
  readonly selfApprovalReason: ReasonCode;
}

export interface GateEvaluationContext {
  readonly state: GraphRunState;
  readonly artifacts: readonly ArtifactRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly approvals: readonly ApprovalRecord[];
  readonly requestedByExecutorId: ExecutorId;
  readonly subjectExecutorId?: ExecutorId;
  readonly now: string;
}

export interface GateResult {
  readonly gateId: GateId;
  readonly outcome: GateOutcome;
  readonly reasonCodes: readonly ReasonCode[];
  readonly evaluatedInputRefs: readonly string[];
  readonly boundArtifactIds: readonly ArtifactId[];
  readonly boundEvidenceIds: readonly EvidenceId[];
  readonly boundApprovalIds: readonly ApprovalId[];
}

export interface PolicyDefinition {
  readonly policyId: PolicyId;
  readonly policyVersion: string;
  readonly scope: string;
  readonly ruleReference: string;
}

export interface PolicyResult {
  readonly policyId: PolicyId;
  readonly policyVersion: string;
  readonly outcome: PolicyOutcome;
  readonly reasonCodes: readonly ReasonCode[];
}

export interface ArtifactRecord {
  readonly artifactId: ArtifactId;
  readonly artifactKind: ArtifactKind;
  readonly artifactVersion: string;
  readonly contentRef: string;
  readonly contentDigest: ContentDigest;
  readonly producerExecutionId: NodeExecutionId;
  readonly parentArtifactIds: readonly ArtifactId[];
}

export interface EvidenceRecord {
  readonly evidenceId: EvidenceId;
  readonly evidenceType: string;
  readonly producerExecutorId: ExecutorId;
  readonly subjectRef: string;
  readonly observedAt: string;
  readonly payloadRef: string;
  readonly payloadDigest: ContentDigest;
  readonly verificationStatus: EvidenceStatus;
  readonly verifierRef?: string;
}

export interface ExecutorRecord {
  readonly executorId: ExecutorId;
  readonly executorKind: ExecutorKind;
  readonly capabilities: readonly string[];
  readonly authorityScopes: readonly string[];
}

export interface ApprovalRecord {
  readonly approvalId: ApprovalId;
  readonly approverExecutorId: ExecutorId;
  readonly subjectRef: string;
  readonly action: string;
  readonly scope: string;
  readonly grantedAt: string;
  readonly expiresAt?: string;
  readonly requiredByPolicyId: PolicyId;
}

export interface FailureRecord {
  readonly failureId: FailureId;
  readonly failureClass: FailureClass;
  readonly subjectRef: string;
  readonly reasonCode: ReasonCode;
  readonly retryability: Retryability;
  readonly evidenceIds: readonly EvidenceId[];
  readonly observedAt: string;
}

export interface RetryPolicy {
  readonly retryPolicyId: RetryPolicyId;
  readonly maxAttempts: number;
  readonly allowedFailureClasses: readonly FailureClass[];
  readonly allowedReasonCodes?: readonly ReasonCode[];
  readonly contextStrategy: RetryContextStrategy;
  readonly exhaustionEdgeId: EdgeId;
}

export interface RetryDecision {
  readonly allowed: boolean;
  readonly reasonCodes: readonly ReasonCode[];
  readonly nextAttempt?: number;
  readonly exhaustionEdgeId?: EdgeId;
}

export interface TransitionEvaluationContext {
  readonly graph: GraphDefinition;
  readonly state: GraphRunState;
  readonly artifacts: readonly ArtifactRecord[];
  readonly gateResults: readonly GateResult[];
  readonly policyResults: readonly PolicyResult[];
}

export interface GraphKernel {
  validateGraph(graph: GraphDefinition): readonly ReasonCode[];
  validateGraphReplacement(
    activated: GraphDefinition,
    proposed: GraphDefinition,
  ): readonly ReasonCode[];
  evaluateGate(definition: GateDefinition, context: GateEvaluationContext): GateResult;
  evaluateTransition(
    request: TransitionRequest,
    context: TransitionEvaluationContext,
  ): TransitionDecision;
  validateArtifactLineage(artifacts: readonly ArtifactRecord[]): readonly ReasonCode[];
  validateRetryPolicy(policy: RetryPolicy): readonly ReasonCode[];
  evaluateRetry(
    failure: FailureRecord,
    policy: RetryPolicy,
    attemptsUsed: number,
  ): RetryDecision;
}
