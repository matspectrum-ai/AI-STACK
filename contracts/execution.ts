import type {
  ApprovalId,
  ArtifactId,
  EvidenceId,
  ExecutorId,
  GraphDefinition,
  GraphId,
  NodeDefinition,
  NodeId,
  PolicyId,
  RunId,
} from "./domain";
import type {
  JournalEntry,
  JournalSequence,
  OperationId,
} from "./persistence";

export type ExecutionId = string & { readonly __brand: "ExecutionId" };
export type LeaseId = string & { readonly __brand: "LeaseId" };
export type ProjectorId = string & { readonly __brand: "ProjectorId" };
export type WorkerId = string & { readonly __brand: "WorkerId" };
export type ExecutorReference = string & { readonly __brand: "ExecutorReference" };
export type ExecutionResultReference = string & {
  readonly __brand: "ExecutionResultReference";
};

export type ExecutionMode = "control" | "dispatch";
export type ExecutionStatus =
  | "PENDING"
  | "CLAIMED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED";

export type OrchestrationFailureCode =
  | "PROJECTION_INTEGRITY_FAILURE"
  | "CHECKPOINT_CONFLICT"
  | "CLAIM_CONFLICT"
  | "LEASE_EXPIRED"
  | "STALE_LEASE"
  | "EXECUTOR_REJECTED"
  | "EXECUTOR_OUTCOME_UNKNOWN"
  | "RESULT_CONFLICT"
  | "GRAPH_DEFINITION_MISSING"
  | "GRAPH_DEFINITION_INVALID"
  | "EXECUTION_INTENT_CONFLICT"
  | "INVALID_EXECUTION_TRANSITION";

export interface ExecutionNodeDefinition extends NodeDefinition {
  readonly executionMode: ExecutionMode;
}

export interface ExecutionGraphDefinition
  extends Omit<GraphDefinition, "nodes"> {
  readonly nodes: readonly ExecutionNodeDefinition[];
}

export interface ExecutionIntent {
  readonly executionId: ExecutionId;
  readonly runId: RunId;
  readonly graphId: GraphId;
  readonly graphVersion: string;
  readonly nodeId: NodeId;
  readonly sourceJournalSequence: JournalSequence;
  readonly sourceOperationId: OperationId;
  readonly attempt: number;
  readonly status: "PENDING";
  readonly boundArtifactIds: readonly ArtifactId[];
  readonly boundEvidenceIds: readonly EvidenceId[];
  readonly boundApprovalIds: readonly ApprovalId[];
  readonly executorPolicyId?: PolicyId;
  readonly createdAt: string;
}

export interface ProjectionCheckpoint {
  readonly projectorId: ProjectorId;
  readonly runId: RunId;
  readonly processedThroughSequence: JournalSequence;
}

export interface ExecutionLease {
  readonly leaseId: LeaseId;
  readonly workerId: WorkerId;
  readonly claimedAt: string;
  readonly expiresAt: string;
}

export interface StoredExecution {
  readonly intent: ExecutionIntent;
  readonly status: ExecutionStatus;
  readonly lease?: ExecutionLease;
  readonly executorRef?: ExecutorReference;
  readonly terminalResult?: ExecutionResult;
}

export interface ExecutionResult {
  readonly executionId: ExecutionId;
  readonly outcome: "SUCCEEDED" | "FAILED";
  readonly resultRef?: ExecutionResultReference;
  readonly errorCode?: string;
  readonly completedAt: string;
}

export interface ProjectJournalEntryRequest {
  readonly projectorId: ProjectorId;
  readonly entry: JournalEntry;
  readonly graph: ExecutionGraphDefinition;
  readonly expectedCheckpoint?: JournalSequence;
  readonly derivedIntents: readonly ExecutionIntent[];
}

export type ProjectJournalEntryResult =
  | {
      readonly status: "PROJECTED";
      readonly checkpoint: ProjectionCheckpoint;
      readonly executionIds: readonly ExecutionId[];
    }
  | {
      readonly status: "REPLAYED";
      readonly checkpoint: ProjectionCheckpoint;
      readonly executionIds: readonly ExecutionId[];
    }
  | {
      readonly status: "CHECKPOINT_CONFLICT";
      readonly currentCheckpoint?: ProjectionCheckpoint;
    }
  | {
      readonly status: "INTEGRITY_ERROR";
      readonly code: OrchestrationFailureCode;
    };

export interface GetCheckpointRequest {
  readonly projectorId: ProjectorId;
  readonly runId: RunId;
}

export type GetCheckpointResult =
  | {
      readonly status: "FOUND";
      readonly checkpoint: ProjectionCheckpoint;
    }
  | {
      readonly status: "NOT_FOUND";
    }
  | {
      readonly status: "INTEGRITY_ERROR";
      readonly code: OrchestrationFailureCode;
    };

export interface ListPendingRequest {
  readonly limit: number;
}

