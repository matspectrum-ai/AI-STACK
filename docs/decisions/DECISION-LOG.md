# Decision Log

This file records accepted architectural decisions and unresolved decision points. Chat messages and agent output are not authoritative by themselves.

## Accepted direction

### D-001 — OMP as execution kernel

Status: PROVISIONALLY ACCEPTED

AI-STACK targets OMP / OhMyPI as the primary agent execution runtime. Phase 1 research defines the intended boundary as an AI-STACK-owned `ExecutorPort`, with OMP SDK as the preferred first adapter and RPC retained as the isolation/cross-language alternative. The adapter itself is not implemented or accepted yet.

### D-002 — Graph Engineering as architecture principle

Status: PROVISIONALLY ACCEPTED

The engineering lifecycle is represented as an explicit graph with typed nodes, transitions, gates, policies, artifacts, evidence, approvals, and failure paths.

### D-003 — Single control plane

Status: PROVISIONALLY ACCEPTED

AI-STACK owns authoritative workflow state. External frameworks may contribute primitives but must not introduce competing orchestration authority.

### D-004 — Evidence-backed TDD gates

Status: PROVISIONALLY ACCEPTED

Implementation requires valid specification, contract, and RED evidence. Prose instructions are not sufficient enforcement. AI-STACK applies this discipline to itself through observed RED → GREEN → REFACTOR cycles.

### D-005 — GSD as reference only

Status: PROVISIONALLY ACCEPTED

GSD concepts may inform context isolation and atomic execution, but the archived framework will not be a runtime dependency.

### D-006 — Authoritative graph state persistence model

Status: ACCEPTED
RFC: `docs/architecture/RFC/RFC-002-AUTHORITATIVE-STATE-PERSISTENCE.md`
Contract: `docs/contracts/AUTHORITATIVE-STATE-STORE.md`

The accepted model uses an append-only per-run journal plus a current snapshot, optimistic concurrency via expected state revision, atomic journal+snapshot commits, and operation-ID/digest idempotency. The journal is audit authority; the snapshot is the current resume checkpoint.

Phase 4 proved CAS conflict behavior, idempotent replay, conflicting replay rejection, atomic snapshot/journal state, deterministic close/reopen resume, failure/retry/recovery ordering, two-connection same-revision races, and fail-closed integrity behavior against a real file-backed backend.

### D-009 — Initial runtime/test substrate

Status: ACCEPTED
ADR: `docs/architecture/ADR/ADR-001-INITIAL-RUNTIME-SUBSTRATE.md`

TypeScript on Bun is the accepted v1 executable contract-test and initial runtime substrate. The pure Engineering Graph domain remains OMP-independent. Phase 2 established executable tests first, observed RED, implemented the minimum domain kernel, achieved GREEN under strict typecheck, refactored for cohesion, and re-verified GREEN.

### D-013 — Initial persistence backend

Status: ACCEPTED
ADR: `docs/architecture/ADR/ADR-003-SQLITE-STATE-STORE.md`

SQLite through Bun's built-in `bun:sqlite` driver is the accepted first local durable `AuthoritativeStateStore` adapter. The accepted authority scope is processes/connections coordinating through the same supported local SQLite file. The storage port remains backend-independent so a future PostgreSQL adapter can be introduced without changing graph contracts.

Phase 4 accepted D-013 only after a real file-backed implementation passed the shared persistence conformance suite, including two independently opened store instances racing on the same expected revision and close/reopen durability.

### D-017 — Initial durable ExecutionStore backend and recovery boundary

Status: ACCEPTED
ADR: `docs/architecture/ADR/ADR-004-SQLITE-EXECUTION-STORE.md`
Contract: `docs/contracts/SQLITE-EXECUTION-STORE.md`

SQLite through Bun's built-in `bun:sqlite` driver is the accepted first durable derived-orchestration `ExecutionStore` adapter. It uses an orchestration-owned schema, with Phase 7 conformance using a separate file from authoritative graph state so journal-as-outbox recovery does not depend on cross-store transactions.

The accepted generic recovery refinement is `DurableExecutionStore.listRecoverable(now, limit)`, allowing expired `CLAIMED`/`RUNNING` work to be discovered and reclaimed using the same stable `ExecutionId` instead of creating a new attempt.

