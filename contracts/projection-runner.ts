import type { RunId } from "./domain";
import type {
  ExecutionId,
  ExecutionProjector,
  GraphDefinitionRegistry,
  ExecutionStore,
  ProjectorId,
} from "./execution";
import type {
  AuthoritativeStateStore,
  JournalSequence,
} from "./persistence";

/** Read-only authority boundary: the runner can consume journal history but cannot mutate graph state. */
export type AuthoritativeJournalReader = Pick<
  AuthoritativeStateStore,
  "readJournal"
>;

/** Projection-only derived-state boundary: the runner cannot claim, dispatch, or record executor results. */
export type ProjectionExecutionStore = Pick<
  ExecutionStore,
  "getCheckpoint" | "projectJournalEntry"
>;

export interface CreateProjectionRunnerOptions {
  readonly journal: AuthoritativeJournalReader;
  readonly registry: GraphDefinitionRegistry;
  readonly projector: ExecutionProjector;
  readonly store: ProjectionExecutionStore;
  readonly projectorId: ProjectorId;
  readonly batchSize: number;
}

export type ProjectionRunnerFailureCode =
  | "AUTHORITATIVE_INTEGRITY_ERROR"
  | "GRAPH_DEFINITION_MISSING"
  | "GRAPH_DEFINITION_INVALID"
  | "PROJECTION_INTEGRITY_FAILURE"
  | "CHECKPOINT_CONFLICT"
  | "EXECUTION_STORE_INTEGRITY_ERROR";

export type ProjectionRunnerResult =
  | {
      readonly status: "IDLE";
      readonly processedThroughSequence?: JournalSequence;
    }
  | {
      readonly status: "PROGRESSED";
      readonly processedEntries: number;
      readonly processedThroughSequence: JournalSequence;
      readonly executionIds: readonly ExecutionId[];
    }
  | {
      readonly status: "RUN_NOT_FOUND";
      readonly runId: RunId;
    }
  | {
      readonly status: "BLOCKED";
      readonly code: ProjectionRunnerFailureCode;
      readonly sequence?: JournalSequence;
    };

export interface ProjectionRunner {
  run(runId: RunId): Promise<ProjectionRunnerResult>;
}

export type CreateProjectionRunner = (
  options: CreateProjectionRunnerOptions,
) => ProjectionRunner;
