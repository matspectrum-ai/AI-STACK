import type {
  ContentDigest,
  EdgeId,
  FailureId,
  FailureRecord,
  GraphId,
  GraphRunState,
  NodeId,
  RetryPolicyId,
  RunId,
  StateRevision,
  TransitionDecision,
} from "./domain";

export type OperationId = string & { readonly __brand: "OperationId" };
export type JournalSequence = number & { readonly __brand: "JournalSequence" };

export type PersistenceIntegrityCode =
  | "MALFORMED_PERSISTED_STATE"
  | "SNAPSHOT_JOURNAL_REVISION_MISMATCH"
  | "GRAPH_BINDING_MISMATCH"
  | "DUPLICATE_JOURNAL_SEQUENCE"
  | "JOURNAL_SEQUENCE_GAP"
  | "JOURNAL_REVISION_REGRESSION"
  | "IDEMPOTENCY_BINDING_MISMATCH"
  | "INVALID_COMMIT_STRUCTURE";

export interface IntegrityError {
  readonly code: PersistenceIntegrityCode;
}

export interface CommitReceipt {
  readonly operationId: OperationId;
  readonly stateRevision: StateRevision;
  readonly journalSequence: JournalSequence;
}

export interface PersistedRunSnapshot {
  readonly state: GraphRunState;
  readonly journalHeadSequence: JournalSequence;
}

export interface RunCreatedOperation {
  readonly kind: "run_created";
}

export interface TransitionCommittedOperation {
  readonly kind: "transition_committed";
  readonly decision: TransitionDecision;
}

export interface FailureRecordedOperation {
  readonly kind: "failure_recorded";
  readonly failure: FailureRecord;
}

export interface RetryActivatedOperation {
  readonly kind: "retry_activated";
  readonly governingFailureId: FailureId;
  readonly retryPolicyId: RetryPolicyId;
  readonly retryCounterKey: string;
  readonly nextAttempt: number;
  readonly activationNodeId: NodeId;
}

export interface RecoveryActivatedOperation {
  readonly kind: "recovery_activated";
  readonly governingFailureId: FailureId;
  readonly recoveryEdgeId: EdgeId;
  readonly recoveryNodeId: NodeId;
}

export type StateCommitOperation =
  | TransitionCommittedOperation
  | FailureRecordedOperation
  | RetryActivatedOperation
  | RecoveryActivatedOperation;

export type JournalOperation = RunCreatedOperation | StateCommitOperation;

export interface JournalEntry {
  readonly sequence: JournalSequence;
  readonly operationId: OperationId;
  readonly operationDigest: ContentDigest;
  readonly runId: RunId;
  readonly resultingStateRevision: StateRevision;
  readonly graphId: GraphId;
  readonly graphVersion: string;
  readonly operation: JournalOperation;
  readonly committedAt: string;
}

export interface CreateRunRequest {
  readonly operationId: OperationId;
  readonly operationDigest: ContentDigest;
  readonly initialState: GraphRunState;
}

export type CreateRunResult =
  | {
      readonly status: "CREATED" | "REPLAYED";
      readonly receipt: CommitReceipt;
    }
  | {
      readonly status: "RUN_ALREADY_EXISTS";
      readonly runId: RunId;
    }
  | {
      readonly status: "IDEMPOTENCY_VIOLATION";
      readonly operationId: OperationId;
    }
  | {
      readonly status: "INTEGRITY_ERROR";
      readonly error: IntegrityError;
    };

export interface LoadRunRequest {
  readonly runId: RunId;
}

export type LoadRunResult =
  | {
      readonly status: "FOUND";
      readonly snapshot: PersistedRunSnapshot;
    }
  | {
      readonly status: "NOT_FOUND";
      readonly runId: RunId;
    }
  | {
      readonly status: "INTEGRITY_ERROR";
      readonly error: IntegrityError;
    };

export interface CommitStateRequest {
  readonly operationId: OperationId;
  readonly operationDigest: ContentDigest;
  readonly runId: RunId;
  readonly expectedRevision: StateRevision;
  readonly operation: StateCommitOperation;
  readonly nextState: GraphRunState;
}

export type CommitStateResult =
  | {
      readonly status: "COMMITTED" | "REPLAYED";
      readonly receipt: CommitReceipt;
    }
  | {
      readonly status: "CONFLICT";
      readonly currentRevision: StateRevision;
    }
  | {
      readonly status: "IDEMPOTENCY_VIOLATION";
      readonly operationId: OperationId;
    }
  | {
      readonly status: "RUN_NOT_FOUND";
      readonly runId: RunId;
    }
  | {
      readonly status: "INTEGRITY_ERROR";
      readonly error: IntegrityError;
    };

export interface ReadJournalRequest {
  readonly runId: RunId;
  readonly afterSequence?: JournalSequence;
}

export type ReadJournalResult =
  | {
      readonly status: "FOUND";
      readonly entries: readonly JournalEntry[];
      readonly headSequence: JournalSequence;
    }
  | {
      readonly status: "NOT_FOUND";
      readonly runId: RunId;
    }
  | {
      readonly status: "INTEGRITY_ERROR";
      readonly error: IntegrityError;
    };

export interface AuthoritativeStateStore {
  createRun(request: CreateRunRequest): Promise<CreateRunResult>;
  loadRun(request: LoadRunRequest): Promise<LoadRunResult>;
  commit(request: CommitStateRequest): Promise<CommitStateResult>;
  readJournal(request: ReadJournalRequest): Promise<ReadJournalResult>;
}
