# Execution Projector Public API v1

Status: CONTRACT
Phase: 6 — Execution Projector TDD
Depends on:
- `RFC-003 — Durable Execution Orchestration`
- `contracts/execution.ts`

## Purpose

Define the smallest executable pure boundary required to derive executor intents from committed authoritative journal entries.

## Module boundary

The production module MUST be:

`src/orchestration/projector/create-execution-projector.ts`

It MUST export:

```ts
createExecutionProjector(): ExecutionProjector
```

## Dependency direction

Allowed:

```text
projector
  -> contracts/execution
  -> contracts/persistence
  -> contracts/domain
  -> pure graph validation
```

Forbidden:

```text
projector -> bun:sqlite
projector -> AuthoritativeStateStore adapter
projector -> ExecutionStore adapter
projector -> ExecutorPort implementation
projector -> OMP package / RPC / ACP
projector -> network I/O
```

## Purity

`derive(entry, graph, createdAt)` MUST:

- perform no I/O;
- mutate none of its inputs;
- call no executor;
- persist nothing;
- derive no value from wall-clock time other than the supplied `createdAt`;
- be deterministic over identical inputs.

## Graph validation

The projector MUST reject a graph that does not satisfy the existing Engineering Graph structural validation plus the execution-projection requirements used by the current source entry.

Failure result:

```text
INTEGRITY_ERROR / GRAPH_DEFINITION_INVALID
```

A structurally valid graph with an authoritative source entry that references an absent edge/node is a source/graph integrity mismatch and returns:

```text
INTEGRITY_ERROR / PROJECTION_INTEGRITY_FAILURE
```

## Execution ID

The projector owns deterministic execution-ID derivation for v1.

The exact string representation is private implementation detail. Tests assert properties, not a particular textual encoding:

- same run + graph version + journal sequence + node + attempt -> same execution ID;
- changing attempt -> different execution ID;
- changing source journal sequence -> different execution ID;
- IDs do not encode authority semantics consumed by business logic.

## Transition projection

For `transition_committed`:

- journal run/graph/version MUST agree with the embedded decision;
- decision edge MUST exist;
- destination node MUST exist;
- `executionMode=control` -> zero intents;
- `executionMode=dispatch` -> exactly one PENDING intent;
- attempt is `1`;
- transition binding IDs are preserved exactly;
- destination `executorPolicyId` is preserved when present.

## Retry projection

For `retry_activated`:

- activation node MUST exist;
- `nextAttempt` MUST be a positive integer;
- dispatch node -> exactly one intent with attempt `nextAttempt`;
- control node -> zero intents;
- v1 does not invent artifact/evidence/approval bindings for retry projection.

## Recovery projection

For `recovery_activated`:

- recovery node MUST exist;
- dispatch node -> one intent with attempt `1`;
- control node -> zero intents;
- v1 does not invent bindings.

## Non-dispatch journal operations

`run_created` and `failure_recorded` always project successfully with zero intents.

## Error behavior

Expected projection invalidity MUST be returned through `ExecutionProjectionResult`.

It MUST NOT be represented by arbitrary uncaught exceptions.

Programming defects may throw, but they are not valid substitutes for contract-defined integrity outcomes.