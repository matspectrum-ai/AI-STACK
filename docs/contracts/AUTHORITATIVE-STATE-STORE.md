# Authoritative State Store Contracts v1

Status: DRAFT CONTRACT
Depends on: `docs/architecture/RFC/RFC-002-AUTHORITATIVE-STATE-PERSISTENCE.md`

## 1. Purpose

Define the storage-independent contract for durable Engineering Graph run state.

The store is authoritative for atomic durability, revision concurrency, idempotency binding, journal append semantics, and persisted snapshot consistency. It is not responsible for agent execution or policy reasoning.

## 2. Core invariants

A conforming implementation MUST satisfy all of the following:

1. one run is bound to one graph ID and graph version;
2. run creation produces revision `0`;
3. each successful state-changing commit increments revision exactly once;
4. journal sequence is strictly monotonic per run;
5. compare-and-swap revision check and writes are atomic;
6. decision/operation journal record and resulting snapshot are atomic;
7. rejected/conflicting commits create no authoritative state mutation;
8. operation-ID idempotency is atomic with commit;
9. same operation ID + same digest replays the original result without mutation;
10. same operation ID + different digest is rejected;
11. load exposes committed state only;
12. malformed/inconsistent durable state fails closed;
13. journal records are immutable through the public port;
14. retry activation cannot become authoritative without its persisted counter increment;
15. recovery/retry cannot become authoritative without the governing failure being durable before or in the same atomic operation;
16. state-store methods MUST NOT execute external work as a side effect.

## 3. Operation identity

`OperationId` is an opaque caller-generated identifier.

The store MUST NOT derive authorization, ordering, or semantics by parsing the ID.

Every create/commit request binds:

```text
operation_id -> operation_digest
```

The digest is a canonical payload digest computed outside this store contract. RFC-002 does not yet choose the canonicalization/hash implementation.

## 4. Run creation

`createRun` creates the initial authoritative run.

Input requirements:

- operation ID;
- operation digest;
- initial `GraphRunState`;
- initial state revision exactly `0`;
- graph ID/version present and internally consistent.

Successful creation MUST atomically create:

- run metadata;
- current snapshot at revision `0`;
- first journal record at sequence `0` describing run creation;
- idempotency binding for the operation ID.

Possible outcomes:

- `CREATED`
- `REPLAYED`
- `RUN_ALREADY_EXISTS`
- `IDEMPOTENCY_VIOLATION`
- `INTEGRITY_ERROR`

`REPLAYED` is valid only for an identical previously committed create operation.

## 5. Load run

`loadRun` returns one of:

- `FOUND`
- `NOT_FOUND`
- `INTEGRITY_ERROR`

For `FOUND`, the result MUST include:

- validated current snapshot;
- current state revision;
- current journal head sequence;
- graph ID/version.

The store MUST NOT return a best-effort state when integrity validation fails.

## 6. Commit request

A commit request includes:

- operation ID;
- operation digest;
- run ID;
- expected revision;
- typed authoritative operation;
- complete next `GraphRunState` snapshot.

The next snapshot MUST declare revision `expected_revision + 1`.

The next snapshot MUST preserve run ID, graph ID, and graph version.

## 7. Commit outcomes

### COMMITTED

The operation was committed exactly once.

Result includes:

- operation ID;
- committed revision;
- journal sequence.

### REPLAYED

The operation ID already committed with the same digest.

The store returns the original committed revision/sequence and performs no mutation.

### CONFLICT

The request's expected revision does not match current revision.

Result includes current revision. No mutation occurs.

### IDEMPOTENCY_VIOLATION

The operation ID is already bound to a different digest. No mutation occurs.

### RUN_NOT_FOUND

No authoritative run exists. No mutation occurs.

### INTEGRITY_ERROR

Authoritative persisted state cannot safely satisfy the operation. No new mutation occurs.

## 8. Authoritative operation kinds

Initial v1 operation kinds:

- `transition_committed`
- `failure_recorded`
- `retry_activated`
- `recovery_activated`

### transition_committed

Carries a persisted `TransitionDecision`.

Required structural invariants:

