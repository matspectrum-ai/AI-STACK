import type { ExecutionGraphDefinition } from "../../../contracts/execution";
import { createGraphKernel } from "../../domain/create-graph-kernel";

const kernel = createGraphKernel();

function nonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}

export function isValidExecutionGraphDefinition(
  graph: ExecutionGraphDefinition,
): boolean {
  if (!nonEmpty(graph.graphId) || !nonEmpty(graph.graphVersion)) return false;
  if (kernel.validateGraph(graph).length > 0) return false;

  for (const node of graph.nodes) {
    if (!nonEmpty(node.nodeId)) return false;
    if (node.executionMode !== "control" && node.executionMode !== "dispatch") return false;
    if (node.executorPolicyId !== undefined && !nonEmpty(node.executorPolicyId)) return false;
    if (node.retryPolicyId !== undefined && !nonEmpty(node.retryPolicyId)) return false;
    if (node.requiredGateIds.some((id) => !nonEmpty(id))) return false;
    for (const output of node.outputContracts) {
      if (!nonEmpty(output.contractId) || !nonEmpty(output.schemaRef)) return false;
    }
  }

  for (const edge of graph.edges) {
    if (
      !nonEmpty(edge.edgeId) ||
      !nonEmpty(edge.fromNodeId) ||
      !nonEmpty(edge.toNodeId) ||
      edge.gateIds.some((id) => !nonEmpty(id)) ||
      edge.policyIds.some((id) => !nonEmpty(id))
    ) {
      return false;
    }
  }

  if (
    graph.entryNodeIds.some((id) => !nonEmpty(id)) ||
    graph.terminalNodeIds.some((id) => !nonEmpty(id))
  ) {
    return false;
  }

  return true;
}