Phase 7 accepted D-017 only after executable tests proved atomic projection/checkpoint persistence, idempotent projection replay, immutable intent content, live-lease exclusion, expired-lease reclaim, stale/expired lease rejection, real two-connection claim contention, terminal result immutability, close/reopen durability, and expired-work discovery. Post-refactor run `31298289515` remained fully green.

### D-018 — Immutable exact-version GraphDefinitionRegistry

Status: ACCEPTED
ADR: `docs/architecture/ADR/ADR-005-SQLITE-GRAPH-REGISTRY.md`
Contract: `docs/contracts/GRAPH-DEFINITION-REGISTRY.md`

AI-STACK accepts a durable immutable registry keyed exactly by `(graphId, graphVersion)`. Lookup has no latest-version or fallback semantics. Once an identity is registered, canonically equivalent re-registration is an idempotent replay and different semantics under the same identity are rejected.

SQLite through Bun's built-in `bun:sqlite` is the accepted first local adapter. The registry preserves the first registered representation while persisting a separate canonical representation for equality/conflict detection; this is not D-014's generic cryptographic operation-digest contract.

Phase 9 proved exact lookup (ORCH-053), invalid graph rejection (ORCH-054), canonical reorder replay, immutable conflict behavior, independent version coexistence, close/reopen durability, two-connection equivalent/conflicting registration races, corrupted-definition fail-closed behavior, and a public port with no graph-run or executor mutation authority.

TDD evidence:

- clean RED: run `31298836779` — accepted suites stayed green while registry/typecheck failed only because the contracted SQLite registry module did not exist;
- GREEN: run `31298908373` — all suites, strict typecheck, and enforcement passed;
- post-refactor GREEN: run `31298941526` — complete suite passed after SQLite row lookup/integrity decoding was isolated from registration flow.

### D-020 — Generic durable dispatcher and reconciliation state machine

Status: ACCEPTED
Contract: `docs/contracts/EXECUTION-DISPATCHER.md`
Test map: `docs/testing/DISPATCHER-CONFORMANCE.md`

AI-STACK accepts a generic dispatcher between `DurableExecutionStore` and one already-selected `ExecutorPort`. The dispatcher requires a durable claim before external start, preserves the immutable `ExecutionIntent` identity/bindings, and treats uncertain external start outcomes as a reconciliation problem using the same `ExecutionId` rather than creating another attempt.

Accepted semantics include:

- no executor call without a durable intent and usable claim;
- `STARTED` and `ALREADY_STARTED` persist the same execution as RUNNING;
- `ALREADY_COMPLETED` persists the supplied terminal result;
- uncertain start performs `getStatus(same executionId)`;
- `NOT_FOUND` permits a later retry with the same execution ID/attempt;
- `UNKNOWN` forbids blind immediate restart;
- expired worker claims are reclaimed under the same execution ID before reconciliation;
- durable terminal state is not redispatched;
- generic `ExecutorPort` exposes no graph-authority mutation methods.

Phase 8 TDD evidence:

- clean RED: run `31298484904` — accepted domain/persistence/projector/ExecutionStore behavior remained green while dispatcher tests/typecheck failed only because `create-execution-dispatcher.ts` did not exist;
- behavioral GREEN diagnostic: run `31298524823` — all 62 orchestration tests passed while one implementation-only TypeScript narrowing error remained;
- GREEN: run `31298574716` — all suites, strict typecheck, and enforcement passed;
- post-refactor GREEN: run `31298611752` — complete suite passed after immutable intent-to-start-request mapping was extracted.

D-020 does not accept executor selection/routing, a worker scheduler loop, OMP behavior, graph application transitions, or evidence/artifact production from executor outputs.

## Decisions under acceptance test

### D-010 — OMP integration boundary

Status: PROPOSED
Research: `docs/research/OMP-INTEGRATION.md`

The proposed boundary is `Engineering Graph -> ExecutorPort -> OmpSdkExecutorAdapter -> OMP SDK`, with RPC as a replaceable adapter boundary when process isolation or cross-language operation is required.

The generic `ExecutorPort` and dispatcher behavior are now proven. D-010 MUST NOT move to ACCEPTED until OMP-specific start/idempotency/status/result semantics are separately specified, observed RED, and implemented without leaking OMP authority into graph state.

### D-015 — Journal-as-outbox durable orchestration

Status: PROPOSED
RFC: `docs/architecture/RFC/RFC-003-DURABLE-EXECUTION-ORCHESTRATION.md`
Contract: `docs/contracts/EXECUTION-ORCHESTRATION.md`

