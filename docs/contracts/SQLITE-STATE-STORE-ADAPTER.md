# SQLite Authoritative State Store Adapter Contract v1

Status: CONTRACT FOR RED TESTS
Phase: 4 — SQLite State Store TDD
Depends on:
- `docs/architecture/RFC/RFC-002-AUTHORITATIVE-STATE-PERSISTENCE.md`
- `docs/contracts/AUTHORITATIVE-STATE-STORE.md`
- `docs/architecture/ADR/ADR-003-SQLITE-STATE-STORE.md`
- `contracts/persistence.ts`

## 1. Purpose

Define the executable boundary for the first durable `AuthoritativeStateStore` adapter without exposing SQLite types to application/domain code.

The adapter is responsible for durable transactional storage and runtime validation of persisted authoritative records. It is not responsible for GraphKernel decisions, OMP execution, policy reasoning, evidence payload verification, or external work dispatch.

## 2. Production constructor

The production module path is fixed as:

`src/persistence/sqlite/create-sqlite-authoritative-state-store.ts`

It MUST export:

```ts
createSqliteAuthoritativeStateStore(
  options: SqliteStateStoreOptions,
): Promise<ClosableAuthoritativeStateStore>
```

The constructor MAY become synchronous in a future contract revision only through an explicit contract change. Phase 4 tests assume the Promise-based boundary.

## 3. Production options

```text
SqliteStateStoreOptions
  databasePath: string
  clock: PersistenceClock
  busyTimeoutMs: number
```

Contracts:

- `databasePath` MUST identify a file-backed SQLite database for production/durability acceptance. `:memory:` is not accepted as evidence for STORE durability/reopen cases.
- `clock` MUST be explicit. Production code MUST NOT call `Date.now()`/`new Date()` directly for journal `committedAt` values.
- `busyTimeoutMs` MUST be a finite non-negative integer.
- invalid options MUST fail construction before an authoritative write occurs.

## 4. Clock contract

```text
PersistenceClock
  now(): string
```

`now()` MUST return an ISO-8601 timestamp string accepted by the adapter's persisted timestamp validator.

Tests use a deterministic clock. Runtime wall-clock selection belongs to composition code outside the persistence core.

## 5. Lifecycle contract

`ClosableAuthoritativeStateStore` extends `AuthoritativeStateStore` with:

```text
close(): Promise<void>
```

Rules:

- `close()` MUST release the adapter's database resources.
- `close()` MUST be idempotent.
- after close, state-store operations MUST fail explicitly rather than silently reopening a database.
- reopening is performed by calling the constructor again with the same file path.

## 6. SQLite configuration invariants

On successful open the adapter MUST configure/verify:

- WAL journal mode for the normal file-backed profile;
- foreign-key enforcement;
- bounded busy timeout from `busyTimeoutMs`;
- schema version compatibility;
- all required tables/indexes/constraints for the accepted adapter schema.

State-changing operations MUST use one immediate write transaction or an equivalent SQLite/Bun primitive that acquires writer intent before authoritative read/modify/write logic.

## 7. Serialization boundary

Authoritative structured payloads persisted as serialized data MUST use versioned JSON envelopes.

Minimum envelope:

```text
{
  schemaVersion: 1,
  payload: ...
}
```

The adapter MUST perform runtime validation after parsing. `JSON.parse` success alone is insufficient.

At minimum, runtime decoders are required for:

- `GraphRunState` snapshots;
- journal operation payloads;
- `TransitionDecision` payloads embedded in transition operations;
- `FailureRecord` payloads embedded in failure operations.

Unknown schema versions MUST fail closed.

Malformed types, missing required fields, invalid enum values, non-finite numeric fields, or invalid branded-ID underlying values MUST fail closed as `INTEGRITY_ERROR/MALFORMED_PERSISTED_STATE` unless a more specific integrity code applies.

## 8. Canonical operation digest boundary

Phase 4 does **not** compute the caller-provided `operationDigest` from operation objects.

The store treats `(operationId, operationDigest)` as an externally supplied idempotency binding and persists/compares it exactly.

Consequences:

- Phase 4 proves binding semantics, not cryptographic canonicalization correctness.
- canonical operation serialization/hash generation remains a separate future contract.
- the store MUST still validate the structural operation object before commit.

## 9. Structural validation before commit

Before any mutation, the adapter MUST validate the structural invariants from `AUTHORITATIVE-STATE-STORE.md`.

For every state commit:

