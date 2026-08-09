# Decision Log

This file records accepted architectural decisions and unresolved decision points. Chat messages and agent output are not authoritative by themselves.

## Accepted direction

### D-001 — OMP as execution kernel

Status: PROVISIONALLY ACCEPTED

AI-STACK targets OMP / OhMyPI as the primary agent execution runtime. The generic execution boundary is AI-STACK-owned `ExecutorPort`; OMP-specific conformance remains pending under D-010/D-016.

### D-002 — Graph Engineering as architecture principle

Status: PROVISIONALLY ACCEPTED

The engineering lifecycle is represented as an explicit graph with typed nodes, transitions, gates, policies, artifacts, evidence, approvals, failures, and recovery paths.

### D-003 — Single control plane

Status: PROVISIONALLY ACCEPTED

AI-STACK owns authoritative workflow state. External frameworks may contribute primitives but cannot become competing orchestration authorities.

### D-004 — Evidence-backed TDD gates

Status: PROVISIONALLY ACCEPTED

Implementation requires specification, contracts, fail-first tests, observed RED, GREEN, refactor, and verification. Prose instructions alone are not enforcement.

### D-005 — GSD as reference only

Status: PROVISIONALLY ACCEPTED

GSD concepts may inform context isolation and atomic execution, but the archived framework is not a runtime dependency.

### D-006 — Authoritative graph state persistence model

Status: ACCEPTED
RFC: `docs/architecture/RFC/RFC-002-AUTHORITATIVE-STATE-PERSISTENCE.md`
Contract: `docs/contracts/AUTHORITATIVE-STATE-STORE.md`

The authoritative model is append-only per-run journal plus current snapshot, optimistic concurrency, atomic journal+snapshot mutation, and operation-ID/digest idempotency. Phase 4 proved real file-backed CAS, replay/conflict behavior, restart, concurrency, failure/retry/recovery ordering, and fail-closed integrity.

### D-009 — Initial runtime/test substrate

Status: ACCEPTED
ADR: `docs/architecture/ADR/ADR-001-INITIAL-RUNTIME-SUBSTRATE.md`

TypeScript on Bun is the accepted v1 executable contract-test and initial runtime substrate. The pure graph domain remains OMP-independent.

### D-013 — Initial authoritative persistence backend

Status: ACCEPTED
ADR: `docs/architecture/ADR/ADR-003-SQLITE-STATE-STORE.md`

SQLite through Bun's built-in `bun:sqlite` is the accepted first local durable `AuthoritativeStateStore` adapter. The storage port remains backend-independent.

### D-015 — Journal-as-outbox durable orchestration

Status: ACCEPTED
RFC umbrella: `docs/architecture/RFC/RFC-003-DURABLE-EXECUTION-ORCHESTRATION.md`
Contracts:
- `docs/contracts/EXECUTION-ORCHESTRATION.md`
- `docs/contracts/PROJECTION-RUNNER.md`

AI-STACK accepts the authoritative graph journal as the durable outbox for derived execution orchestration.

The accepted production path is:

```text
AuthoritativeStateStore journal
        ↓ read-only
exact immutable GraphDefinitionRegistry
        ↓
pure ExecutionProjector
        ↓
Durable ExecutionStore
        ↓
generic durable Dispatcher
        ↓
ExecutorPort
```

Accepted invariants:

- no cross-store transaction is required between graph authority and orchestration state;
- graph-journal history can reconstruct missing projected work after a crash;
- exact `graphId@graphVersion` is required for every projection;
- projection checkpoint and derived intents are durable and idempotent;
- the projection runner owns no local cursor; resume state is the durable ExecutionStore checkpoint;
- graph authority is read-only at the projection-runner boundary;
- derived execution state cannot directly mutate authoritative graph state;
- generic orchestration through the runner has no OMP dependency;
- execution dispatch remains downstream of durable intent and claim state.

Evidence accumulated across phases:

- Phase 6: deterministic journal-to-intent projector and stable execution identity;
- Phase 7: durable projection/checkpoint, claims, leases, recovery, terminal state, restart, and concurrent claim behavior;
- Phase 8: generic same-ID dispatcher/start/status reconciliation;
- Phase 9: immutable exact-version graph registry;
- Phase 10: production journal projection runner using real file-backed authoritative, registry, and execution stores.

Phase 10 TDD evidence:

- initial RED run `31299146355` exposed one test-only branded-number comparison plus the expected missing runner;
- clean RED run `31299209867` kept all accepted behavior green while runner/typecheck failed only because `create-projection-runner.ts` did not exist;
- GREEN run `31299255830` passed all suites, strict typecheck, and enforcement with the real stateless runner;
- post-refactor GREEN run `31299289592` passed the complete suite after per-entry graph-resolution/projection/store logic was isolated.

Phase 10 also closes:

- ORCH-047: projection authority is read-only by type and implementation;
- ORCH-056: generic orchestration contracts/runtime through the runner contain no OMP dependency.

D-015 acceptance does **not** mean the OMP executor adapter is conforming. RFC-003 remains an umbrella design document while executor-specific delivery conformance is still pending under D-010/D-016.

### D-017 — Initial durable ExecutionStore backend and recovery boundary

Status: ACCEPTED
ADR: `docs/architecture/ADR/ADR-004-SQLITE-EXECUTION-STORE.md`
Contract: `docs/contracts/SQLITE-EXECUTION-STORE.md`

