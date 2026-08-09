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

## Decisions under acceptance test

### D-010 — OMP integration boundary

Status: PROPOSED
Research: `docs/research/OMP-INTEGRATION.md`

The proposed boundary is `Engineering Graph -> ExecutorPort -> OmpSdkExecutorAdapter -> OMP SDK`, with RPC as a replaceable adapter boundary when process isolation or cross-language operation is required.

D-010 MUST NOT move to ACCEPTED until the generic `ExecutorPort`, durable orchestration boundary, and OMP-specific adapter behaviors are separately specified, observed RED, and implemented without leaking OMP authority into graph state.

### D-015 — Journal-as-outbox durable orchestration

Status: PROPOSED
RFC: `docs/architecture/RFC/RFC-003-DURABLE-EXECUTION-ORCHESTRATION.md`
Contract: `docs/contracts/EXECUTION-ORCHESTRATION.md`

The proposed orchestration boundary treats the accepted authoritative graph journal as a durable outbox. A deterministic projector derives durable `ExecutionIntent` records from committed journal entries plus the exact immutable graph definition. Executor dispatch is forbidden until intent and claim state are durable.

This removes the unsafe `graph commit -> direct executor call` crash gap. Projection checkpoint and derived intents must commit atomically in the execution store, and journal replay must recreate missing intents idempotently after interruption.

D-015 MUST NOT move to ACCEPTED until the pure projector, execution-store, claim/lease, restart, and dispatcher suites defined by ORCH-001..056 have executable RED/GREEN evidence.

### D-016 — At-least-once dispatch with stable execution identity

Status: PROPOSED
RFC: `docs/architecture/RFC/RFC-003-DURABLE-EXECUTION-ORCHESTRATION.md`

AI-STACK proposes at-least-once orchestration at the executor-dispatch boundary rather than claiming impossible generic exactly-once external execution. Every execution attempt has a stable `ExecutionId`; uncertain/replayed dispatch reuses that identity. A conforming executor adapter must support idempotent start semantics and/or status reconciliation sufficient to prevent uncontrolled duplicate work.

D-016 MUST NOT move to ACCEPTED until generic dispatcher tests prove stable-identity replay/reconciliation and the eventual OMP adapter proves the required semantics against OMP behavior.

## Open decisions

- D-007: Evidence storage format
- D-008: Artifact identity and lineage concrete representation
- D-011: Policy evaluation and permissions implementation mechanism
- D-012: Graph DSL shape and relationship to Spec Kit semantics
- D-014: Canonical operation serialization and digest generation
- D-017: Concrete durable `ExecutionStore` backend and schema
- D-018: Immutable graph-definition registry persistence/lookup mechanism

## Phase 1 domain contracts

Phase 1 defined normative contracts for:

- GraphDefinition
- NodeDefinition
- EdgeDefinition
- GraphRunState
- TransitionRequest / TransitionVerdict / TransitionDecision
- GateDefinition / GateResult
- PolicyDefinition / PolicyResult
- ArtifactRecord
- EvidenceRecord
- ExecutorRecord
- ApprovalRecord
- FailureRecord
- RetryPolicy

## Phase 2 implementation evidence

Phase 2 added the first executable contract boundary and pure domain implementation:

- strict TypeScript domain contracts with no OMP imports;
- Bun-based contract test substrate;
- deterministic gate evaluation;
- deterministic transition verdict evaluation;
- graph definition validation;
- artifact lineage validation;
- retry policy evaluation;
- CI with explicit diagnostics and immutable action pinning;
- GREEN verification before and after cohesion refactoring.

## Phase 3 persistence contracts

Phase 3 specified:

- `AuthoritativeStateStore` async port;
- create/load/commit/journal typed outcomes;
- operation-ID/digest idempotency;
- optimistic state revision concurrency;
- atomic journal + snapshot persistence;
- transition/failure/retry/recovery structural commit rules;
- deterministic reopen/resume requirements;
- SQLite as the proposed first durable adapter;
- STORE-001..034 conformance requirements.

No persistence adapter was implemented in Phase 3.

## Phase 4 persistence implementation evidence

Phase 4 implemented the first durable authority boundary through TDD:

- SQLite adapter constructor/lifecycle/clock contract;
- logical schema contract for runs, journal, idempotency, and schema metadata;
- versioned JSON envelopes with runtime decoding;
- file-backed conformance tests and test-only corruption inspection;
- immediate write transactions for state-changing operations;
- optimistic revision checks;
- operation-ID/digest replay semantics;
- immutable journal through the production port;
- deterministic close/reopen state recovery;
- two-store concurrent writer conformance;
- fail-closed corruption handling;
- failure-before-retry/recovery ordering;
- post-GREEN cohesion refactor and re-verification.

TDD evidence:

- clean RED: run `31296829751` — persistence/typecheck failed only because the contracted SQLite adapter module did not exist;
- implementation diagnostic: run `31296939329` — persistence behavior passed while one implementation-only type error remained;
- GREEN: run `31296969993` — domain tests, persistence tests, strict typecheck, and enforcement passed;
- post-refactor GREEN: run `31297024859` — complete suite passed again.

## Phase 5 durable orchestration contracts

Phase 5 specifies, but does not implement:

- journal-as-outbox execution projection;
- stable execution identity and explicit attempt identity;
- immutable `ExecutionIntent` records;
- projection checkpoints with atomic intent/checkpoint persistence;
- `ExecutionStore` port;
- claim/lease semantics;
- at-least-once dispatch semantics;
- generic `ExecutorPort` start/reconciliation contract;
- terminal result persistence without direct graph authority;
- exact graph-definition registry lookup;
- crash/restart recovery matrix;
- ORCH-001..056 component-owned acceptance behaviors.

No production projector, execution-store adapter, dispatcher, graph registry, or OMP executor adapter is introduced in Phase 5.

Each open or proposed decision must be resolved by RFC/ADR with alternatives, constraints, tests, and acceptance evidence before implementation authority expands.