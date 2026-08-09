# SQLite ExecutionStore Adapter Contract v1

Status: CONTRACT FOR RED TESTS
Phase: 7 — SQLite ExecutionStore TDD
Depends on:
- `RFC-003 — Durable Execution Orchestration`
- `ADR-004 — SQLite as Initial ExecutionStore Adapter`
- `contracts/execution.ts`
- `contracts/execution-store.ts`
- `contracts/sqlite-execution-store.ts`

## 1. Purpose

Define the first durable adapter for projected execution intents, projection checkpoints, claims/leases, executor references, and terminal results without giving orchestration authority over Engineering Graph state.

The adapter MUST NOT call executors, OMP, tools, policies, or `AuthoritativeStateStore` mutation methods.

## 2. Constructor

Production module path:

`src/orchestration/store/sqlite/create-sqlite-execution-store.ts`

It MUST export:

```ts
createSqliteExecutionStore(
  options: SqliteExecutionStoreOptions,
): Promise<ClosableExecutionStore>
```

Options:

```text
databasePath: string
busyTimeoutMs: number
```

Rules:

- acceptance uses a file-backed database;
- `busyTimeoutMs` is a finite non-negative integer;
- invalid options fail before authoritative orchestration writes;
- `close()` is idempotent;
- operations after close fail explicitly rather than silently reopening.

## 3. Logical schema v1

### schema_meta

- `schema_version` integer, exactly `1`.

### projection_batches

Primary identity: `(projector_id, run_id, source_sequence)`.

Fields:

- projector ID;
- run ID;
- source journal sequence;
- source operation ID;
- graph ID/version;
- ordered execution-ID effect set.

Purpose: distinguish true replay from conflicting reuse of an already processed sequence.

### projection_checkpoints

Primary identity: `(projector_id, run_id)`.

Fields:

- projector ID;
- run ID;
- processed-through journal sequence.

Checkpoint and all effects for one projected journal entry MUST commit atomically.

### executions

Primary identity: `execution_id`.

Immutable intent fields include:

- execution ID;
- run ID;
- graph ID/version;
- node ID;
- source journal sequence;
- source operation ID;
- attempt;
- bound artifact/evidence/approval IDs;
- optional executor policy ID;
- created-at timestamp.

Mutable orchestration fields include:

- status;
- lease ID;
- worker ID;
- claimed-at;
- expires-at;
- executor reference;
- terminal result envelope.

Intent content is immutable after insertion.

## 4. Projection transaction

`projectJournalEntry()` MUST run as one serialized write transaction.

For first sequence:

- when no checkpoint exists, only source sequence `0` is valid;
- sequence `0` effects and checkpoint `0` commit atomically.

For subsequent sequences:

- source sequence MUST equal current checkpoint + 1;
- any other unprocessed sequence returns `CHECKPOINT_CONFLICT` with no mutation.

Replay:

- a previously projected identical `(projector, run, sequence, source identity, effect set)` returns `REPLAYED`;
- existing execution ID with different immutable intent content returns `INTEGRITY_ERROR/EXECUTION_INTENT_CONFLICT`;
- conflicting reuse of an already processed sequence fails closed.

No intent may become visible without the corresponding checkpoint commit, and no checkpoint may advance without all intents being durable.

## 5. Pending query

`listPending({limit})`:

- validates finite positive integer limit;
- returns only `PENDING` executions;
- returns deterministic ordering by stable persisted identity/source order;
- never returns terminal or claimed/running work.

## 6. Claim and lease semantics

A lease is valid only when:

- identifiers are non-empty;
- `claimedAt` and `expiresAt` are valid ISO-8601 timestamps;
- `expiresAt > claimedAt`;
- explicit request `now` is a valid ISO-8601 timestamp.

Claim rules:

- `PENDING` + valid lease -> `CLAIMED`;
- unexpired current lease cannot be stolen -> `CLAIM_CONFLICT`;
- expired `CLAIMED` or `RUNNING` may be reclaimed using the same execution ID;
- reclaim replaces the lease and returns status `CLAIMED` so the dispatcher must reconcile before assuming executor state;
- terminal execution cannot be reclaimed and fails closed as invalid execution transition;
- two concurrent claims must produce one winner.

## 7. Recoverable query

`listRecoverable({now, limit})` returns only non-terminal executions in `CLAIMED` or `RUNNING` whose current lease is expired at `now`.

It exists so restart recovery can discover work requiring reclaim/reconciliation without inventing a new attempt.

It MUST NOT mutate state.

## 8. Mark running

`markRunning()` requires:

- current status `CLAIMED`;
- matching current lease ID;
- lease unexpired at explicit `now`;
- non-empty executor reference.

Success sets status `RUNNING` and durably binds the executor reference.

Stale lease -> `STALE_LEASE`.
Expired lease -> `LEASE_EXPIRED`.
Invalid lifecycle transition -> `INTEGRITY_ERROR/INVALID_EXECUTION_TRANSITION`.

## 9. Terminal result

`recordResult()` requires:

- result execution ID exactly matches request execution ID;
- matching current lease ID for the first terminal write;
- lease unexpired at explicit `now`;
- source execution is `RUNNING` or a reclaimed `CLAIMED` execution being reconciled;
- result outcome exactly maps to terminal status `SUCCEEDED` or `FAILED`.

After first terminal write:

- identical result replay returns `REPLAYED` even if the old lease has subsequently expired;
- different result for same execution returns `RESULT_CONFLICT`;
- terminal result and terminal status are immutable.

## 10. Restart behavior

Close/reopen MUST preserve:

- checkpoints;
- intents;
- statuses;
- leases;
- executor references;
- terminal results.

A `PENDING` execution remains discoverable after reopen.
An expired claimed/running execution remains discoverable via `listRecoverable` after reopen.

## 11. Runtime validation

Persisted structured fields use versioned JSON envelopes and are runtime-decoded.

Malformed JSON, unsupported schema version, invalid status/lease/result shape, or metadata/payload mismatch fails closed with an orchestration integrity error or construction failure where appropriate.

## 12. SQLite configuration

The adapter MUST configure/verify:

- WAL for normal file-backed profile;
- foreign-key enforcement where used;
- bounded busy timeout;
- schema compatibility.

Projection and lifecycle mutations MUST use immediate/serialized write transactions sufficient to make their compare-and-mutate behavior atomic across two independently opened connections.

## 13. Acceptance

Phase 7 cannot move to GREEN until executable tests prove the assigned ExecutionStore cases from `EXECUTION-ORCHESTRATION.md`, plus recoverable expired `CLAIMED/RUNNING` discovery and real close/reopen/two-connection behavior.
