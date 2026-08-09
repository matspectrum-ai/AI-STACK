# SQLite Logical Persistence Schema v1

Status: CONTRACT FOR RED TESTS
Phase: 4 — SQLite State Store TDD

This document fixes the logical storage model required by the conformance suite. It is not executable DDL.

## 1. Schema metadata

Logical table: `schema_meta`

Required fields:

- `schema_version`: integer, exactly `1` for v1.

The adapter MUST reject unsupported schema versions during open before authoritative writes.

## 2. Current run snapshots

Logical table: `runs`

Required fields:

- `run_id`: text, primary identity;
- `graph_id`: text;
- `graph_version`: text;
- `state_revision`: non-negative integer;
- `journal_head_sequence`: non-negative integer;
- `snapshot_json`: text containing the versioned `GraphRunState` JSON envelope.

Required constraints/behavior:

- one row per run ID;
- graph ID/version are immutable for the life of the run;
- state revision and journal-head sequence move only through an authoritative transaction;
- snapshot JSON runtime-decodes to a `GraphRunState` whose run/graph/version/revision equal the metadata columns.

## 3. Append-only journal

Logical table: `journal`

Required fields:

- `run_id`: text;
- `sequence`: non-negative integer;
- `resulting_state_revision`: non-negative integer;
- `operation_id`: text;
- `operation_digest`: text;
- `graph_id`: text;
- `graph_version`: text;
- `operation_kind`: text;
- `operation_json`: text containing the versioned `JournalOperation` JSON envelope;
- `committed_at`: ISO-8601 timestamp text.

Required constraints/behavior:

- logical primary key is `(run_id, sequence)`;
- each committed operation ID appears at most once in authoritative journal history;
- journal sequence `0` is run creation;
- journal rows are never modified or deleted by the production adapter;
- the journal row for the head sequence has a resulting revision equal to the current run snapshot revision;
- journal graph binding equals run graph binding.

## 4. Idempotency bindings

Logical table: `idempotency`

Required fields:

- `operation_id`: text, primary identity for the store;
- `operation_digest`: text;
- `run_id`: text;
- `state_revision`: non-negative integer;
- `journal_sequence`: non-negative integer.

Required constraints/behavior:

- operation ID is globally unique within one SQLite store/database;
- a binding is created atomically with the corresponding journal/snapshot commit;
- the binding must resolve to an existing journal entry with matching operation ID/digest/run/revision/sequence;
- bindings are immutable through the production adapter.

## 5. Foreign/reference integrity

The adapter/schema MUST enforce or validate:

- journal `run_id` refers to an existing run;
- idempotency `run_id/journal_sequence` resolves to an authoritative journal record;
- operation ID/digest in idempotency equals the referenced journal operation ID/digest.

Where SQLite foreign-key constraints cannot express a semantic invariant, the adapter MUST validate it transactionally or during load/replay.

## 6. Serialized envelope v1

`runs.snapshot_json` and `journal.operation_json` use:

```json
{
  "schemaVersion": 1,
  "payload": {}
}
```

`payload` MUST be runtime-decoded according to its expected contract.

Rules:

- unknown `schemaVersion` -> `MALFORMED_PERSISTED_STATE`;
- invalid JSON -> `MALFORMED_PERSISTED_STATE`;
- structurally invalid payload -> `MALFORMED_PERSISTED_STATE`;
- metadata/payload identity mismatch -> the more specific graph/revision integrity code when applicable.

## 7. Test inspection names

Phase 4 corruption tests MAY rely on the logical table and field names in this document through test-only `bun:sqlite` access.

These names therefore become part of the SQLite adapter's v1 conformance surface, but not part of the application/domain `AuthoritativeStateStore` API.

Changing them in v1 requires updating this contract and the conformance tests before implementation changes.