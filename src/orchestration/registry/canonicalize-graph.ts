import type { ExecutionGraphDefinition } from "../../../contracts/execution";

function sortedStrings<T extends string>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function canonicalizeExecutionGraph(
  graph: ExecutionGraphDefinition,
): ExecutionGraphDefinition {
  return {
    graphId: graph.graphId,
    graphVersion: graph.graphVersion,
    nodes: [...graph.nodes]
      .map((node) => ({
        nodeId: node.nodeId,
        kind: node.kind,
        executionMode: node.executionMode,
        requiredArtifactKinds: sortedStrings(node.requiredArtifactKinds),
        requiredGateIds: sortedStrings(node.requiredGateIds),
        ...(node.executorPolicyId !== undefined
          ? { executorPolicyId: node.executorPolicyId }
          : {}),
        ...(node.retryPolicyId !== undefined ? { retryPolicyId: node.retryPolicyId } : {}),
        outputContracts: [...node.outputContracts].sort((a, b) => {
          const byId = a.contractId.localeCompare(b.contractId);
          if (byId !== 0) return byId;
          const byKind = a.artifactKind.localeCompare(b.artifactKind);
          return byKind !== 0 ? byKind : a.schemaRef.localeCompare(b.schemaRef);
        }),
      }))
      .sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
    edges: [...graph.edges]
      .map((edge) => ({
        edgeId: edge.edgeId,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        kind: edge.kind,
        gateIds: sortedStrings(edge.gateIds),
        policyIds: sortedStrings(edge.policyIds),
      }))
      .sort((a, b) => a.edgeId.localeCompare(b.edgeId)),
    entryNodeIds: sortedStrings(graph.entryNodeIds),
    terminalNodeIds: sortedStrings(graph.terminalNodeIds),
  };
}

export function canonicalGraphJson(graph: ExecutionGraphDefinition): string {
  return JSON.stringify(canonicalizeExecutionGraph(graph));
}
