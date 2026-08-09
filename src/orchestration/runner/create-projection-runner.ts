import type { RunId } from "../../../contracts/domain";
import type { ExecutionId } from "../../../contracts/execution";
import type { JournalSequence } from "../../../contracts/persistence";
import type {
  CreateProjectionRunnerOptions,
  ProjectionRunner,
  ProjectionRunnerResult,
} from "../../../contracts/projection-runner";
import { projectOneJournalEntry } from "./project-journal-entry";

function validBatchSize(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
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
      const projected = await projectOneJournalEntry(
        previousSequence === undefined
          ? { entry, registry, projector, store, projectorId }
          : {
              entry,
              previousSequence,
              registry,
              projector,
              store,
              projectorId,
            },
      );

      if (projected.status === "BLOCKED") return projected;

      executionIds.push(...projected.executionIds);
      previousSequence = projected.checkpoint;
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
