# Durable Execution Orchestration Tests

Status: FAIL-FIRST SPECIFICATION
Phase: 5 — Durable Orchestration Contracts
Depends on:
- `RFC-003 — Durable Execution Orchestration`
- `docs/contracts/EXECUTION-ORCHESTRATION.md`
- `contracts/execution.ts`

These system-level cases MUST be partitioned into executable component suites before production orchestration code is introduced.

## A. Projection

### ORCH-001 — Executable transition projects one intent

Given a committed `transition_committed` journal entry
And the referenced immutable edge resolves to a destination node with `executionMode=dispatch`
When projection runs
Then exactly one intent is derived
And its run/graph/version/node/source journal/source operation identities match authority
And attempt is `1`.

### ORCH-002 — Control transition projects no intent

Given the destination node has `executionMode=control`
When projection runs
Then zero intents are derived.

### ORCH-003 — Projection is deterministic

Given identical journal entry, graph definition, and explicit creation timestamp
When projection is evaluated repeatedly
Then the derived intents are equivalent, including `executionId`.

### ORCH-004 — Same attempt reuses execution ID

Given the same authoritative activation is replayed
When projection derives the same attempt
Then the same `executionId` is produced.

### ORCH-005 — Different attempt uses different execution ID

Given the same run/node is activated by retry with another explicit attempt number
When projection runs
Then its execution ID differs from prior attempts.

### ORCH-006 — Transition bindings propagate

Given the transition decision binds artifact, evidence, and approval IDs
When a dispatch intent is projected
Then those exact bindings are copied to the immutable intent.

### ORCH-007 — Executor policy propagates

Given destination execution node declares `executorPolicyId`
When an intent is projected
Then that policy ID is preserved in the intent.

### ORCH-008 — Retry activation uses explicit attempt

Given `retry_activated.nextAttempt=N`
And the activation node is dispatchable
When projection runs
Then intent attempt is exactly `N`.

### ORCH-009 — Retry control node produces no intent

Given retry activation points to `executionMode=control`
When projection runs
Then no external intent is produced.

### ORCH-010 — Recovery dispatch projection is deterministic

Given `recovery_activated` targets a dispatch node
When projection runs repeatedly over identical authoritative input
Then one equivalent recovery intent is derived each time.

### ORCH-011 — Run creation produces no intent

Given a `run_created` journal entry
When projection runs
Then no intent is derived.

### ORCH-012 — Failure record produces no intent

Given a `failure_recorded` journal entry
When projection runs
Then no intent is derived.

### ORCH-013 — Missing edge fails closed

Given a transition decision references an edge absent from the exact graph version
When projection runs
Then projection fails with `PROJECTION_INTEGRITY_FAILURE` or a more specific graph-definition error
And no intent is produced.

### ORCH-014 — Missing activation node fails closed

Given retry/recovery operation references a node absent from the exact graph version
When projection runs
Then no intent is produced and projection fails closed.

### ORCH-015 — Graph identity/version mismatch fails closed

Given journal graph identity does not exactly match supplied graph definition
When projection runs
Then projection fails closed.

## B. Projection checkpoint / durable outbox

### ORCH-016 — First sequence projects atomically with checkpoint

Given no checkpoint exists for a run/projector
And journal sequence `0` is projected
When execution store commits projection
Then any derived intents and checkpoint `0` become durable atomically.

### ORCH-017 — Next sequence must be contiguous

Given checkpoint is `N`
When projector attempts to commit sequence other than `N+1`
Then result is `CHECKPOINT_CONFLICT`
And no intent/checkpoint mutation occurs.

### ORCH-018 — Replay is idempotent

Given sequence `N` was already projected
When the identical source/effects are replayed
Then result is `REPLAYED`
And no duplicate intent is created.

### ORCH-019 — Conflicting replay is rejected

Given an execution ID already exists from authoritative source `S`
When replay tries to bind the same execution ID to different immutable intent content
Then result is `INTEGRITY_ERROR/EXECUTION_INTENT_CONFLICT`.

