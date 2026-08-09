# Execution Dispatcher Contract v1

Status: CONTRACT FOR RED TESTS
Phase: 8 — Generic Dispatcher TDD
Depends on:
- `RFC-003 — Durable Execution Orchestration`
- `contracts/execution.ts`
- `contracts/execution-store.ts`
- `contracts/dispatcher.ts`

## 1. Purpose

Define the generic delivery/reconciliation component between a durable `ExecutionStore` and one already-selected `ExecutorPort`.

Phase 8 proves orchestration semantics independently from OMP and independently from executor-selection policy.

## 2. Authority boundary

The dispatcher MAY:

- load durable execution state;
- create/commit a lease through `ExecutionStore.claim`;
- invoke `ExecutorPort.start` only after a durable claim exists;
- invoke `ExecutorPort.getStatus` using the stable execution ID;
- persist RUNNING state/executor reference through `markRunning`;
- persist terminal results through `recordResult`.

The dispatcher MUST NOT:

- mutate authoritative graph state or journal;
- approve gates or policies;
- create a new graph execution attempt;
- change an `ExecutionIntent`;
- invent another `ExecutionId` during retry/reconciliation;
- select between multiple executors in Phase 8;
- import or depend on OMP-specific types.

## 3. Construction

Production module path:

`src/orchestration/dispatcher/create-execution-dispatcher.ts`

Constructor:

```ts
createExecutionDispatcher({
  store,
  executor,
  workerId,
  clock,
  leaseFactory,
}): ExecutionDispatcher
```

Clock and lease creation are injected so claim/recovery behavior is deterministic and testable.

The lease factory MUST return a lease for the requested `executionId`/worker activation context; the store remains the authority that validates lease shape/time.

## 4. Dispatch precondition

`dispatch(executionId)` first loads the durable execution.

If no durable execution exists:

- return `NOT_FOUND`;
- do not call `ExecutorPort.start`;
- do not call `ExecutorPort.getStatus`.

If execution is `PENDING`:

- generate a lease using explicit injected time;
- commit the claim;
- only after `CLAIMED` succeeds may executor start occur.

If execution is already `CLAIMED` with an unexpired lease owned by this dispatcher worker:

- the existing lease may be reused;
- do not create a new attempt or execution ID.

If another worker owns an unexpired lease:

- return `CLAIM_UNAVAILABLE/CLAIM_CONFLICT`;
- do not call executor.

If existing `CLAIMED` or `RUNNING` lease is expired:

- reclaim through `ExecutionStore.claim` using a new lease and the same execution ID;
- reconcile external state before assuming whether start is required.

Terminal executions return their existing terminal state and do not invoke executor start.

## 5. Start request

Every `ExecutorStartRequest` MUST derive exclusively from the immutable durable intent:

- exact execution ID;
- run ID;
- graph ID/version;
- node ID;
- attempt;
- bound artifact/evidence/approval IDs.

Dispatcher MUST NOT rewrite these bindings.

## 6. STARTED

When `ExecutorPort.start` returns `STARTED`:

- persist `RUNNING` using the current durable lease;
- persist the exact returned executor reference;
- return `RUNNING` only after the store accepts the transition.

## 7. ALREADY_STARTED

When start returns `ALREADY_STARTED`:

- treat it as the same stable external execution;
- persist/reconcile local RUNNING state using the same execution ID;
- never create another attempt.

## 8. ALREADY_COMPLETED

When start returns `ALREADY_COMPLETED`:

- validate/persist the returned terminal result under the current lease;
- return `TERMINAL` only after durable store acceptance;
- never invoke another start for that dispatch call.

## 9. REJECTED

When executor returns `REJECTED`:

- return `EXECUTOR_REJECTED` with the provided error code;
- do not manufacture a terminal `ExecutionResult` because the generic executor contract did not provide one;
- local durable claim remains governed by lease expiry/recovery policy.

Graph failure application remains a later application-layer transition, not a dispatcher side effect.

## 10. Uncertain start outcome

If `ExecutorPort.start` throws or otherwise yields no trustworthy semantic result:

- do not invent a new attempt;
- immediately query `ExecutorPort.getStatus(executionId)` with the same stable ID.

Status handling:

- `RUNNING` -> persist local RUNNING using returned executor reference;
- `SUCCEEDED` / `FAILED` -> persist terminal result;
- `NOT_FOUND` -> return `RETRY_SAME_ID`; a later dispatch may call start again using the same intent/attempt/ID;
- `UNKNOWN` -> return `OUTCOME_UNKNOWN`; do not issue an immediate blind second start.

## 11. Explicit reconciliation

`reconcile(executionId)` is used after restart/uncertain outcome.

It MUST:

- load durable execution;
- never create a new execution attempt;
- obtain a current usable claim before mutating local lifecycle state;
- call `getStatus` with exactly the durable execution ID;
- persist RUNNING or terminal state when trustworthy external status exists.

If the execution has an unexpired lease owned by another worker, reconciliation may observe external status but MUST NOT mutate durable local state until the lease can be validly reclaimed. Phase 8 implementation may return `CLAIM_UNAVAILABLE` without an external call in this situation.

## 12. Store write failures

A successful external response does not override local authority.

If `markRunning` or `recordResult` rejects the current lease/state:

- dispatcher returns `CLAIM_UNAVAILABLE` with a typed local-state reason;
- dispatcher does not report RUNNING/TERMINAL as durably accepted;
- later reconciliation must reuse the same execution ID.

## 13. Restart cases

The accepted dispatcher must support:

- executor actually started, local RUNNING write missing -> after lease recovery, `getStatus(same executionId)` restores RUNNING;
- executor completed, local terminal write missing -> after lease recovery, reconciliation persists terminal result;
- terminal result already durable, graph transition not committed -> dispatcher leaves graph authority unchanged and terminal result remains queryable.

## 14. Generic-port security boundary

`ExecutorPort` exposes only:

- `start`
- `getStatus`

It exposes no graph commit, gate approval, policy mutation, journal write, or graph-state transition API.

## 15. Acceptance

Phase 8 must prove via executable tests:

- ORCH-031..040;
- ORCH-050..052;
- ORCH-055;
- stable intent bindings in every start request;
- no OMP imports/types;
- no graph-authority mutation surface;
- complete existing domain/persistence/orchestration suites remain green.
