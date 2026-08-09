import type {
  ApprovalId,
  ArtifactId,
  ArtifactRecord,
  EdgeDefinition,
  GateDefinition,
  GateEvaluationContext,
  GateId,
  GateResult,
  GraphDefinition,
  GraphKernel,
  PolicyId,
  PolicyResult,
  ReasonCode,
  RetryDecision,
  RetryPolicy,
  SubjectSelector,
  TransitionEvaluationContext,
  TransitionRequest,
  TransitionVerdict,
} from "../../contracts/domain";

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function referencedArtifacts(
  artifacts: readonly ArtifactRecord[],
  refs: readonly ArtifactId[],
): ArtifactRecord[] {
  const allowed = new Set<ArtifactId>(refs);
  return artifacts.filter((artifact) => allowed.has(artifact.artifactId));
}

function resolveSubjectRefs(
  subject: SubjectSelector,
  context: GateEvaluationContext,
): { subjectRefs: string[]; boundArtifactIds: ArtifactId[] } {
  if (subject.kind === "exact") {
    return { subjectRefs: [subject.subjectRef], boundArtifactIds: [] };
  }

  const matches = referencedArtifacts(context.artifacts, context.state.artifactRefs).filter(
    (artifact) => artifact.artifactKind === subject.artifactKind,
  );

  return {
    subjectRefs: matches.map((artifact) => artifact.artifactId),
    boundArtifactIds: matches.map((artifact) => artifact.artifactId),
  };
}

function gateResult(
  gateId: GateId,
  outcome: GateResult["outcome"],
  reasonCodes: readonly ReasonCode[],
  options: {
    artifactIds?: readonly ArtifactId[];
    evidenceIds?: GateResult["boundEvidenceIds"];
    approvalIds?: readonly ApprovalId[];
    inputRefs?: readonly string[];
  } = {},
): GateResult {
  return {
    gateId,
    outcome,
    reasonCodes: [...reasonCodes],
    evaluatedInputRefs: [...(options.inputRefs ?? [])],
    boundArtifactIds: [...(options.artifactIds ?? [])],
    boundEvidenceIds: [...(options.evidenceIds ?? [])],
    boundApprovalIds: [...(options.approvalIds ?? [])],
  };
}

function evaluateArtifactGate(
  definition: Extract<GateDefinition, { gateType: "artifact_present" }>,
  context: GateEvaluationContext,
): GateResult {
  const matches = referencedArtifacts(context.artifacts, context.state.artifactRefs).filter(
    (artifact) => artifact.artifactKind === definition.artifactKind,
  );

  if (matches.length === 0) {
    return gateResult(definition.gateId, "FAIL", [definition.missingReason]);
  }

  return gateResult(definition.gateId, "PASS", [], {
    artifactIds: matches.map((artifact) => artifact.artifactId),
    inputRefs: matches.map((artifact) => artifact.artifactId),
  });
}

function evaluateEvidenceGate(
  definition: Extract<GateDefinition, { gateType: "evidence_valid" }>,
  context: GateEvaluationContext,
): GateResult {
  const subjects = resolveSubjectRefs(definition.subject, context);
  const allowedEvidence = new Set(context.state.evidenceRefs);
  const matching = context.evidence.filter(
    (record) =>
      allowedEvidence.has(record.evidenceId) &&
      record.evidenceType === definition.evidenceType &&
      subjects.subjectRefs.includes(record.subjectRef),
  );

  if (matching.length === 0) {
    return gateResult(definition.gateId, "FAIL", [definition.missingReason], {
      artifactIds: subjects.boundArtifactIds,
    });
  }

  const valid = matching.filter((record) => record.verificationStatus === "VALID");
  if (valid.length === 0) {
    return gateResult(definition.gateId, "FAIL", [definition.invalidReason], {
      artifactIds: subjects.boundArtifactIds,
      evidenceIds: matching.map((record) => record.evidenceId),
      inputRefs: matching.map((record) => record.evidenceId),
    });
  }

  return gateResult(definition.gateId, "PASS", [], {
    artifactIds: subjects.boundArtifactIds,
    evidenceIds: valid.map((record) => record.evidenceId),
    inputRefs: valid.map((record) => record.evidenceId),
  });
}

