import type {
  ArtifactKind,
  EdgeKind,
  GraphId,
  NodeKind,
  NodeId,
  EdgeId,
  GateId,
  PolicyId,
  RetryPolicyId,
} from "../../../../contracts/domain";
import type {
  ExecutionGraphDefinition,
  ExecutionMode,
  ExecutionNodeDefinition,
} from "../../../../contracts/execution";
import { isValidExecutionGraphDefinition } from "../validate-graph-definition";

const NODE_KINDS = new Set<string>([
  "discovery", "product", "design", "architecture", "specification", "contract",
  "test_design", "red_verification", "implementation", "green_verification",
  "refactor", "review", "security", "eval", "qa", "verification", "release",
  "observability", "feedback", "approval", "recovery",
]);

const EDGE_KINDS = new Set<string>([
  "forward", "conditional", "retry", "recovery", "feedback", "fan_out", "join",
]);

const ARTIFACT_KINDS = new Set<string>([
  "brief", "prd", "design", "rfc", "adr", "specification", "contract", "test_plan",
  "test_definition", "source_change", "review_report", "security_report", "eval_report",
  "qa_report", "release_manifest",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function decodeNode(value: unknown): ExecutionNodeDefinition | undefined {
  if (!isRecord(value)) return undefined;
  if (!nonEmptyString(value.nodeId)) return undefined;
  if (!nonEmptyString(value.kind) || !NODE_KINDS.has(value.kind)) return undefined;
  if (value.executionMode !== "control" && value.executionMode !== "dispatch") return undefined;
  if (!Array.isArray(value.requiredArtifactKinds)) return undefined;
  if (
    !value.requiredArtifactKinds.every(
      (kind) => nonEmptyString(kind) && ARTIFACT_KINDS.has(kind),
    )
  ) return undefined;
  if (!stringArray(value.requiredGateIds)) return undefined;
  if (value.executorPolicyId !== undefined && !nonEmptyString(value.executorPolicyId)) return undefined;
  if (value.retryPolicyId !== undefined && !nonEmptyString(value.retryPolicyId)) return undefined;
  if (!Array.isArray(value.outputContracts)) return undefined;

  const outputContracts = value.outputContracts.map((candidate) => {
    if (!isRecord(candidate)) return undefined;
    if (!nonEmptyString(candidate.contractId)) return undefined;
    if (!nonEmptyString(candidate.artifactKind) || !ARTIFACT_KINDS.has(candidate.artifactKind)) {
      return undefined;
    }
    if (!nonEmptyString(candidate.schemaRef)) return undefined;
    return {
      contractId: candidate.contractId,
      artifactKind: candidate.artifactKind as ArtifactKind,
      schemaRef: candidate.schemaRef,
    };
  });
  if (outputContracts.some((candidate) => candidate === undefined)) return undefined;

  return {
    nodeId: value.nodeId as NodeId,
    kind: value.kind as NodeKind,
    executionMode: value.executionMode as ExecutionMode,
    requiredArtifactKinds: value.requiredArtifactKinds as ArtifactKind[],
    requiredGateIds: value.requiredGateIds as GateId[],
    ...(value.executorPolicyId !== undefined
      ? { executorPolicyId: value.executorPolicyId as PolicyId }
      : {}),
    ...(value.retryPolicyId !== undefined
      ? { retryPolicyId: value.retryPolicyId as RetryPolicyId }
      : {}),
    outputContracts: outputContracts as ExecutionNodeDefinition["outputContracts"],
  };
}

function decodeEdge(value: unknown): ExecutionGraphDefinition["edges"][number] | undefined {
  if (!isRecord(value)) return undefined;
  if (!nonEmptyString(value.edgeId)) return undefined;
  if (!nonEmptyString(value.fromNodeId)) return undefined;
  if (!nonEmptyString(value.toNodeId)) return undefined;
  if (!nonEmptyString(value.kind) || !EDGE_KINDS.has(value.kind)) return undefined;
  if (!stringArray(value.gateIds) || !stringArray(value.policyIds)) return undefined;

  return {
    edgeId: value.edgeId as EdgeId,
    fromNodeId: value.fromNodeId as NodeId,
    toNodeId: value.toNodeId as NodeId,
    kind: value.kind as EdgeKind,
    gateIds: value.gateIds as GateId[],
    policyIds: value.policyIds as PolicyId[],
  };
}

export function encodeGraphDefinition(graph: ExecutionGraphDefinition): string {
  return JSON.stringify({ schemaVersion: 1, payload: graph });
}

export function decodeGraphDefinition(raw: string): ExecutionGraphDefinition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("GRAPH_DEFINITION_INVALID");
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isRecord(parsed.payload)) {
    throw new Error("GRAPH_DEFINITION_INVALID");
  }
  const payload = parsed.payload;
  if (!nonEmptyString(payload.graphId) || !nonEmptyString(payload.graphVersion)) {
    throw new Error("GRAPH_DEFINITION_INVALID");
  }
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
    throw new Error("GRAPH_DEFINITION_INVALID");
  }
  if (!stringArray(payload.entryNodeIds) || !stringArray(payload.terminalNodeIds)) {
    throw new Error("GRAPH_DEFINITION_INVALID");
  }

  const nodes = payload.nodes.map(decodeNode);
  const edges = payload.edges.map(decodeEdge);
  if (nodes.some((candidate) => candidate === undefined) || edges.some((candidate) => candidate === undefined)) {
    throw new Error("GRAPH_DEFINITION_INVALID");
  }

  const graph: ExecutionGraphDefinition = {
    graphId: payload.graphId as GraphId,
    graphVersion: payload.graphVersion,
    nodes: nodes as ExecutionNodeDefinition[],
    edges: edges as ExecutionGraphDefinition["edges"],
    entryNodeIds: payload.entryNodeIds as NodeId[],
    terminalNodeIds: payload.terminalNodeIds as NodeId[],
  };
  if (!isValidExecutionGraphDefinition(graph)) {
    throw new Error("GRAPH_DEFINITION_INVALID");
  }
  return graph;
}
