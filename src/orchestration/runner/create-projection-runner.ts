import type { RunId } from "../../../contracts/domain";
import type {
  ExecutionId,
  ProjectJournalEntryRequest,
} from "../../../contracts/execution";
import type { JournalSequence } from "../../../contracts/persistence";
import type {
  CreateProjectionRunnerOptions,
  ProjectionRunner,
  ProjectionRunnerResult,
} from "../../../contracts/projection-runner";

function validBatchSize(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function asSequence(value: number): JournalSequence {
  return value as JournalSequence;
}

export function createProjectionRunner(
  options: CreateProjectionRunnerOptions,
): ProjectionRunner {
  const { journal, registry, projector, store, projectorId, batchSize } = options;

  if (!validBatchSize(batchSize)) {
    throw new Error("batchSize must be a finite positive integer");
  }

  async function run(runId: RunId): Promise<ProjectionRunnerResult> {
    const checkpointResult = await store.getCheckpoint({ projectorId, runId });
    if (checkpointResult.status === "INTEGRITY_ERROR") {
      return { status: "BLOCKED", code: "EXECUTION_STORE_INTEGRITY_ERROR" };
    }

    let previousSequence: JournalSequence | undefined =
      checkpointResult.status === "FOUND"
        ? checkpointResult.checkpoint.processedThroughSequence
        : undefined;

    const journalResult = await journal.readJournal(
      previousSequence === undefined
        ? { runId }
        : { runId, afterSequence: previousSequence },
    );

    if (journalResult.status === "NOT_FOUND") {
      return { status: "RUN_NOT_FOUND", runId };
    }
    if (journalResult.status === "INTEGRITY_ERROR") {
      return { status: "BLOCKED", code: "AUTHORITATIVE_INTEGRITY_ERROR" };
    }

    const entries = journalResult.entries.slice(0, batchSize);
    if (entries.length === 0) {
      return previousSequence === undefined
        ? { status: "IDLE" }
        : { status: "IDLE", processedThroughSequence: previousSequence };
    }

    let expectedSequence =
      previousSequence === undefined ? 0 : Number(previousSequence) + 1;
    for (const entry of entries) {
      if (Number(entry.sequence) !== expectedSequence) {
        return {
          status: "BLOCKED",
          code: "AUTHORITATIVE_INTEGRITY_ERROR",
          sequence: entry.sequence,
        };
      }
      expectedSequence += 1;
    }

    const executionIds: ExecutionId[] = [];
    let processedEntries = 0;

    for (const entry of entries) {
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
      if (
        graph.graphId !== entry.graphId ||
        graph.graphVersion !== entry.graphVersion
      ) {
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

      executionIds.push(...projected.executionIds);
      previousSequence = projected.checkpoint.processedThroughSequence;
      processedEntries += 1;
    }

    if (previousSequence === undefined) {
      return { status: "BLOCKED", code: "EXECUTION_STORE_INTEGRITY_ERROR" };
    }

    return {
      status: "PROGRESSED",
      processedEntries,
      processedThroughSequence: previousSequence,
      executionIds,
    };
  }

  return { run };
}