function evaluateApprovalGate(
  definition: Extract<GateDefinition, { gateType: "approval_present" }>,
  context: GateEvaluationContext,
): GateResult {
  const subjects = resolveSubjectRefs(definition.subject, context);
  const allowedApprovals = new Set(context.state.approvalRefs);
  const matching = context.approvals.filter(
    (record) =>
      allowedApprovals.has(record.approvalId) &&
      subjects.subjectRefs.includes(record.subjectRef) &&
      record.action === definition.action &&
      record.scope === definition.scope,
  );

  if (matching.length === 0) {
    return gateResult(definition.gateId, "FAIL", [definition.missingReason], {
      artifactIds: subjects.boundArtifactIds,
    });
  }

  const current = matching.filter(
    (record) => record.expiresAt === undefined || Date.parse(record.expiresAt) > Date.parse(context.now),
  );

  if (current.length === 0) {
    return gateResult(definition.gateId, "FAIL", [definition.expiredReason], {
      artifactIds: subjects.boundArtifactIds,
      approvalIds: matching.map((record) => record.approvalId),
      inputRefs: matching.map((record) => record.approvalId),
    });
  }

  const independent = definition.requireIndependentApprover && context.subjectExecutorId
    ? current.filter((record) => record.approverExecutorId !== context.subjectExecutorId)
    : current;

  if (independent.length === 0) {
    return gateResult(definition.gateId, "FAIL", [definition.selfApprovalReason], {
      artifactIds: subjects.boundArtifactIds,
      approvalIds: current.map((record) => record.approvalId),
      inputRefs: current.map((record) => record.approvalId),
    });
  }

  return gateResult(definition.gateId, "PASS", [], {
    artifactIds: subjects.boundArtifactIds,
    approvalIds: independent.map((record) => record.approvalId),
    inputRefs: independent.map((record) => record.approvalId),
  });
}

function validateGraph(graph: GraphDefinition): readonly ReasonCode[] {
  const errors: ReasonCode[] = [];
  const nodeIds = graph.nodes.map((node) => node.nodeId);
  const edgeIds = graph.edges.map((edge) => edge.edgeId);
  const nodeSet = new Set(nodeIds);

  if (graph.graphId.length === 0 || graph.graphVersion.length === 0) {
    errors.push("INVALID_GRAPH_DEFINITION");
  }

  if (new Set(nodeIds).size !== nodeIds.length || new Set(edgeIds).size !== edgeIds.length) {
    errors.push("INVALID_GRAPH_DEFINITION");
  }

  if (
    graph.entryNodeIds.some((id) => !nodeSet.has(id)) ||
    graph.terminalNodeIds.some((id) => !nodeSet.has(id))
  ) {
    errors.push("INVALID_GRAPH_DEFINITION");
  }

  for (const edge of graph.edges) {
    if (!nodeSet.has(edge.fromNodeId) || !nodeSet.has(edge.toNodeId)) {
      errors.push("INVALID_GRAPH_DEFINITION");
    }
  }

  const entrySet = new Set(graph.entryNodeIds);
  for (const node of graph.nodes) {
    if (entrySet.has(node.nodeId)) continue;
    const hasInbound = graph.edges.some((edge) => edge.toNodeId === node.nodeId);
    if (!hasInbound) errors.push("INVALID_GRAPH_DEFINITION");
  }

  return unique(errors);
}

function sameDefinition(a: GraphDefinition, b: GraphDefinition): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function requiredPolicyIds(
  edge: EdgeDefinition,
  graph: GraphDefinition,
): PolicyId[] {
  const target = graph.nodes.find((node) => node.nodeId === edge.toNodeId);
  return unique([
    ...edge.policyIds,
    ...(target?.executorPolicyId ? [target.executorPolicyId] : []),
  ]);
}

function findPolicyResult(
  id: PolicyId,
  results: readonly PolicyResult[],
): PolicyResult | undefined {
  return results.find((result) => result.policyId === id);
}