SQLite is the accepted first durable derived-orchestration `ExecutionStore`. `DurableExecutionStore.listRecoverable(now, limit)` provides same-`ExecutionId` discovery/reclaim for expired CLAIMED/RUNNING work. Phase 7 proved atomic projection/checkpoint persistence, real concurrent claims, restart, lease semantics, and immutable terminal results.

### D-018 — Immutable exact-version GraphDefinitionRegistry

Status: ACCEPTED
ADR: `docs/architecture/ADR/ADR-005-SQLITE-GRAPH-REGISTRY.md`
Contract: `docs/contracts/GRAPH-DEFINITION-REGISTRY.md`

The registry is durable and immutable by `(graphId, graphVersion)`, with no latest/fallback lookup. Canonically equivalent re-registration replays; conflicting semantics under the same identity are rejected. Phase 9 proved exact lookup, concurrent registration races, restart, canonical equality, and fail-closed decoding.

### D-020 — Generic durable dispatcher and reconciliation state machine

Status: ACCEPTED
Contract: `docs/contracts/EXECUTION-DISPATCHER.md`
Test map: `docs/testing/DISPATCHER-CONFORMANCE.md`

The generic dispatcher requires durable claim before external start and preserves immutable intent identity/bindings. Uncertain start is reconciled with the same `ExecutionId`; NOT_FOUND permits later same-ID retry; UNKNOWN forbids blind restart. Phase 8 proved the generic behavior without OMP.

## Decisions under acceptance test

### D-010 — OMP integration boundary

Status: PROPOSED
Research: `docs/research/OMP-INTEGRATION.md`

The proposed boundary is:

```text
AI-STACK ExecutorPort
        ↓
OmpSdkExecutorAdapter
        ↓
OMP / OhMyPI
```

RPC remains a replaceable alternative when process isolation or cross-language operation is required.

The generic journal→intent→store→dispatcher path is now accepted. D-010 MUST NOT move to ACCEPTED until current OMP-specific start, identity, lifecycle/status, result, cancellation/interruption, and failure semantics are researched from primary sources, specified, observed RED, and implemented without giving OMP graph authority.

### D-016 — At-least-once dispatch with stable execution identity

Status: PROPOSED
RFC: `docs/architecture/RFC/RFC-003-DURABLE-EXECUTION-ORCHESTRATION.md`

AI-STACK generically uses stable `ExecutionId` and same-attempt reconciliation rather than claiming exactly-once external execution. Phase 6 proved stable identity, Phase 7 same-ID reclaim, and Phase 8 same-ID generic dispatch/reconciliation.

D-016 remains PROPOSED specifically at the real executor boundary until OMP demonstrates sufficient idempotent-start and/or durable status reconciliation semantics to prevent uncontrolled duplicate work after uncertainty/restart.

## Open decisions

- D-007: Evidence storage format
- D-008: Artifact identity and lineage concrete representation
- D-011: Policy evaluation and permissions implementation mechanism
- D-012: Graph DSL shape and relationship to Spec Kit semantics
- D-014: Canonical operation serialization and digest generation
- D-019: Worker scheduler lifecycle and executor-selection/routing mechanism

## Phase evidence

### Phase 1 — Domain contracts
Defined graph, node, edge, run state, transition, gate, policy, artifact, evidence, executor, approval, failure, and retry contracts.

### Phase 2 — Pure GraphKernel
Implemented deterministic graph validation, gates, transition verdicts, lineage, and retry evaluation through RED → GREEN → REFACTOR.

### Phase 3 — Persistence contracts
Specified authoritative state, optimistic concurrency, journal/snapshot atomicity, idempotency, and STORE-001..034 before implementation.

### Phase 4 — Authoritative SQLite persistence
Implemented and verified durable graph authority, restart, concurrency, journal integrity, corruption handling, and retry/failure ordering.

### Phase 5 — Durable orchestration contracts
Specified journal-as-outbox, execution identity, ExecutionStore, claims/leases, ExecutorPort, graph registry, dispatcher semantics, and crash/restart acceptance behaviors.

### Phase 6 — Pure execution projector
Implemented deterministic journal-to-`ExecutionIntent` projection with no I/O or executor side effects.

### Phase 7 — Durable ExecutionStore
Implemented durable projection checkpoints/intents, lifecycle, recovery, result immutability, restart, and concurrent claims.

### Phase 8 — Generic dispatcher
Implemented claim-before-start and same-ID executor start/status reconciliation without OMP dependency.

### Phase 9 — Immutable graph registry
Implemented durable write-once exact-version graph definitions, canonical equality, concurrency-safe registration, and runtime decoding.

### Phase 10 — Durable projection runner
Implemented stateless journal consumption, exact graph lookup, durable per-entry projection, batch/restart/race safety, ORCH-047 authority separation, and ORCH-056 OMP isolation. The runner was tested end-to-end with three independent file-backed SQLite adapter boundaries and no executor.

## Remaining before OMP-native execution is accepted

The generic durable orchestration foundation is now accepted. Remaining OMP-native work includes:

- OMP `ExecutorPort` adapter specification and conformance;
- real OMP stable-identity/start/status behavior and D-016 closure;
- artifact/evidence extraction from executor output;
- application-layer terminal-result → graph-transition workflow;
- worker scheduler/executor selection only where requirements justify it;
- policy/permission enforcement and evidence storage decisions.

Each proposed/open decision must be resolved by RFC/ADR with alternatives, constraints, fail-first tests, and acceptance evidence before implementation authority expands.