### ORCH-020 — Checkpoint cannot advance without intents

Given a dispatchable source entry
And storage fails before intent insert completes
When the atomic projection transaction aborts
Then checkpoint remains unchanged.

### ORCH-021 — Intent cannot become visible without checkpoint commit

Given projection transaction fails after attempting intent creation but before commit
When state is reloaded
Then neither the intent nor the new checkpoint is visible.

### ORCH-022 — Crash after graph commit is recoverable by replay

Given authoritative journal contains an unprojected executable activation
And projector process restarts
When it resumes from checkpoint
Then the missing intent is derived and persisted exactly once.

## C. Pending and claim semantics

### ORCH-023 — New durable intent is pending

Given successful projection of a dispatch intent
When execution is loaded
Then status is `PENDING`.

### ORCH-024 — Pending intent can be claimed

Given a pending execution and valid future lease
When a worker claims it
Then status becomes `CLAIMED`
And the exact lease becomes durable.

### ORCH-025 — Invalid lease time is rejected

Given `expiresAt <= claimedAt`
When claim is attempted
Then claim is rejected without mutation.

### ORCH-026 — Unexpired claim cannot be stolen

Given execution has an unexpired lease owned by worker A
When worker B claims it
Then result is `CLAIM_CONFLICT`
And A's lease remains authoritative.

### ORCH-027 — Expired claim can be reclaimed

Given prior lease is expired at explicit current time
When a new worker claims the execution
Then new claim succeeds with a new lease.

### ORCH-028 — Stale lease cannot mark running

Given current lease is L2
When caller presents old lease L1
Then `markRunning` returns `STALE_LEASE`
And state does not change.

### ORCH-029 — Expired lease cannot mark running

Given current lease expired before explicit current time
When `markRunning` is attempted
Then result is `LEASE_EXPIRED`.

### ORCH-030 — Mark running binds executor reference

Given current valid claim
When conforming executor start returns an executor reference and orchestration marks running
Then status becomes `RUNNING`
And executor reference is durable.

## D. Dispatch ordering and executor protocol

### ORCH-031 — No dispatch without durable intent

Given no durable intent exists
Then dispatcher MUST NOT invoke `ExecutorPort.start` for that execution ID.

### ORCH-032 — No dispatch without durable claim

Given intent exists but claim did not commit
Then executor start MUST NOT be called.

### ORCH-033 — Start uses stable execution ID

Given a claimed execution
When dispatcher invokes executor
Then request execution ID exactly equals durable intent execution ID.

### ORCH-034 — STARTED maps to running

Given executor returns `STARTED`
When dispatcher processes response under valid lease
Then execution becomes `RUNNING` with returned executor reference.

### ORCH-035 — ALREADY_STARTED is reconciled, not duplicated

Given executor returns `ALREADY_STARTED`
When dispatcher handles replay
Then it persists/reconciles the same execution identity
And does not create a new execution attempt.

### ORCH-036 — ALREADY_COMPLETED persists terminal result

Given executor returns `ALREADY_COMPLETED` with a terminal result
When dispatcher processes it under valid lease
Then the same execution becomes terminal without a new start/attempt.

### ORCH-037 — Unknown start outcome reuses same execution ID

Given executor start throws/returns no trustworthy semantic outcome
When orchestration retries/reconciles
Then it calls `getStatus` using the same execution ID before creating any new attempt.

### ORCH-038 — NOT_FOUND after uncertain start may retry same identity

Given uncertain prior start
And reconciliation reports `NOT_FOUND`
When retrying dispatch
Then the same execution ID and attempt are used.

### ORCH-039 — RUNNING reconciliation restores local running state

Given execution is locally claimed
And executor reconciliation reports `RUNNING`
When reconciled
Then local orchestration may become `RUNNING` using the same execution ID/reference.

### ORCH-040 — Terminal reconciliation restores result