function artifactReason(kind: ArtifactRecord["artifactKind"]): ReasonCode {
  if (kind === "specification") return "MISSING_REQUIRED_SPECIFICATION";
  if (kind === "contract") return "MISSING_REQUIRED_CONTRACT";
  return "GATE_FAILED";
}

function evaluateTransition(
  request: TransitionRequest,
  context: TransitionEvaluationContext,
): TransitionVerdict {
  const reasons: ReasonCode[] = [];
  const graph = context.graph;
  const state = context.state;
  const edge = graph.edges.find((candidate) => candidate.edgeId === request.edgeId);

  const base = {
    runId: request.runId,
    graphId: graph.graphId,
    graphVersion: graph.graphVersion,
    edgeId: request.edgeId,
    evaluatedStateRevision: state.revision,
  } as const;

  if (
    request.runId !== state.runId ||
    graph.graphId !== state.graphId ||
    graph.graphVersion !== state.graphVersion
  ) {
    reasons.push("INVALID_GRAPH_DEFINITION");
  }

  if (request.expectedStateRevision !== state.revision) {
    reasons.push("STALE_STATE_REVISION");
  }

  if (!edge || (edge && !state.activeNodeIds.includes(edge.fromNodeId))) {
    reasons.push("EDGE_NOT_ALLOWED");
  }

  if (!edge) {
    return {
      ...base,
      decision: "DENY",
      reasonCodes: unique(reasons),
      evaluatedGateResults: [],
      evaluatedPolicyResults: [],
      boundArtifactIds: [],
      boundApprovalIds: [],
      boundEvidenceIds: [],
    };
  }

  const target = graph.nodes.find((node) => node.nodeId === edge.toNodeId);
  if (!target) reasons.push("INVALID_GRAPH_DEFINITION");

  const runArtifacts = referencedArtifacts(context.artifacts, state.artifactRefs);
  const boundArtifactIds: ArtifactId[] = [];

  if (target) {
    for (const kind of target.requiredArtifactKinds) {
      const matches = runArtifacts.filter((artifact) => artifact.artifactKind === kind);
      if (matches.length === 0) reasons.push(artifactReason(kind));
      else boundArtifactIds.push(...matches.map((artifact) => artifact.artifactId));
    }
  }

  const requiredGates = unique([...(edge.gateIds ?? []), ...(target?.requiredGateIds ?? [])]);
  const evaluatedGateResults: GateResult[] = [];
  const boundApprovalIds: ApprovalId[] = [];
  const boundEvidenceIds = [] as GateResult["boundEvidenceIds"] extends readonly (infer T)[] ? T[] : never[];

  for (const gateId of requiredGates) {
    const result = context.gateResults.find((candidate) => candidate.gateId === gateId);
    if (!result) {
      reasons.push("GATE_INDETERMINATE");
      continue;
    }
    evaluatedGateResults.push(result);
    boundArtifactIds.push(...result.boundArtifactIds);
    boundApprovalIds.push(...result.boundApprovalIds);
    boundEvidenceIds.push(...result.boundEvidenceIds);
    if (result.outcome === "FAIL") {
      reasons.push(...(result.reasonCodes.length > 0 ? result.reasonCodes : ["GATE_FAILED"]));
    } else if (result.outcome === "INDETERMINATE") {
      reasons.push(...(result.reasonCodes.length > 0 ? result.reasonCodes : ["GATE_INDETERMINATE"]));
    }
  }

  const evaluatedPolicyResults: PolicyResult[] = [];
  let pauseForApproval = false;
  for (const policyId of requiredPolicyIds(edge, graph)) {
    const result = findPolicyResult(policyId, context.policyResults);
    if (!result) {
      reasons.push("POLICY_INDETERMINATE");
      continue;
    }
    evaluatedPolicyResults.push(result);
    if (result.outcome === "DENY") {
      reasons.push(...(result.reasonCodes.length > 0 ? result.reasonCodes : ["POLICY_DENIED"]));
    } else if (result.outcome === "INDETERMINATE") {
      reasons.push(...(result.reasonCodes.length > 0 ? result.reasonCodes : ["POLICY_INDETERMINATE"]));
    } else if (result.outcome === "REQUIRE_APPROVAL") {
      pauseForApproval = true;
      reasons.push(...(result.reasonCodes.length > 0 ? result.reasonCodes : ["APPROVAL_REQUIRED"]));
    }
  }

  const uniqueReasons = unique(reasons);
  const hasDenyReason = uniqueReasons.some((reason) => reason !== "APPROVAL_REQUIRED");
  const decision = hasDenyReason ? "DENY" : pauseForApproval ? "PAUSE" : "ALLOW";

  return {
    ...base,
    decision,
    reasonCodes: uniqueReasons,
    evaluatedGateResults,
    evaluatedPolicyResults,
    boundArtifactIds: unique(boundArtifactIds),
    boundApprovalIds: unique(boundApprovalIds),
    boundEvidenceIds: unique(boundEvidenceIds),
  };
}

