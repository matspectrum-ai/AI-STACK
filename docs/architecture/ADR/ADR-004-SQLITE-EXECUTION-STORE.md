# ADR-004 — SQLite as Initial ExecutionStore Adapter

Status: PROPOSED
Date: 2026-08-09
Depends on:
- `RFC-003 — Durable Execution Orchestration`
- `contracts/execution.ts`
- `ADR-003 — SQLite as Initial Authoritative State Store Adapter`

## Context

AI-STACK now has a pure execution projector but no durable store for projected intents, checkpoints, claims, leases, executor references, or terminal results.

The `ExecutionStore` is derived orchestration state. It is deliberately not authoritative Engineering Graph state and MUST NOT require a transaction shared with `AuthoritativeStateStore`.

The first adapter must prove atomic projection/checkpoint commits, concurrent claims, lease expiry/reclaim, restart durability, immutable terminal results, and fail-closed integrity locally beside OMP.

## Decision proposal

Use SQLite through Bun's built-in `bun:sqlite` driver as the first durable `ExecutionStore` adapter.

The adapter will use its own logical schema and MAY use a separate database file from the authoritative graph-state store. Phase 7 conformance uses a separate file so journal-as-outbox semantics do not depend on cross-store atomicity.

This ADR remains PROPOSED until a real file-backed adapter passes the executable ExecutionStore conformance suite, including two-connection claim races and close/reopen recovery.

## Required properties

The adapter MUST:

- be file-backed for durability acceptance;
- use WAL for the normal local profile;
- enable foreign-key enforcement where applicable;
- use bounded busy handling;
- atomically persist projection effects and checkpoint advancement;
- serialize claim/reclaim state changes transactionally;
- reject stale or expired leases for state mutations;
- preserve immutable intent identity/content after projection;
- preserve immutable terminal result after first successful terminal write;
- expose no SQLite types through `ExecutionStore`;
- never call executors or mutate authoritative graph state.

## Separate-store rationale

Using a separate ExecutionStore database for conformance preserves the architecture:

```text
AuthoritativeStateStore journal
        ↓ replay
ExecutionProjector
        ↓
ExecutionStore
```

If execution persistence is lost or unavailable, authoritative journal history remains sufficient to rebuild missing projected work. The design therefore does not rely on one transaction spanning graph authority and orchestration state.

## Concurrency scope

The v1 SQLite adapter claims authority only for workers coordinating through the same supported local SQLite database file.

It does not claim distributed consensus, network partition tolerance, multi-primary writes, or multi-region execution coordination.

## Recovery requirement

A durable execution store must support discovery of:

- `PENDING` executions for normal dispatch;
- expired `CLAIMED` or `RUNNING` executions for reconciliation/reclaim.

This requires a generic recoverable-execution query in the `ExecutionStore` port. Recovery MUST use the same stable `executionId`; it must never invent a new attempt because a lease expired.

## Rejected alternatives

### In-memory store

Rejected as acceptance evidence because it cannot prove process restart, file durability, or real lock contention.

### Reusing AuthoritativeStateStore tables

Rejected. Execution state is derived orchestration state and must not become graph authority or rely on shared schema/transaction coupling.

### PostgreSQL first

Deferred until multi-host coordination requirements justify an external service. The port remains backend-independent.

## Acceptance criteria

ADR-004 may move to ACCEPTED only after a real SQLite adapter proves:

- ORCH-016..030;
- ORCH-041..046;
- ORCH-048..049;
- recoverable expired CLAIMED/RUNNING discovery;
- two-connection claim/reclaim contention;
- close/reopen persistence;
- no graph-authority writes through the adapter;
- no SQLite type leakage through the generic port.

## Revisit triggers

Revisit when execution coordination must span independent hosts, contention is material, remote availability is required, or SQLite locking semantics no longer satisfy orchestration requirements.