export interface ClaimExecutionRequest {
  readonly executionId: ExecutionId;
  readonly lease: ExecutionLease;
  readonly now: string;
}

export type ClaimExecutionResult =
  | {
      readonly status: "CLAIMED";
      readonly execution: StoredExecution;
    }
  | {
      readonly status: "NOT_FOUND";
    }
  | {
      readonly status: "CLAIM_CONFLICT";
      readonly currentLease?: ExecutionLease;
    }
  | {
      readonly status: "INTEGRITY_ERROR";
      readonly code: OrchestrationFailureCode;
    };

export interface MarkRunningRequest {
  readonly executionId: ExecutionId;
  readonly leaseId: LeaseId;
  readonly executorRef: ExecutorReference;
  readonly now: string;
}

export type MarkRunningResult =
  | {
      readonly status: "RUNNING";
      readonly execution: StoredExecution;
    }
  | {
      readonly status: "NOT_FOUND";
    }
  | {
      readonly status: "STALE_LEASE" | "LEASE_EXPIRED";
    }
  | {
      readonly status: "INTEGRITY_ERROR";
      readonly code: OrchestrationFailureCode;
    };

export interface RecordExecutionResultRequest {
  readonly executionId: ExecutionId;
  readonly leaseId: LeaseId;
  readonly result: ExecutionResult;
  readonly now: string;
}

export type RecordExecutionResultResult =
  | {
      readonly status: "RECORDED" | "REPLAYED";
      readonly execution: StoredExecution;
    }
  | {
      readonly status: "NOT_FOUND";
    }
  | {
      readonly status: "STALE_LEASE" | "LEASE_EXPIRED";
    }
  | {
      readonly status: "RESULT_CONFLICT";
    }
  | {
      readonly status: "INTEGRITY_ERROR";
      readonly code: OrchestrationFailureCode;
    };

export interface ExecutionStore {
  projectJournalEntry(
    request: ProjectJournalEntryRequest,
  ): Promise<ProjectJournalEntryResult>;

  getCheckpoint(request: GetCheckpointRequest): Promise<GetCheckpointResult>;

  getExecution(executionId: ExecutionId): Promise<StoredExecution | undefined>;

  listPending(request: ListPendingRequest): Promise<readonly StoredExecution[]>;

  claim(request: ClaimExecutionRequest): Promise<ClaimExecutionResult>;

  markRunning(request: MarkRunningRequest): Promise<MarkRunningResult>;

  recordResult(
    request: RecordExecutionResultRequest,
  ): Promise<RecordExecutionResultResult>;
}

export interface GraphDefinitionRegistry {
  get(
    graphId: GraphId,
    graphVersion: string,
  ): Promise<GraphDefinitionLookupResult>;
}

export type GraphDefinitionLookupResult =
  | {
      readonly status: "FOUND";
      readonly graph: ExecutionGraphDefinition;
    }
  | {
      readonly status: "NOT_FOUND";
    }
  | {
      readonly status: "INTEGRITY_ERROR";
      readonly code: OrchestrationFailureCode;
    };

export interface ExecutionProjection {
  readonly intents: readonly ExecutionIntent[];
}

export interface ExecutionProjector {
  derive(
    entry: JournalEntry,
    graph: ExecutionGraphDefinition,
    createdAt: string,
  ): ExecutionProjection;
}

export interface ExecutorStartRequest {
  readonly executionId: ExecutionId;
  readonly runId: RunId;
  readonly graphId: GraphId;
  readonly graphVersion: string;
  readonly nodeId: NodeId;
  readonly attempt: number;
  readonly boundArtifactIds: readonly ArtifactId[];
  readonly boundEvidenceIds: readonly EvidenceId[];
  readonly boundApprovalIds: readonly ApprovalId[];
}

export type ExecutorStartResult =
  | {
      readonly status: "STARTED" | "ALREADY_STARTED";
      readonly executorRef: ExecutorReference;
    }
  | {
      readonly status: "ALREADY_COMPLETED";
      readonly executorRef: ExecutorReference;
      readonly result: ExecutionResult;
    }
  | {
      readonly status: "REJECTED";
      readonly errorCode: string;
    };

export type ExecutorStatusResult =
  | {
      readonly status: "NOT_FOUND" | "UNKNOWN";
    }
  | {
      readonly status: "RUNNING";
      readonly executorRef: ExecutorReference;
    }
  | {
      readonly status: "SUCCEEDED" | "FAILED";
      readonly executorRef: ExecutorReference;
      readonly result: ExecutionResult;
    };

export interface ExecutorPort {
  start(request: ExecutorStartRequest): Promise<ExecutorStartResult>;
  getStatus(executionId: ExecutionId): Promise<ExecutorStatusResult>;
}

export interface DispatcherSelection {
  readonly executorId: ExecutorId;
  readonly executor: ExecutorPort;
}