Given local state missed terminal persistence
And executor reports `SUCCEEDED` or `FAILED`
When reconciled
Then terminal result is persisted for the same execution ID.

## E. Result integrity

### ORCH-041 — Successful result becomes immutable terminal state

Given running execution with valid lease
When a matching `SUCCEEDED` result is recorded
Then status becomes `SUCCEEDED`
And terminal result is durable.

### ORCH-042 — Failed result becomes immutable terminal state

Given running execution with valid lease
When a matching `FAILED` result is recorded
Then status becomes `FAILED`.

### ORCH-043 — Result execution ID must match

Given record request execution ID differs from result execution ID
When result is recorded
Then result is rejected as integrity failure.

### ORCH-044 — Identical terminal replay is idempotent

Given terminal result already persisted
When the same result is replayed
Then result is `REPLAYED` and terminal state is unchanged.

### ORCH-045 — Conflicting terminal replay is rejected

Given a terminal result is persisted
When a different terminal result is presented for the same execution ID
Then result is `RESULT_CONFLICT`.

### ORCH-046 — Stale lease cannot record first terminal result

Given active lease differs from caller's lease
When result is recorded
Then result is rejected with `STALE_LEASE`.

### ORCH-047 — Execution result does not mutate graph authority

Given execution becomes `SUCCEEDED` or `FAILED`
When no graph application transition is committed
Then authoritative graph state/journal remain unchanged.

## F. Restart/recovery matrix

### ORCH-048 — Restart after projection resumes pending intent

Given intent/checkpoint committed and process crashes before claim
When orchestration restarts
Then pending scan exposes the same execution once.

### ORCH-049 — Restart after claim waits/reclaims lease

Given claim committed and process crashes before start
When another worker observes unexpired lease
Then it cannot dispatch
And after expiry it may reclaim the same execution ID.

### ORCH-050 — Restart after executor start reconciles identity

Given executor actually started but local RUNNING write was lost
When orchestration restarts
Then reconciliation uses the same execution ID and does not invent another attempt.

### ORCH-051 — Restart after executor completion recovers result

Given executor completed but local result write was lost
When orchestration reconciles
Then it persists the terminal result for the same execution ID.

### ORCH-052 — Restart after result before graph transition is safe

Given terminal execution result is durable
And process dies before graph progression
When application resumes
Then terminal result remains available for artifact/evidence validation and later graph transition evaluation.

## G. Graph registry / authority separation

### ORCH-053 — Exact graph version required

Given projector requests G@V
When registry lacks exact V but has another version
Then result is `NOT_FOUND`; another version MUST NOT be substituted.

### ORCH-054 — Invalid graph fails closed

Given registry returns a graph that does not satisfy graph validation / execution metadata contract
When projection attempts to use it
Then projection is rejected.

### ORCH-055 — Executor cannot mutate graph through generic port

Given caller compiles against `ExecutorPort`
Then no graph-state commit, approval, gate, or journal mutation method exists on that port.

### ORCH-056 — OMP types absent from generic contracts

Given `contracts/execution.ts`
Then it MUST compile without importing OMP packages or OMP SDK/RPC types.

## Component ownership before implementation

The executable RED phase MUST split cases as follows:

### Pure projector

ORCH-001..015, ORCH-053..054, ORCH-056.

### ExecutionStore adapter

ORCH-016..030, ORCH-041..046, ORCH-048..049.

### Dispatcher + fake ExecutorPort

ORCH-031..040, ORCH-050..052, ORCH-055.

### OMP adapter

No OMP implementation is authorized by these generic tests alone. OMP-specific contract/eval cases require a separate RED suite after the generic `ExecutorPort` behavior is accepted.

## Phase 5 completion criterion

Phase 5 is complete when:

1. RFC-003 has no unresolved authority/delivery ambiguity;
2. generic TypeScript ports are strict and OMP-independent;
3. ORCH-001..056 map to explicit component ownership;
4. no production orchestration code has been introduced;
5. the existing domain/persistence suites still compile and pass.