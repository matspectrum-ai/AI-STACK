import type {
  ApprovalId,
  ArtifactId,
  ArtifactRecord,
  EdgeDefinition,
  EvidenceId,
  GateResult,
  GraphDefinition,
  PolicyId,
  PolicyResult,
  ReasonCode,
  TransitionEvaluationContext,
  TransitionRequest,
  TransitionVerdict,
} from "../../contracts/domain";
import {
  referencedArtifacts,
  unique,
  withFallbackReason,
} from "./internal";

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

export function evaluateTransition(
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

  if (!edge || !state.activeNodeIds.includes(edge.fromNodeId)) {
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
      const matches = runArtifacts.filter(
        (artifact) => artifact.artifactKind === kind,
      );
      if (matches.length === 0) reasons.push(artifactReason(kind));
      else boundArtifactIds.push(...matches.map((artifact) => artifact.artifactId));
    }
  }

  const requiredGates = unique([
    ...edge.gateIds,
    ...(target?.requiredGateIds ?? []),
  ]);
  const evaluatedGateResults: GateResult[] = [];
  const boundApprovalIds: ApprovalId[] = [];
  const boundEvidenceIds: EvidenceId[] = [];

  for (const gateId of requiredGates) {
    const result = context.gateResults.find(
      (candidate) => candidate.gateId === gateId,
    );
    if (!result) {
      reasons.push("GATE_INDETERMINATE");
      continue;
    }

    evaluatedGateResults.push(result);
    boundArtifactIds.push(...result.boundArtifactIds);
    boundApprovalIds.push(...result.boundApprovalIds);
    boundEvidenceIds.push(...result.boundEvidenceIds);

    if (result.outcome === "FAIL") {
      reasons.push(...withFallbackReason(result.reasonCodes, "GATE_FAILED"));
    } else if (result.outcome === "INDETERMINATE") {
      reasons.push(
        ...withFallbackReason(result.reasonCodes, "GATE_INDETERMINATE"),
      );
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
      reasons.push(...withFallbackReason(result.reasonCodes, "POLICY_DENIED"));
    } else if (result.outcome === "INDETERMINATE") {
      reasons.push(
        ...withFallbackReason(result.reasonCodes, "POLICY_INDETERMINATE"),
      );
    } else if (result.outcome === "REQUIRE_APPROVAL") {
      pauseForApproval = true;
      reasons.push(
        ...withFallbackReason(result.reasonCodes, "APPROVAL_REQUIRED"),
      );
    }
  }

  const uniqueReasons = unique(reasons);
  const hasDenyReason = uniqueReasons.some(
    (reason) => reason !== "APPROVAL_REQUIRED",
  );
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
