import type { ExecutionStore, StoredExecution } from "./execution";

export interface ListRecoverableRequest {
  readonly now: string;
  readonly limit: number;
}

/**
 * DurableExecutionStore refines the Phase 5 ExecutionStore with the minimum
 * recovery scan required to reconcile work after a dispatcher/process crash.
 */
export interface DurableExecutionStore extends ExecutionStore {
  listRecoverable(
    request: ListRecoverableRequest,
  ): Promise<readonly StoredExecution[]>;
}
