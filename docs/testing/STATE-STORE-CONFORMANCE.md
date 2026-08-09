# Authoritative State Store Conformance Tests

Status: FAIL-FIRST SPECIFICATION
Phase: 3 — Persistence Contracts
Depends on:
- `RFC-002 — Authoritative State Persistence`
- `Authoritative State Store Contracts v1`
- `contracts/persistence.ts`
- `ADR-003 — SQLite as Initial Authoritative State Store Adapter`

These cases define the executable conformance suite required before a persistence adapter may be accepted.

## Run creation and load

### STORE-001 — Create run starts at revision zero

Given a valid run whose state revision is `0`
When `createRun` commits
Then result is `CREATED`
And receipt revision is `0`
And journal sequence is `0`
And `loadRun` returns an equivalent committed state.

### STORE-002 — Invalid initial revision is rejected

Given a create request whose initial state revision is not `0`
When `createRun` executes
Then no run is created
And result is `INTEGRITY_ERROR` with `INVALID_COMMIT_STRUCTURE`.

### STORE-003 — Unknown run loads as NOT_FOUND

Given no run exists
When `loadRun` is called
Then result is `NOT_FOUND`.

### STORE-004 — Duplicate run creation is rejected

Given run `R` already exists
And a different operation ID attempts to create `R` again
When `createRun` executes
Then result is `RUN_ALREADY_EXISTS`
And existing state/journal remain unchanged.

### STORE-005 — Reopen resumes deterministic committed state

Given a file-backed adapter has committed run state
When the adapter is closed and a new adapter instance opens the same store
Then `loadRun` returns authoritative state equivalent to the state before close
And journal head/revision are unchanged.

## Idempotency

### STORE-006 — Create replay is idempotent

Given a create operation committed with `(operation_id=A, digest=D)`
When the exact request is repeated
Then result is `REPLAYED`
And original receipt is returned
And no new journal entry is appended.

### STORE-007 — Create operation ID cannot change payload

Given operation ID `A` is committed with digest `D1`
When `A` is reused with `D2 != D1`
Then result is `IDEMPOTENCY_VIOLATION`
And no authoritative state changes.

### STORE-008 — Commit replay survives revision advancement

Given operation `A/D` committed at revision `N+1`
And the run later advances beyond `N+1`
When `A/D` is replayed
Then result is `REPLAYED`
And the original receipt is returned despite the stale expected revision
And no new state change occurs.

### STORE-009 — Commit operation ID cannot change payload

Given commit operation ID `A` is bound to digest `D1`
When `A` is reused with `D2`
Then result is `IDEMPOTENCY_VIOLATION`
And current revision does not change.

## Optimistic concurrency

### STORE-010 — Successful commit increments revision once

Given current revision `N`
And a valid new operation expects `N`
And next state declares `N+1`
When commit succeeds
Then result is `COMMITTED`
And persisted revision is `N+1`
And journal sequence advances once.

### STORE-011 — Stale revision conflicts without mutation

Given current revision is `N+1`
When a new operation expects `N`
Then result is `CONFLICT`
And result exposes current revision `N+1`
And snapshot/journal/idempotency state do not mutate.

### STORE-012 — Concurrent same-revision writers have one winner

Given two distinct valid operation IDs both expect revision `N`
When separate store connections attempt the commits concurrently
Then exactly one result is `COMMITTED`
And the other is `CONFLICT`
And final revision is `N+1`, not `N+2`.

### STORE-013 — Revision must advance exactly one

Given current revision `N`
And next state declares a revision other than `N+1`
When commit is attempted
Then result is `INTEGRITY_ERROR/INVALID_COMMIT_STRUCTURE`
And no mutation occurs.

## Atomic journal and snapshot

### STORE-014 — Commit writes journal and snapshot atomically

Given a valid state-changing operation
When result is `COMMITTED`
Then the new snapshot revision equals the new journal entry resulting revision
And graph/run binding is identical in both.

### STORE-015 — Rejected structural commit leaves no partial record

Given a request violates an operation structural invariant
When commit is rejected
Then journal length/head are unchanged
And snapshot revision/state are unchanged
And operation ID is not recorded as successfully committed.

### STORE-016 — Journal sequence is monotonic and gap-free

Given a run with multiple committed operations
When journal is read
Then sequences are `0..head` in ascending order without duplicates or gaps.

### STORE-017 — Journal read after sequence is exclusive

Given journal sequences `0..K`
When `readJournal(afterSequence=N)` is called
Then only entries with sequence `> N` are returned in ascending order.