- decision run/graph/version match the target run;
- `stateRevisionBefore == expected_revision`;
- `stateRevisionAfter == expected_revision + 1`;
- next snapshot revision equals `stateRevisionAfter`;
- transition ID is reflected by `nextState.lastTransitionId`.

### failure_recorded

Carries one `FailureRecord`.

Required structural invariant:

- failure ID appears in `nextState.failureRefs`.

### retry_activated

Carries:

- governing failure ID;
- retry-policy ID;
- retry counter key;
- next attempt number;
- activation node ID.

Required structural invariants:

- governing failure is already referenced in current state or is included by a future explicitly atomic composite contract;
- `nextState.retryCounters[counter_key] == next_attempt`;
- `next_attempt` is greater than the previous persisted counter;
- activation node is represented by the next authoritative state.

v1 chooses the simpler ordering: the governing failure MUST already be durable before `retry_activated`.

### recovery_activated

Carries:

- governing failure ID;
- recovery edge ID;
- recovery node ID.

Required structural invariant:

- governing failure MUST already be durable in current state before recovery activation.

## 9. Journal contract

Every successful create/commit appends one immutable journal entry.

Required entry fields:

- journal sequence;
- operation ID;
- operation digest;
- run ID;
- resulting state revision;
- graph ID/version;
- operation kind/payload;
- committed-at timestamp.

Rules:

- sequence starts at `0` for creation;
- successful state commits append `previous_sequence + 1`;
- journal sequence MUST NOT regress or duplicate;
- public API exposes reads only, never update/delete;
- `REPLAYED`, `CONFLICT`, and rejected requests MUST NOT append a new record.

## 10. Journal read

`readJournal(run_id, after_sequence?)` returns committed entries in ascending sequence order.

The result MUST NOT contain holes within the returned authoritative range.

Pagination MAY be introduced later without changing ordering semantics.

## 11. Concurrency contract

For two distinct operations racing with the same run and expected revision:

- at most one may return `COMMITTED`;
- every loser MUST return `CONFLICT` unless it is an idempotent replay of the winner;
- final revision increments only once for one accepted state change.

The guarantee MUST hold across concurrent calls to the same adapter instance and across any concurrency scope the backend claims to support.

## 12. Idempotency contract

Idempotency resolution has precedence over stale revision for an already committed identical operation.

Reason: a caller may retry after commit without knowing whether the prior attempt succeeded. The replay MUST return the original result even though the run revision has since advanced.

For a new operation ID, normal expected-revision comparison applies.

## 13. Snapshot integrity

On successful commit:

```text
journal.resulting_revision == snapshot.revision
journal.graph_id == snapshot.graph_id
journal.graph_version == snapshot.graph_version
```

A backend MAY persist additional checksums/metadata.

If the backend detects inconsistency, `loadRun` and future commits MUST fail closed with `INTEGRITY_ERROR` until explicit repair/migration outside the normal port.

## 14. Transaction boundary

A conforming adapter MUST implement one atomic boundary around:

```text
lookup idempotency binding
check current run/revision/integrity
validate structural operation invariants
append journal record
write next snapshot
write idempotency binding
commit
```

No worker/executor activation is part of this transaction; orchestration may dispatch work only after `COMMITTED` is returned.

## 15. Clock boundary

Commit timestamps are produced by the store adapter's explicit clock dependency or backend transaction clock.

Tests MUST be able to control or assert ordering without relying on wall-clock timing races.

## 16. Error model

Expected persistence/domain outcomes MUST be represented as typed result variants, not arbitrary exceptions.

Infrastructure failures that prevent obtaining a trustworthy result MAY throw/reject at the adapter boundary, but callers MUST treat unknown commit outcome as non-authoritative and retry only using the same operation ID/digest.

This is why idempotency is mandatory.

## 17. Backend conformance

A backend is not accepted merely because unit tests for application logic pass.

Each backend MUST pass the same persistence conformance suite against its real transaction primitive, including concurrent commit tests.

## 18. Implementation block

No production persistence adapter may be implemented until:

1. TypeScript port contracts exist;
2. conformance tests are executable;
3. tests are observed RED against the missing adapter;
4. backend selection is recorded by ADR with its concurrency/durability scope.