import type {
  ExecutionId,
  ExecutionProjector,
  GraphDefinitionRegistry,
  ProjectorId,
  ProjectJournalEntryRequest,
} from "../../../contracts/execution";
import type {
  JournalEntry,
  JournalSequence,
} from "../../../contracts/persistence";
import type {
  ProjectionExecutionStore,
  ProjectionRunnerFailureCode,
} from "../../../contracts/projection-runner";

export type ProjectOneEntryResult =
  | {
      readonly status: "PROJECTED";
      readonly checkpoint: JournalSequence;
      readonly executionIds: readonly ExecutionId[];
    }
  | {
      readonly status: "BLOCKED";
      readonly code: ProjectionRunnerFailureCode;
      readonly sequence: JournalSequence;
    };

export interface ProjectOneEntryOptions {
  readonly entry: JournalEntry;
  readonly previousSequence?: JournalSequence;
  readonly registry: GraphDefinitionRegistry;
  readonly projector: ExecutionProjector;
  readonly store: ProjectionExecutionStore;
  readonly projectorId: ProjectorId;
}

export async function projectOneJournalEntry(
  options: ProjectOneEntryOptions,
): Promise<ProjectOneEntryResult> {
  const { entry, previousSequence, registry, projector, store, projectorId } = options;

  const graphResult = await registry.get(entry.graphId, entry.graphVersion);
  if (graphResult.status === "NOT_FOUND") {
    return {
      status: "BLOCKED",
      code: "GRAPH_DEFINITION_MISSING",
      sequence: entry.sequence,
    };
  }
  if (graphResult.status === "INTEGRITY_ERROR") {
    return {
      status: "BLOCKED",
      code: "GRAPH_DEFINITION_INVALID",
      sequence: entry.sequence,
    };
  }

  const graph = graphResult.graph;
  if (graph.graphId !== entry.graphId || graph.graphVersion !== entry.graphVersion) {
    return {
      status: "BLOCKED",
      code: "GRAPH_DEFINITION_INVALID",
      sequence: entry.sequence,
    };
  }

  const projection = projector.derive(entry, graph, entry.committedAt);
  if (projection.status === "INTEGRITY_ERROR") {
    return {
      status: "BLOCKED",
      code: "PROJECTION_INTEGRITY_FAILURE",
      sequence: entry.sequence,
    };
  }

  const requestBase = {
    projectorId,
    entry,
    graph,
    derivedIntents: projection.projection.intents,
  };
  const request: ProjectJournalEntryRequest =
    previousSequence === undefined
      ? requestBase
      : { ...requestBase, expectedCheckpoint: previousSequence };

  const projected = await store.projectJournalEntry(request);
  if (projected.status === "CHECKPOINT_CONFLICT") {
    return {
      status: "BLOCKED",
      code: "CHECKPOINT_CONFLICT",
      sequence: entry.sequence,
    };
  }
  if (projected.status === "INTEGRITY_ERROR") {
    return {
      status: "BLOCKED",
      code: "EXECUTION_STORE_INTEGRITY_ERROR",
      sequence: entry.sequence,
    };
  }

  return {
    status: "PROJECTED",
    checkpoint: projected.checkpoint.processedThroughSequence,
    executionIds: projected.executionIds,
  };
}