- target run exists;
- request run ID matches `nextState.runId`;
- graph ID/version remain bound to the run;
- `nextState.revision == expectedRevision + 1`;
- operation-specific invariants hold.

Operation-specific requirements:

### transition_committed

- decision run ID matches request/run;
- decision graph ID/version match the run;
- decision `stateRevisionBefore == expectedRevision`;
- decision `stateRevisionAfter == expectedRevision + 1`;
- `nextState.lastTransitionId == decision.transitionId`.

### failure_recorded

- `nextState.failureRefs` contains the committed failure ID.

### retry_activated

- governing failure ID is present in the **current** persisted state;
- `nextAttempt` is a positive integer;
- previous counter defaults to `0` when absent;
- `nextAttempt == previousCounter + 1`;
- `nextState.retryCounters[counterKey] == nextAttempt`;
- activation node ID is present in `nextState.activeNodeIds`.

### recovery_activated

- governing failure ID is present in current persisted state;
- recovery node ID is present in `nextState.activeNodeIds`.

## 10. Idempotency ordering

Within one write transaction, existing operation-ID binding MUST be evaluated before expected-revision conflict for replay semantics.

Order:

1. lookup operation ID;
2. same digest -> return original receipt as `REPLAYED`, no mutation;
3. different digest -> `IDEMPOTENCY_VIOLATION`, no mutation;
4. only for a new operation ID, evaluate run/integrity/revision and commit.

## 11. Atomic commit boundary

One successful state-changing commit MUST atomically include:

- authoritative current-state read under writer transaction;
- expected-revision check;
- structural validation;
- journal append;
- current snapshot replacement/update;
- operation-ID/digest/receipt binding.

A caller MUST NOT observe a new snapshot without its journal record, or a journal record without its matching snapshot revision.

## 12. Public immutability

The production adapter MUST NOT expose methods to:

- update/delete journal entries;
- alter an idempotency binding;
- overwrite raw snapshot bytes;
- bypass revision checks;
- bypass structural validation.

## 13. Test-only corruption boundary

Corruption conformance cases require controlled mutation underneath the production port.

A separate test-only module is permitted at:

`tests/persistence/sqlite-test-inspector.ts`

It MAY use `bun:sqlite` directly and MUST NOT be imported by `src/**`.

Allowed test-only operations are narrowly scoped to constructing known corruption states, such as:

- overwrite raw snapshot serialized payload;
- overwrite snapshot revision metadata;
- overwrite graph binding metadata;
- delete/duplicate/renumber a journal row where SQLite constraints permit the fixture;
- overwrite idempotency digest/receipt metadata.

The production store interface remains immutable.

## 14. Concurrency test boundary

STORE-012 MUST use:

- one physical database file;
- two independently opened adapter instances/connections;
- two distinct operation IDs;
- the same expected revision;
- concurrent commit invocation.

Exactly one may commit for that expected revision. The other must resolve as `CONFLICT` after SQLite writer serialization completes, not as an uncaught `database is locked` error under the configured busy policy.

If the environment cannot achieve this behavior under a bounded timeout, ADR-003 is not accepted without revising the contract.

## 15. Reopen durability boundary

STORE-005 MUST:

1. create a temporary file-backed database;
2. commit authoritative state;
3. close the adapter;
4. create a new adapter instance for the same path;
5. load the run;
6. compare the authoritative state/journal head to the pre-close committed values.

An in-memory database cannot satisfy this case.

## 16. Exceptions versus typed results

Expected semantic outcomes remain typed port results:

- conflict;
- replay;
- idempotency violation;
- run-not-found;
- persisted integrity error.

Construction/configuration failures and infrastructure failures that prevent a trustworthy typed outcome MAY reject/throw.

If commit outcome is unknown due to infrastructure failure, the caller may retry only with the same operation ID/digest.

## 17. Dependency rule

Allowed:

```text
src/persistence/sqlite/**
  -> contracts/persistence
  -> contracts/domain
  -> bun:sqlite
```

Forbidden:

```text
src/domain/** -> bun:sqlite
src/domain/** -> src/persistence/sqlite/**
contracts/** -> bun:sqlite
```

## 18. Implementation gate

No production file under `src/persistence/sqlite/**` may be added until:

1. TypeScript adapter/lifecycle contracts are present;
2. executable persistence tests are present;
3. CI records those tests RED because the contracted SQLite adapter implementation is absent or unimplemented;
4. any ambiguity discovered while authoring tests is resolved in contracts before implementation.