The proposed orchestration boundary treats the accepted authoritative graph journal as a durable outbox. A deterministic projector derives durable `ExecutionIntent` records from committed journal entries plus the exact immutable graph definition. Executor dispatch is forbidden until intent and claim state are durable.

Phase 6 proved the pure deterministic projector. Phase 7 proved the durable projection/checkpoint and claim/lease store boundary. Phase 8 proved the generic dispatcher/reconciliation state machine. Phase 9 proved the durable exact-version graph registry.

D-015 remains PROPOSED because the production journal-to-intent control path is still incomplete. The remaining acceptance gaps are:

- production projection runner/pump wiring `AuthoritativeStateStore journal -> exact GraphDefinitionRegistry -> ExecutionProjector -> ExecutionStore` with deterministic checkpoint/restart behavior;
- explicit executable closure for execution-result/graph-authority separation at the application boundary (ORCH-047);
- explicit executable generic-contract check that no OMP types leak into generic orchestration contracts (ORCH-056).

D-015 MUST NOT move to ACCEPTED until those gaps have executable RED/GREEN evidence and the journal-to-durable-intent recovery path is demonstrated end-to-end without an executor dependency.

### D-016 — At-least-once dispatch with stable execution identity

Status: PROPOSED
RFC: `docs/architecture/RFC/RFC-003-DURABLE-EXECUTION-ORCHESTRATION.md`

AI-STACK proposes at-least-once orchestration at the executor-dispatch boundary rather than claiming impossible generic exactly-once external execution. Every execution attempt has a stable `ExecutionId`; uncertain/replayed dispatch reuses that identity.

Phase 6 proved stable intent/execution identity, Phase 7 proved same-ID durable reclaim, and Phase 8 proved generic same-ID start/reconciliation behavior with a programmable fake executor.

D-016 remains PROPOSED until the OMP adapter proves the required idempotent-start and/or status-reconciliation semantics against real OMP behavior.

## Open decisions

- D-007: Evidence storage format
- D-008: Artifact identity and lineage concrete representation
- D-011: Policy evaluation and permissions implementation mechanism
- D-012: Graph DSL shape and relationship to Spec Kit semantics
- D-014: Canonical operation serialization and digest generation
- D-019: Dispatcher worker scheduler lifecycle and executor-selection/routing mechanism

## Phase evidence

### Phase 1 — Domain contracts

Defined normative contracts for graph, node, edge, run state, transitions, gates, policies, artifacts, evidence, executors, approvals, failures, and retries.

### Phase 2 — Pure GraphKernel

Established strict TypeScript contracts and deterministic domain behavior via RED → GREEN → REFACTOR.

### Phase 3 — Persistence contracts

Specified `AuthoritativeStateStore`, optimistic concurrency, atomic journal/snapshot state, idempotency, resume behavior, and STORE-001..034 before implementation.

### Phase 4 — Authoritative SQLite persistence

Implemented file-backed authoritative state through TDD, including CAS, idempotency, journal integrity, restart, concurrency, retry/failure ordering, and corruption handling.

### Phase 5 — Durable orchestration contracts

Specified journal-as-outbox projection, stable execution identity, `ExecutionStore`, claims/leases, generic `ExecutorPort`, exact graph registry lookup, and crash/restart acceptance behaviors.

### Phase 6 — Pure execution projector

Implemented deterministic journal-to-`ExecutionIntent` projection and stable execution identity with no I/O or executor side effects.

### Phase 7 — Durable ExecutionStore

Implemented durable projection checkpoints/intents, leases, recovery discovery, lifecycle state, result immutability, restart, and real concurrent claims.

### Phase 8 — Generic dispatcher

Implemented durable-claim-before-start, same-ID start/status reconciliation, restart recovery, and executor-result persistence with no OMP dependency.

### Phase 9 — Immutable graph registry

Implemented durable write-once exact-version graph definitions, canonical equality, concurrency-safe registration, restart durability, runtime decoding, and ORCH-053/054 closure at the registry boundary.

Production projection runner, OMP executor adapter, executor routing/scheduler, policy-engine implementation, canonical operation digest generation, evidence payload storage/integrity, and graph application after terminal executor results remain outside the accepted Phase 9 boundary.

Each open or proposed decision must be resolved by RFC/ADR with alternatives, constraints, tests, and acceptance evidence before implementation authority expands.