### STORE-018 — Rejected operations do not append journal entries

For outcomes `CONFLICT`, `IDEMPOTENCY_VIOLATION`, `RUN_NOT_FOUND`, and `INTEGRITY_ERROR`
When the outcome occurs
Then no new journal entry is appended.

## Graph binding

### STORE-019 — Run graph binding cannot change

Given a run is bound to graph `G@V`
When next state or operation attempts a different graph ID or version
Then result is `INTEGRITY_ERROR/GRAPH_BINDING_MISMATCH`
And no mutation occurs.

### STORE-020 — Commit run ID cannot change

Given commit targets run `R`
When next state identifies a different run
Then result is `INTEGRITY_ERROR/INVALID_COMMIT_STRUCTURE`
And no mutation occurs.

## Transition commit structure

### STORE-021 — Transition revision fields are bound to commit

Given a `transition_committed` operation at expected revision `N`
When decision does not declare `stateRevisionBefore=N` and `stateRevisionAfter=N+1`
Then commit is rejected with `INVALID_COMMIT_STRUCTURE`.

### STORE-022 — Transition ID becomes snapshot last transition

Given a valid transition commit
When commit succeeds
Then `nextState.lastTransitionId` equals the committed decision transition ID.

## Failure, retry, recovery ordering

### STORE-023 — Failure record must enter authoritative state

Given a `failure_recorded` operation
When next state does not reference the failure ID
Then commit is rejected.

### STORE-024 — Failure record commit is durable

Given a valid failure-record operation
When committed
Then load returns the failure ID in state
And journal contains the failure operation before any later retry/recovery operation.

### STORE-025 — Retry requires durable governing failure

Given failure `F` is not referenced by current authoritative state
When `retry_activated(F)` is attempted
Then commit is rejected with `INVALID_COMMIT_STRUCTURE`.

### STORE-026 — Retry count is durable in same activation commit

Given governing failure is durable
And current retry count is `A-1`
When `retry_activated(nextAttempt=A)` commits
Then snapshot retry counter is `A`
And retry activation is visible only at the same committed revision.

### STORE-027 — Retry counter cannot regress or skip declared attempt

Given persisted retry count `A`
When retry activation declares an invalid next attempt/counter state
Then commit is rejected without mutation.

### STORE-028 — Recovery requires durable governing failure

Given failure `F` is absent from current state
When `recovery_activated(F)` is attempted
Then commit is rejected without mutation.

## Integrity / fail closed

### STORE-029 — Snapshot/journal revision mismatch fails closed

Given durable storage is externally corrupted so snapshot revision and journal head revision disagree
When `loadRun` executes
Then result is `INTEGRITY_ERROR/SNAPSHOT_JOURNAL_REVISION_MISMATCH`
And no best-effort state is returned.

### STORE-030 — Graph binding corruption fails closed

Given durable metadata disagrees on graph ID/version
When load or commit validates state
Then result is `INTEGRITY_ERROR/GRAPH_BINDING_MISMATCH`.

### STORE-031 — Duplicate/gapped journal sequence fails closed

Given durable journal integrity is externally corrupted
When authoritative history is validated
Then the store reports the applicable journal integrity error
And does not silently normalize history.

### STORE-032 — Idempotency binding corruption fails closed

Given operation-id binding conflicts with its committed journal receipt/digest
When the binding is read during replay/commit
Then result is `INTEGRITY_ERROR/IDEMPOTENCY_BINDING_MISMATCH`.

Corruption tests MAY use adapter-specific test-only inspection utilities outside the production port. Production interfaces MUST NOT expose mutation APIs for journal corruption.

## Side effects and isolation

### STORE-033 — Persistence performs no executor side effects

Given any store method is called
Then no OMP execution, shell command, network dispatch, or tool invocation occurs as an implicit effect of persistence.

### STORE-034 — SQL/backend types do not cross the port

Given callers compile against `AuthoritativeStateStore`
Then no SQLite connection/statement/result type is required by upstream application/domain code.

## Acceptance gate for the first adapter

The SQLite adapter may be accepted only when:

- STORE-001..034 executable tests are present;
- all applicable cases are observed RED before implementation;
- the file-backed SQLite adapter passes them GREEN;
- concurrent-writer tests use at least two real database connections/adapter instances;
- reopen tests close and reopen a file-backed database;
- corruption cases verify fail-closed behavior using test-only backend inspection;
- post-GREEN refactor retains the same passing suite.