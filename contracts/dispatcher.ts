import type {
  ExecutionId,
  ExecutionLease,
  ExecutionResult,
  ExecutorPort,
  StoredExecution,
  WorkerId,
} from "./execution";
import type { DurableExecutionStore } from "./execution-store";

export interface DispatcherClock {
  now(): string;
}

export interface ExecutionLeaseFactory {
  create(request: {
    readonly executionId: ExecutionId;
    readonly workerId: WorkerId;
    readonly claimedAt: string;
  }): ExecutionLease;
}

export interface CreateExecutionDispatcherOptions {
  readonly store: DurableExecutionStore;
  readonly executor: ExecutorPort;
  readonly workerId: WorkerId;
  readonly clock: DispatcherClock;
  readonly leaseFactory: ExecutionLeaseFactory;
}

export type DispatcherStateFailure =
  | "CLAIM_CONFLICT"
  | "STALE_LEASE"
  | "LEASE_EXPIRED"
  | "RESULT_CONFLICT"
  | "INTEGRITY_ERROR";

export type DispatchResult =
  | { readonly status: "NOT_FOUND"; readonly executionId: ExecutionId }
  | {
      readonly status: "CLAIM_UNAVAILABLE";
      readonly executionId: ExecutionId;
      readonly reason: DispatcherStateFailure;
    }
  | {
      readonly status: "RUNNING";
      readonly execution: StoredExecution;
    }
  | {
      readonly status: "TERMINAL";
      readonly execution: StoredExecution;
      readonly result: ExecutionResult;
    }
  | {
      readonly status: "RETRY_SAME_ID";
      readonly executionId: ExecutionId;
    }
  | {
      readonly status: "OUTCOME_UNKNOWN";
      readonly executionId: ExecutionId;
    }
  | {
      readonly status: "EXECUTOR_REJECTED";
      readonly executionId: ExecutionId;
      readonly errorCode: string;
    };

export interface ExecutionDispatcher {
  /** Claim if necessary, then start or reconcile one durable execution. */
  dispatch(executionId: ExecutionId): Promise<DispatchResult>;

  /** Reconcile an already claimed/running durable execution by stable identity. */
  reconcile(executionId: ExecutionId): Promise<DispatchResult>;
}

export type CreateExecutionDispatcher = (
  options: CreateExecutionDispatcherOptions,
) => ExecutionDispatcher;
