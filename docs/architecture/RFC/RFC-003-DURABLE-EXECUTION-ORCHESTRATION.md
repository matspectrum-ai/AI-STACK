# RFC-003 — Durable Execution Orchestration

Status: DRAFT
Date: 2026-08-09
Depends on:
- `docs/architecture/ENGINEERING-GRAPH.md`
- `docs/architecture/RFC/RFC-002-AUTHORITATIVE-STATE-PERSISTENCE.md`
- `docs/contracts/AUTHORITATIVE-STATE-STORE.md`

## 1. Problem

AI-STACK can now make deterministic graph decisions and durably commit authoritative state. It still cannot safely dispatch executor work.

A direct sequence such as:

```text
commit authoritative transition
        ↓
call executor.start()
```

contains an unrecoverable crash window. If the process dies after the commit but before dispatch, the graph says work is active while no executor received it. If dispatch occurs and the process dies before recording that fact, restart may dispatch the same work again.

The system therefore needs a durable execution-orchestration boundary between authoritative graph state and OMP or any other executor.

## 2. Objective

Provide crash-recoverable, idempotent orchestration from committed Engineering Graph history to executor work without giving executors authority over graph state.

## 3. Non-goals

RFC-003 does not define:

- OMP SDK method mappings;
- model/provider selection;
- policy-engine implementation;
- evidence payload storage;
- canonical operation digest generation;
- distributed consensus;
- globally exactly-once external side effects.

## 4. Delivery semantics

AI-STACK orchestration is **at-least-once at the dispatch boundary**.

Exactly-once external execution cannot be guaranteed solely by the orchestrator across crashes and process boundaries. Therefore executor adapters MUST provide one of the following for each stable `execution_id`:

1. idempotent `start(execution_id, request)` semantics; or
2. durable status reconciliation sufficient to distinguish already-started work before a retry starts duplicate work.

An executor adapter that supports neither is non-conforming for authoritative orchestration.

## 5. Journal as durable outbox

The accepted authoritative journal becomes the source for execution projection.

AI-STACK MUST NOT require a cross-store atomic transaction between graph-state persistence and executor-dispatch persistence.

Instead:

```text
AuthoritativeStateStore journal
        ↓
ExecutionProjector
        ↓
ExecutionStore
        ↓
Dispatcher
        ↓
ExecutorPort
```

The projector derives execution intents deterministically from committed journal records plus the immutable graph definition.

If the process crashes after graph commit but before intent creation, replaying the authoritative journal recreates the missing intent.

## 6. Execution intent

An `ExecutionIntent` is a durable declaration that one graph node execution is eligible for dispatch.

Minimum identity:

- stable `execution_id`;
- run ID;
- graph ID/version;
- node ID;
- source journal sequence;
- source operation ID;
- execution attempt number;
- executor requirements;
- bound artifact/evidence/approval references required as execution inputs;
- creation metadata.

`execution_id` MUST be deterministic from authoritative source identity or otherwise stably persisted before dispatch.

The same authoritative source event MUST NOT project to multiple distinct execution IDs for the same execution attempt.

## 7. Projection rules

The projector consumes journal records in ascending sequence order.

### Transition commit

For `transition_committed`:

1. resolve the immutable graph definition identified by the journal graph ID/version;
2. resolve the edge from the decision;
3. resolve the destination node;
4. determine whether the destination node requires external execution;
5. if executable, derive exactly one execution intent for that activation/attempt;
6. if non-executable/evaluation-only, derive no executor intent.

### Retry activation

For `retry_activated`, derive an intent for the declared activation node and explicit next attempt.

### Recovery activation

For `recovery_activated`, derive an intent only if the declared recovery node is externally executable.

### Other operations

`run_created` and `failure_recorded` do not directly create executor intents.

## 8. Projection checkpoint

Projection progress MUST be durable per run/projector identity.

A checkpoint records the highest authoritative journal sequence that has been completely considered.

Rules:

- checkpoint advancement occurs only after all intent effects for that journal entry are durable;
- projector restart resumes after the durable checkpoint;
- replay of an already-processed journal entry MUST be idempotent;
- checkpoint corruption or a gap in authoritative journal input MUST fail closed;
- a checkpoint MUST NOT advance past an unprocessed journal entry.

## 9. Execution store

Execution orchestration uses an AI-STACK-owned `ExecutionStore` port.

It persists:

- execution intents;
- projection checkpoints;
- dispatch claims/leases;
- execution status;
- executor result references;
- timestamps needed for lease/reconciliation behavior.

The execution store is not authoritative graph state. It is durable orchestration state derived from graph authority.

## 10. Execution lifecycle

Initial v1 status model:

```text
PENDING
  ↓ claim
CLAIMED
  ↓ executor acknowledges started
RUNNING
  ↓ result
SUCCEEDED | FAILED
```

Optional terminal status:

- `CANCELLED`, only after a later cancellation contract is accepted.

v1 does not implicitly create `CANCELLED` behavior.

## 11. Claims and leases

A dispatcher MUST claim an intent before calling an executor.

A claim contains:

