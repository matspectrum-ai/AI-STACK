# SQLite OMP Execution Registry Adapter Contract v1

Status: CONTRACT FOR RED TESTS
Phase: 12 — Launch Validation + OMP Registry TDD
Depends on:
- `docs/contracts/OMP-EXECUTION-REGISTRY.md`
- `contracts/sqlite-omp-execution-registry.ts`
- `ADR-006 — SQLite as Initial OMP Execution Registry`

## 1. Constructor

Production module path:

`src/executors/omp/registry/sqlite/create-sqlite-omp-execution-registry.ts`

It exports:

```ts
createSqliteOmpExecutionRegistry({
  databasePath,
  busyTimeoutMs,
}): Promise<ClosableOmpExecutionRegistry>
```

Acceptance requires a file-backed database.

## 2. Logical schema v1

### schema_meta

- `schema_version` integer, exactly 1.

### omp_executions

Primary key: `execution_id`.

Required fields:

- `execution_id` text;
- `launch_spec_json` versioned JSON envelope;
- `session_id` text;
- `session_file` absolute path text;
- `phase` text: PREPARED | ACTIVE | SUCCEEDED | FAILED | INTERRUPTED;
- `prepared_at` timestamp;
- nullable `activated_at`;
- nullable `settled_at`;
- nullable `terminal_result_json` versioned JSON envelope;
- nullable `terminal_output_json` versioned JSON envelope;
- nullable `interruption_reason`.

Production API provides no delete/rebind operation.

## 3. Runtime decoding

All versioned JSON fields are parsed and runtime-validated. Invalid JSON, unsupported envelope version, malformed launch spec/result/output, identity mismatch, lifecycle inconsistency, or metadata/payload mismatch returns `INTEGRITY_ERROR`.

`JSON.parse` success alone is insufficient.

## 4. Prepare transaction

`prepare()` is one serialized write transaction:

1. validate request and launch spec;
2. read exact execution ID;
3. absent -> insert PREPARED;
4. exact replay -> REPLAYED;
5. different spec/session identity -> CONFLICT;
6. commit.

Two connections cannot create two divergent bindings.

## 5. Lifecycle updates

Each lifecycle mutation uses a serialized transaction and validates the current persisted record before mutation.

PREPARED -> ACTIVE.
ACTIVE -> SUCCEEDED | FAILED | INTERRUPTED.
PREPARED -> INTERRUPTED is allowed.

Terminal records are immutable.
INTERRUPTED cannot return to ACTIVE under v1.

## 6. Success settlement

SUCCEEDED requires:

- result execution ID matches record execution ID;
- output is present;
- output schema ref exactly equals bound launch spec output schema ref;
- settled timestamp is valid and not earlier than activation.

The registry treats `output.value` as already schema-validated by the OMP adapter/runtime boundary; Phase 12 validates binding/durability, not JSON Schema evaluation.

## 7. Failure settlement

FAILED requires matching result execution ID and valid settlement timestamp. Structured output is optional; if present, its schema ref must match the bound launch schema ref.

## 8. Interruption

Reason must be non-empty and observed timestamp valid/not earlier than preparation. Repeated identical interruption is REPLAYED. Conflicting interruption metadata is CONFLICT.

## 9. SQLite configuration

The adapter must configure/verify:

- WAL for normal file-backed operation;
- bounded busy timeout;
- schema version compatibility.

## 10. Test-only corruption surface

Phase 12 conformance tests MAY access logical table `omp_executions` directly through `bun:sqlite` to corrupt serialized state and verify fail-closed decoding.

This table name is part of SQLite adapter v1 conformance, not the generic registry API.