function validateArtifactLineage(artifacts: readonly ArtifactRecord[]): readonly ReasonCode[] {
  const ids = new Set(artifacts.map((artifact) => artifact.artifactId));
  const parents = new Map<ArtifactId, readonly ArtifactId[]>(
    artifacts.map((artifact) => [artifact.artifactId, artifact.parentArtifactIds]),
  );

  for (const artifact of artifacts) {
    if (artifact.parentArtifactIds.some((parent) => !ids.has(parent))) {
      return ["INVALID_ARTIFACT_LINEAGE"];
    }
  }

  const visiting = new Set<ArtifactId>();
  const visited = new Set<ArtifactId>();

  const hasCycle = (id: ArtifactId): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const parent of parents.get(id) ?? []) {
      if (hasCycle(parent)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  for (const id of ids) {
    if (hasCycle(id)) return ["INVALID_ARTIFACT_LINEAGE"];
  }
  return [];
}

function validateRetryPolicy(policy: RetryPolicy): readonly ReasonCode[] {
  if (!Number.isFinite(policy.maxAttempts) || !Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    return ["INVALID_GRAPH_DEFINITION"];
  }
  return [];
}

function evaluateRetry(
  failure: Parameters<GraphKernel["evaluateRetry"]>[0],
  policy: RetryPolicy,
  attemptsUsed: number,
): RetryDecision {
  if (validateRetryPolicy(policy).length > 0 || !Number.isInteger(attemptsUsed) || attemptsUsed < 0) {
    return { allowed: false, reasonCodes: ["INVALID_GRAPH_DEFINITION"] };
  }

  const reasonAllowed =
    policy.allowedReasonCodes === undefined || policy.allowedReasonCodes.includes(failure.reasonCode);
  const classAllowed = policy.allowedFailureClasses.includes(failure.failureClass);

  if (failure.retryability !== "RETRYABLE" || !classAllowed || !reasonAllowed) {
    return { allowed: false, reasonCodes: ["NON_RETRYABLE_FAILURE"] };
  }

  if (attemptsUsed >= policy.maxAttempts) {
    return {
      allowed: false,
      reasonCodes: ["RETRY_BUDGET_EXHAUSTED"],
      exhaustionEdgeId: policy.exhaustionEdgeId,
    };
  }

  return {
    allowed: true,
    reasonCodes: [],
    nextAttempt: attemptsUsed + 1,
  };
}

export function createGraphKernel(): GraphKernel {
  return {
    validateGraph,
    validateGraphReplacement(activated, proposed) {
      const proposedErrors = validateGraph(proposed);
      if (proposedErrors.length > 0) return proposedErrors;
      if (
        activated.graphId === proposed.graphId &&
        activated.graphVersion === proposed.graphVersion &&
        !sameDefinition(activated, proposed)
      ) {
        return ["INVALID_GRAPH_DEFINITION"];
      }
      return [];
    },
    evaluateGate(definition, context) {
      switch (definition.gateType) {
        case "artifact_present":
          return evaluateArtifactGate(definition, context);
        case "evidence_valid":
          return evaluateEvidenceGate(definition, context);
        case "approval_present":
          return evaluateApprovalGate(definition, context);
      }
    },
    evaluateTransition,
    validateArtifactLineage,
    validateRetryPolicy,
    evaluateRetry,
  };
}