- execution ID;
- worker/dispatcher ID;
- lease token;
- claimed-at timestamp;
- lease expiration timestamp.

Rules:

- only one unexpired claim is authoritative for an execution at a time;
- an unexpired lease MUST NOT be stolen;
- an expired lease MAY be reclaimed;
- claim/lease transitions are compare-and-swap or transactionally serialized;
- dispatch MUST NOT occur before the claim is durable.

## 12. Start protocol

After a durable claim, dispatcher calls:

```text
ExecutorPort.start(execution_request)
```

The request MUST contain stable `execution_id` and attempt identity.

Possible executor-start outcomes conceptually include:

- `STARTED`;
- `ALREADY_STARTED`;
- `ALREADY_COMPLETED`;
- `REJECTED`;
- infrastructure/unknown outcome.

An unknown start outcome MUST NOT cause the orchestrator to invent a fresh execution ID. It reconciles/retries using the same execution identity.

## 13. Reconciliation

`ExecutorPort` MUST support status reconciliation for a stable execution ID when the start/result outcome is uncertain.

Conceptual states:

- `NOT_FOUND`;
- `RUNNING`;
- `SUCCEEDED`;
- `FAILED`;
- `UNKNOWN`.

The orchestrator uses reconciliation before redispatch where duplicate execution could occur.

## 14. Result handling

Executor completion is not automatically authoritative Engineering Graph progress.

Result flow:

```text
Executor result
    ↓
ExecutionStore records result/ref
    ↓
validation / artifact-evidence production
    ↓
GraphKernel evaluates next transition
    ↓
AuthoritativeStateStore commit
```

An executor MUST NOT directly:

- activate/deactivate graph nodes;
- mark a gate passed;
- create an approval;
- advance graph state;
- mutate the authoritative journal.

## 15. Crash matrix

### Crash A — graph commit succeeded, projector did not run

Recovery: replay journal after checkpoint; derive missing intent.

### Crash B — intent persisted, dispatch not attempted

Recovery: pending-intent scan claims and dispatches it.

### Crash C — claim persisted, crash before executor start

Recovery: wait for/reclaim expired lease, then reconcile and dispatch using same execution ID.

### Crash D — executor started, crash before RUNNING persisted

Recovery: reconcile by execution ID. Adapter MUST distinguish already-started work or safely accept idempotent start replay.

### Crash E — executor completed, crash before result persisted

Recovery: reconcile by execution ID and persist the same terminal result/reference.

### Crash F — execution result persisted, graph transition not committed

Recovery: result remains durable; graph progression can be reevaluated and committed later using authoritative inputs.

## 16. Attempt identity

Attempt number is explicit and never inferred from retry loops hidden inside an executor.

Initial execution after normal activation uses attempt `1` unless the source operation explicitly establishes another attempt contract.

`retry_activated.nextAttempt` determines the retry intent attempt.

Different attempts MUST have different execution IDs.

A replay of the same attempt MUST reuse the same execution ID.

## 17. Failure semantics

Orchestration distinguishes:

- projection failure;
- claim/lease failure;
- executor-start rejection;
- executor infrastructure uncertainty;
- executor terminal task failure;
- result-validation failure.

These MUST NOT be collapsed into one free-form error string.

Executor task failure becomes candidate input for authoritative `FailureRecord` creation through a later application/orchestration contract. The executor itself does not write that record.

## 18. Graph definition dependency

Projection requires immutable graph-definition lookup by exact graph ID/version.

The projector MUST fail closed if:

- graph definition is missing;
- edge referenced by a transition decision is missing;
- destination node cannot be resolved;
- graph definition differs from the immutable version referenced by history.

Graph-definition storage/registry implementation is a separate port decision, but the requirement exists in v1.

## 19. Executor capability boundary

An execution intent declares requirements; it does not choose a concrete executor through free-form agent reasoning.

Executor selection MUST be performed by deterministic configuration/policy outside model prose.

OMP is expected to become the primary adapter after the generic `ExecutorPort` contract passes its own tests.

## 20. Ordering and authority

The required direction is:

```text
Graph authority
  -> committed journal
  -> durable execution intent
  -> durable claim
  -> executor dispatch
  -> durable result
  -> validated evidence/artifacts
  -> next graph decision
```

Forbidden direction:

```text
executor output -> direct graph-state mutation
```

## 21. Acceptance criteria

RFC-003 is implementable when contracts/tests can prove:

- a committed executable activation eventually projects to one stable intent;
- journal replay cannot create a duplicate attempt;
- non-executable nodes create no executor intent;
- projection checkpoint cannot skip entries;
- durable intent exists before dispatch;
- one unexpired lease prevents competing dispatch;
- expired lease is reclaimable;
- crash/restart after each crash-matrix boundary is recoverable;
- executor start replay uses the same execution ID;
- executor result does not directly advance graph state;
- missing/corrupt graph definition fails closed;
- execution attempt identity remains stable across replay;
- retry attempts use explicit attempt numbers;
- no OMP-specific type leaks into generic orchestration contracts.

No production orchestration/OMP adapter code may be written before the corresponding executable tests are observed RED.