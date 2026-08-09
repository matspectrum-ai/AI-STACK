import type {
  ApprovalId,
  ArtifactId,
  EvidenceId,
  NodeId,
  PolicyId,
} from "../../../contracts/domain";
import type {
  ExecutionGraphDefinition,
  ExecutionId,
  ExecutionIntent,
  ExecutionNodeDefinition,
  ExecutionProjectionResult,
  ExecutionProjector,
} from "../../../contracts/execution";
import type { JournalEntry } from "../../../contracts/persistence";
import { createGraphKernel } from "../../domain/create-graph-kernel";

const graphKernel = createGraphKernel();

function projection(
  intents: readonly ExecutionIntent[],
): ExecutionProjectionResult {
  return { status: "PROJECTED", projection: { intents } };
}

function integrity(
  code: "PROJECTION_INTEGRITY_FAILURE" | "GRAPH_DEFINITION_INVALID",
): ExecutionProjectionResult {
  return { status: "INTEGRITY_ERROR", code };
}

function validateExecutionGraph(graph: ExecutionGraphDefinition): boolean {
  if (graphKernel.validateGraph(graph).length > 0) return false;
  return graph.nodes.every(
    (node) => node.executionMode === "control" || node.executionMode === "dispatch",
  );
}

function deriveExecutionId(
  entry: JournalEntry,
  nodeId: NodeId,
  attempt: number,
): ExecutionId {
  const parts = [
    entry.runId,
    entry.graphVersion,
    String(Number(entry.sequence)),
    nodeId,
    String(attempt),
  ].map((part) => encodeURIComponent(part));

  return `execution:v1:${parts.join(":")}` as ExecutionId;
}

function findNode(
  graph: ExecutionGraphDefinition,
  nodeId: NodeId,
): ExecutionNodeDefinition | undefined {
  return graph.nodes.find((node) => node.nodeId === nodeId);
}

function createIntent(
  entry: JournalEntry,
  node: ExecutionNodeDefinition,
  attempt: number,
  createdAt: string,
  bindings: {
    readonly artifactIds?: readonly ArtifactId[];
    readonly evidenceIds?: readonly EvidenceId[];
    readonly approvalIds?: readonly ApprovalId[];
  } = {},
): ExecutionIntent {
  const base = {
    executionId: deriveExecutionId(entry, node.nodeId, attempt),
    runId: entry.runId,
    graphId: entry.graphId,
    graphVersion: entry.graphVersion,
    nodeId: node.nodeId,
    sourceJournalSequence: entry.sequence,
    sourceOperationId: entry.operationId,
    attempt,
    status: "PENDING" as const,
    boundArtifactIds: [...(bindings.artifactIds ?? [])],
    boundEvidenceIds: [...(bindings.evidenceIds ?? [])],
    boundApprovalIds: [...(bindings.approvalIds ?? [])],
    createdAt,
  };

  return node.executorPolicyId === undefined
    ? base
    : { ...base, executorPolicyId: node.executorPolicyId as PolicyId };
}

function graphMatchesEntry(
  entry: JournalEntry,
  graph: ExecutionGraphDefinition,
): boolean {
  return entry.graphId === graph.graphId && entry.graphVersion === graph.graphVersion;
}

function deriveTransition(
  entry: JournalEntry,
  graph: ExecutionGraphDefinition,
  createdAt: string,
): ExecutionProjectionResult {
  if (entry.operation.kind !== "transition_committed") {
    return integrity("PROJECTION_INTEGRITY_FAILURE");
  }

  const decision = entry.operation.decision;
  if (
    decision.runId !== entry.runId ||
    decision.graphId !== entry.graphId ||
    decision.graphVersion !== entry.graphVersion ||
    decision.decision !== "ALLOW"
  ) {
    return integrity("PROJECTION_INTEGRITY_FAILURE");
  }

  const edge = graph.edges.find((candidate) => candidate.edgeId === decision.edgeId);
  if (!edge) return integrity("PROJECTION_INTEGRITY_FAILURE");

  const destination = findNode(graph, edge.toNodeId);
  if (!destination) return integrity("PROJECTION_INTEGRITY_FAILURE");
  if (destination.executionMode === "control") return projection([]);

  return projection([
    createIntent(entry, destination, 1, createdAt, {
      artifactIds: decision.boundArtifactIds,
      evidenceIds: decision.boundEvidenceIds,
      approvalIds: decision.boundApprovalIds,
    }),
  ]);
}

function deriveRetry(
  entry: JournalEntry,
  graph: ExecutionGraphDefinition,
  createdAt: string,
): ExecutionProjectionResult {
  if (entry.operation.kind !== "retry_activated") {
    return integrity("PROJECTION_INTEGRITY_FAILURE");
  }

  const attempt = entry.operation.nextAttempt;
  if (!Number.isInteger(attempt) || attempt < 1) {
    return integrity("PROJECTION_INTEGRITY_FAILURE");
  }

  const node = findNode(graph, entry.operation.activationNodeId);
  if (!node) return integrity("PROJECTION_INTEGRITY_FAILURE");
  if (node.executionMode === "control") return projection([]);

  return projection([createIntent(entry, node, attempt, createdAt)]);
}

function deriveRecovery(
  entry: JournalEntry,
  graph: ExecutionGraphDefinition,
  createdAt: string,
): ExecutionProjectionResult {
  if (entry.operation.kind !== "recovery_activated") {
    return integrity("PROJECTION_INTEGRITY_FAILURE");
  }

  const node = findNode(graph, entry.operation.recoveryNodeId);
  if (!node) return integrity("PROJECTION_INTEGRITY_FAILURE");
  if (node.executionMode === "control") return projection([]);

  return projection([createIntent(entry, node, 1, createdAt)]);
}

function derive(
  entry: JournalEntry,
  graph: ExecutionGraphDefinition,
  createdAt: string,
): ExecutionProjectionResult {
  if (!validateExecutionGraph(graph)) {
    return integrity("GRAPH_DEFINITION_INVALID");
  }

  if (!graphMatchesEntry(entry, graph)) {
    return integrity("PROJECTION_INTEGRITY_FAILURE");
  }

  switch (entry.operation.kind) {
    case "run_created":
    case "failure_recorded":
      return projection([]);
    case "transition_committed":
      return deriveTransition(entry, graph, createdAt);
    case "retry_activated":
      return deriveRetry(entry, graph, createdAt);
    case "recovery_activated":
      return deriveRecovery(entry, graph, createdAt);
  }
}

export function createExecutionProjector(): ExecutionProjector {
  return { derive };
}
