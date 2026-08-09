# ADR-006 — SQLite as Initial OMP Execution Registry

Status: PROPOSED
Date: 2026-08-09
Depends on:
- `RFC-004 — OMP ExecutorPort Adapter`
- `docs/contracts/OMP-EXECUTION-REGISTRY.md`
- `contracts/omp-executor.ts`

## Context

The OMP adapter requires durable write-before-start identity:

```text
AI-STACK ExecutionId
  -> immutable ExecutionLaunchSpec
  -> OMP-generated sessionId/sessionFile
  -> adapter lifecycle/result
```

This mapping must survive the adapter host process and must exist before model execution is activated.

The initial AI-STACK runtime is local-first beside OMP. The registry needs atomic write-once identity, lifecycle transitions, terminal immutability, concurrent prepare protection, and restart durability.

## Decision proposal

Use SQLite through Bun's built-in `bun:sqlite` driver as the first local durable `OmpExecutionRegistry` adapter.

This ADR remains PROPOSED until a real file-backed registry passes the Phase 12 fail-first conformance suite.

## Proposed logical records

One immutable identity row per `execution_id` containing:

- versioned launch spec JSON;
- OMP session ID;
- OMP session file;
- lifecycle phase;
- prepared/activated/settled timestamps;
- optional interruption reason;
- optional terminal `ExecutionResult`;
- optional validated structured terminal output.

The concrete DDL must be derived only after executable tests exist.

## Transaction requirements

### Prepare

One immediate transaction:

1. runtime-validate request/spec;
2. read `execution_id`;
3. absent -> insert PREPARED;
4. identical existing mapping -> REPLAYED;
5. different mapping -> CONFLICT;
6. commit.

### Lifecycle update

Each ACTIVE/terminal/interrupted transition uses an atomic compare-and-update against the current valid phase and rejects stale/conflicting transitions.

## Why SQLite first

- local zero-service deployment matches OMP/AI-STACK v1;
- unique primary identity can enforce one mapping per `ExecutionId`;
- immediate transactions can serialize concurrent prepare/lifecycle races;
- file-backed storage proves adapter restart behavior;
- no SQLite type needs to cross the registry port.

## Separation from ExecutionStore

The generic `ExecutionStore` remains runtime-agnostic derived orchestration state.

`OmpExecutionRegistry` contains adapter-specific session identity and structured settlement metadata needed to reconcile OMP after a crash before generic dispatcher state is updated.

Merging these stores would leak OMP-specific state into the generic orchestration port and is rejected for v1.

## Acceptance criteria

ADR-006 may move to ACCEPTED only after Phase 12 proves:

- OMPREG-001..012;
- launch-spec replay/conflict behavior;
- real file-backed close/reopen;
- concurrent divergent prepare race;
- lifecycle transition validity/idempotency;
- successful terminal output schema binding;
- failed terminal settlement without required success payload;
- corruption fail-closed;
- no graph/executor runtime authority through the registry port.

## Revisit triggers

Revisit when adapter identity must coordinate across independent hosts, remote HA/replication is required, or OMP execution moves to a remote service whose own durable idempotency makes the local registry redundant.
