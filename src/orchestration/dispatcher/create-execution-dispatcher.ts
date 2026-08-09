import type {
  ClaimExecutionResult,
  ExecutionId,
  ExecutionIntent,
  ExecutionLease,
  ExecutionResult,
  ExecutorStartRequest,
  ExecutorStartResult,
  ExecutorStatusResult,
  MarkRunningResult,
  RecordExecutionResultResult,
  StoredExecution,
} from "../../../contracts/execution";
import type {
  CreateExecutionDispatcherOptions,
  DispatchResult,
  DispatcherStateFailure,
  ExecutionDispatcher,
} from "../../../contracts/dispatcher";

interface UsableClaim {
  readonly execution: StoredExecution;
  readonly lease: ExecutionLease;
  readonly reclaimed: boolean;
}

type ClaimPreparation =
  | { readonly status: "READY"; readonly claim: UsableClaim }
  | { readonly status: "RESULT"; readonly result: DispatchResult };

function isTerminal(execution: StoredExecution): boolean {
  return execution.status === "SUCCEEDED" || execution.status === "FAILED";
}

function terminalResult(execution: StoredExecution): DispatchResult {
  if (!isTerminal(execution) || execution.terminalResult === undefined) {
    return {
      status: "CLAIM_UNAVAILABLE",
      executionId: execution.intent.executionId,
      reason: "INTEGRITY_ERROR",
    };
  }
  return {
    status: "TERMINAL",
    execution,
    result: execution.terminalResult,
  };
}

function startRequest(intent: ExecutionIntent): ExecutorStartRequest {
  return {
    executionId: intent.executionId,
    runId: intent.runId,
    graphId: intent.graphId,
    graphVersion: intent.graphVersion,
    nodeId: intent.nodeId,
    attempt: intent.attempt,
    boundArtifactIds: [...intent.boundArtifactIds],
    boundEvidenceIds: [...intent.boundEvidenceIds],
    boundApprovalIds: [...intent.boundApprovalIds],
  };
}

function unavailable(
  executionId: ExecutionId,
  reason: DispatcherStateFailure,
): DispatchResult {
  return { status: "CLAIM_UNAVAILABLE", executionId, reason };
}

function claimResultToDispatch(
  executionId: ExecutionId,
  result: Exclude<ClaimExecutionResult, { status: "CLAIMED" }>,
): DispatchResult {
  switch (result.status) {
    case "NOT_FOUND":
      return { status: "NOT_FOUND", executionId };
    case "CLAIM_CONFLICT":
      return unavailable(executionId, "CLAIM_CONFLICT");
    case "INTEGRITY_ERROR":
      return unavailable(executionId, "INTEGRITY_ERROR");
  }
}

function markResultToDispatch(
  executionId: ExecutionId,
  result: Exclude<MarkRunningResult, { status: "RUNNING" }>,
): DispatchResult {
  switch (result.status) {
    case "NOT_FOUND":
      return { status: "NOT_FOUND", executionId };
    case "STALE_LEASE":
      return unavailable(executionId, "STALE_LEASE");
    case "LEASE_EXPIRED":
      return unavailable(executionId, "LEASE_EXPIRED");
    case "INTEGRITY_ERROR":
      return unavailable(executionId, "INTEGRITY_ERROR");
  }
}

function recordResultToDispatch(
  executionId: ExecutionId,
  result: Exclude<RecordExecutionResultResult, { status: "RECORDED" | "REPLAYED" }>,
): DispatchResult {
  switch (result.status) {
    case "NOT_FOUND":
      return { status: "NOT_FOUND", executionId };
    case "STALE_LEASE":
      return unavailable(executionId, "STALE_LEASE");
    case "LEASE_EXPIRED":
      return unavailable(executionId, "LEASE_EXPIRED");
    case "RESULT_CONFLICT":
      return unavailable(executionId, "RESULT_CONFLICT");
    case "INTEGRITY_ERROR":
      return unavailable(executionId, "INTEGRITY_ERROR");
  }
}

