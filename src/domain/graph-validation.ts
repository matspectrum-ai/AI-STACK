import type {
  GraphDefinition,
  ReasonCode,
} from "../../contracts/domain";
import { unique } from "./internal";

export function validateGraph(graph: GraphDefinition): readonly ReasonCode[] {
  const errors: ReasonCode[] = [];
  const nodeIds = graph.nodes.map((node) => node.nodeId);
  const edgeIds = graph.edges.map((edge) => edge.edgeId);
  const nodeSet = new Set(nodeIds);

  if (graph.graphId.length === 0 || graph.graphVersion.length === 0) {
    errors.push("INVALID_GRAPH_DEFINITION");
  }

  if (
    new Set(nodeIds).size !== nodeIds.length ||
    new Set(edgeIds).size !== edgeIds.length
  ) {
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

export function validateGraphReplacement(
  activated: GraphDefinition,
  proposed: GraphDefinition,
): readonly ReasonCode[] {
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
}
