# ADR-004 — SQLite as Initial ExecutionStore Adapter

Status: ACCEPTED
Date: 2026-08-09
Accepted in: Phase 7 — SQLite ExecutionStore TDD
Depends on:
- `RFC-003 — Durable Execution Orchestration`
- `contracts/execution.ts`
- `contracts/execution-store.ts`
- `ADR-003 — SQLite as Initial Authoritative State Store Adapter`

## Context

AI-STACK requires durable storage for projected intents, checkpoints, claims, leases, executor references, terminal results, and restart recovery.

The `ExecutionStore` is derived orchestration state. It is deliberately not authoritative Engineering Graph state and does not require a transaction shared with `AuthoritativeStateStore`.

The first adapter had to prove atomic projection/checkpoint commits, concurrent claims, lease expiry/reclaim, restart durability, immutable terminal results, and recovery discovery locally beside OMP.

## Decision

Use SQLite through Bun's built-in `bun:sqlite` driver as the first durable `ExecutionStore` adapter.

The adapter owns a separate logical schema and Phase 7 conformance uses a separate database file from authoritative graph state. Journal-as-outbox therefore does not depend on cross-store atomicity.

The generic orchestration boundary is refined by `DurableExecutionStore`, which adds `listRecoverable(now, limit)` so expired `CLAIMED`/`RUNNING` work can be reclaimed and reconciled using the same stable `ExecutionId`.

## Required properties

The accepted adapter:

- is file-backed for durability acceptance;
- uses WAL for the normal local profile;
- uses bounded busy handling;
- atomically persists projection effects and checkpoint advancement;
- serializes claim/reclaim state changes transactionally;
- rejects stale or expired leases for state mutations;
- preserves immutable intent identity/content after projection;
- preserves immutable terminal results after the first successful terminal write;
- exposes no SQLite types through `ExecutionStore`;
- never calls executors or mutates authoritative graph state;
- discovers expired non-terminal work without creating a new execution attempt.

## Separate-store rationale

The accepted architecture remains:

```text
AuthoritativeStateStore journal
        ↓ replay
ExecutionProjector
        ↓
ExecutionStore
```

If execution persistence is lost or unavailable, authoritative journal history remains the source from which missing projected work can be rebuilt. The design does not rely on one transaction spanning graph authority and orchestration state.

## Concurrency scope

The v1 SQLite adapter claims authority only for workers coordinating through the same supported local SQLite database file.

It does not claim distributed consensus, network partition tolerance, multi-primary writes, or multi-region execution coordination.

## Recovery semantics

A durable execution store supports discovery of:

- `PENDING` executions for normal dispatch;
- expired `CLAIMED` or `RUNNING` executions for reconciliation/reclaim.

Recovery reuses the same stable `executionId`; lease expiration does not create a new attempt. Reclaim moves non-terminal work back to `CLAIMED` with a new lease so the dispatcher must reconcile executor state before assuming whether external work started.

## Rejected alternatives

### In-memory store

Rejected as acceptance evidence because it cannot prove process restart, file durability, or real lock contention.

### Reusing AuthoritativeStateStore as orchestration authority

Rejected. Execution state is derived orchestration state and must not become graph authority or rely on shared transaction coupling.

### PostgreSQL first

Deferred until multi-host coordination requirements justify an external service. The port remains backend-independent.

## Acceptance evidence

Phase 7 established the decision through TDD:

- initial RED run `31298061054` exposed a test-fixture defect (`exactOptionalPropertyTypes`) in addition to the missing adapter;
- clean RED run `31298087447` kept domain, authoritative persistence, and accepted projector behavior green while new ExecutionStore tests/typecheck failed solely because `create-sqlite-execution-store.ts` did not exist;
- implementation run `31298184197` passed all behavioral suites, including real two-connection claim contention and restart/recovery, with only an implementation import-type error remaining;
- first complete GREEN run `31298243264` passed domain, authoritative persistence, orchestration, strict typecheck, and enforcement;
- post-refactor GREEN run `31298289515` passed the complete suite again.

Conformance includes:

- ORCH-016..030;
- ORCH-041..046;
- ORCH-048..049;
- ORCH-057 concurrent two-connection claim race;
- ORCH-058 expired `CLAIMED`/`RUNNING` recovery discovery and same-ID reclaim;
- ORCH-059 terminal-result durability across close/reopen.

## Consequences

Accepted:

- SQLite is the first local durable ExecutionStore adapter;
- projection/checkpoint state and execution lifecycle survive process restart;
- worker crash recovery has a generic query path;
- dispatcher implementation can now depend on durable claims rather than in-memory coordination.

Not accepted by this ADR:

- dispatcher behavior;
- executor selection;
- executor start/reconciliation semantics;
- OMP-specific execution behavior;
- distributed/multi-host orchestration.

## Revisit triggers

Revisit when execution coordination must span independent hosts, contention becomes material, remote availability is required, or SQLite locking semantics no longer satisfy orchestration requirements.