function validTimestamp(value: string): boolean {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function createExecutionDispatcher(
  options: CreateExecutionDispatcherOptions,
): ExecutionDispatcher {
  const { store, executor, workerId, clock, leaseFactory } = options;

  async function prepareClaim(executionId: ExecutionId): Promise<ClaimPreparation> {
    const current = await store.getExecution(executionId);
    if (current === undefined) {
      return { status: "RESULT", result: { status: "NOT_FOUND", executionId } };
    }
    if (isTerminal(current)) {
      return { status: "RESULT", result: terminalResult(current) };
    }

    const now = clock.now();
    if (!validTimestamp(now)) {
      return { status: "RESULT", result: unavailable(executionId, "INTEGRITY_ERROR") };
    }

    if (current.lease !== undefined) {
      const leaseExpires = Date.parse(current.lease.expiresAt);
      if (!Number.isNaN(leaseExpires) && leaseExpires > Date.parse(now)) {
        if (current.lease.workerId !== workerId) {
          return {
            status: "RESULT",
            result: unavailable(executionId, "CLAIM_CONFLICT"),
          };
        }
        return {
          status: "READY",
          claim: { execution: current, lease: current.lease, reclaimed: false },
        };
      }
    } else if (current.status !== "PENDING") {
      return { status: "RESULT", result: unavailable(executionId, "INTEGRITY_ERROR") };
    }

    const nextLease = leaseFactory.create({ executionId, workerId, claimedAt: now });
    const claimed = await store.claim({ executionId, lease: nextLease, now });
    if (claimed.status !== "CLAIMED") {
      return {
        status: "RESULT",
        result: claimResultToDispatch(executionId, claimed),
      };
    }
    return {
      status: "READY",
      claim: {
        execution: claimed.execution,
        lease: claimed.execution.lease ?? nextLease,
        reclaimed: current.status === "CLAIMED" || current.status === "RUNNING",
      },
    };
  }

  async function persistRunning(
    executionId: ExecutionId,
    lease: ExecutionLease,
    executorRef: Parameters<typeof store.markRunning>[0]["executorRef"],
  ): Promise<DispatchResult> {
    const current = await store.getExecution(executionId);
    if (
      current !== undefined &&
      current.status === "RUNNING" &&
      current.executorRef === executorRef &&
      current.lease?.leaseId === lease.leaseId
    ) {
      return { status: "RUNNING", execution: current };
    }

    const marked = await store.markRunning({
      executionId,
      leaseId: lease.leaseId,
      executorRef,
      now: clock.now(),
    });
    if (marked.status !== "RUNNING") {
      return markResultToDispatch(executionId, marked);
    }
    return { status: "RUNNING", execution: marked.execution };
  }

  async function persistTerminal(
    executionId: ExecutionId,
    lease: ExecutionLease,
    result: ExecutionResult,
    executorRef?: Parameters<typeof store.markRunning>[0]["executorRef"],
  ): Promise<DispatchResult> {
    if (executorRef !== undefined) {
      const current = await store.getExecution(executionId);
      if (current === undefined) return { status: "NOT_FOUND", executionId };
      if (current.status === "CLAIMED") {
        const marked = await store.markRunning({
          executionId,
          leaseId: lease.leaseId,
          executorRef,
          now: clock.now(),
        });
        if (marked.status !== "RUNNING") {
          return markResultToDispatch(executionId, marked);
        }
      } else if (
        current.status === "RUNNING" &&
        current.executorRef !== executorRef
      ) {
        return unavailable(executionId, "INTEGRITY_ERROR");
      }
    }

    const recorded = await store.recordResult({
      executionId,
      leaseId: lease.leaseId,
      result,
      now: clock.now(),
    });
    if (recorded.status !== "RECORDED" && recorded.status !== "REPLAYED") {
      return recordResultToDispatch(executionId, recorded);
    }
    const terminal = recorded.execution.terminalResult;
    if (terminal === undefined) return unavailable(executionId, "INTEGRITY_ERROR");
    return { status: "TERMINAL", execution: recorded.execution, result: terminal };
  }

  async function handleStatus(
    executionId: ExecutionId,
    claim: UsableClaim,
    status: ExecutorStatusResult,
  ): Promise<DispatchResult> {
    switch (status.status) {
      case "NOT_FOUND":
        return { status: "RETRY_SAME_ID", executionId };
      case "UNKNOWN":
        return { status: "OUTCOME_UNKNOWN", executionId };
      case "RUNNING":
        return persistRunning(executionId, claim.lease, status.executorRef);
      case "SUCCEEDED":
      case "FAILED":
        return persistTerminal(
          executionId,
          claim.lease,
          status.result,
          status.executorRef,
        );
    }
  }

  async function reconcileWithClaim(claim: UsableClaim): Promise<DispatchResult> {
    const executionId = claim.execution.intent.executionId;
    let status: ExecutorStatusResult;
    try {
      status = await executor.getStatus(executionId);
    } catch {
      return { status: "OUTCOME_UNKNOWN", executionId };
    }
    return handleStatus(executionId, claim, status);
  }

  async function handleStart(
    claim: UsableClaim,
    started: ExecutorStartResult,
  ): Promise<DispatchResult> {
    const executionId = claim.execution.intent.executionId;
    switch (started.status) {
      case "STARTED":
      case "ALREADY_STARTED":
        return persistRunning(executionId, claim.lease, started.executorRef);
      case "ALREADY_COMPLETED":
        return persistTerminal(
          executionId,
          claim.lease,
          started.result,
          started.executorRef,
        );
      case "REJECTED":
        return {
          status: "EXECUTOR_REJECTED",
          executionId,
          errorCode: started.errorCode,
        };
    }
  }

  async function dispatch(executionId: ExecutionId): Promise<DispatchResult> {
    const prepared = await prepareClaim(executionId);
    if (prepared.status === "RESULT") return prepared.result;
    const claim = prepared.claim;

    if (claim.execution.status === "RUNNING" || claim.reclaimed) {
      return reconcileWithClaim(claim);
    }

    let started: ExecutorStartResult;
    try {
      started = await executor.start(startRequest(claim.execution.intent));
    } catch {
      return reconcileWithClaim(claim);
    }
    return handleStart(claim, started);
  }

  async function reconcile(executionId: ExecutionId): Promise<DispatchResult> {
    const prepared = await prepareClaim(executionId);
    if (prepared.status === "RESULT") return prepared.result;
    return reconcileWithClaim(prepared.claim);
  }

  return { dispatch, reconcile };
}
