# Journal Projection Runner Contract v1

Status: CONTRACT FOR RED TESTS
Phase: 10 — Projection Runner TDD
Depends on:
- `RFC-003 — Durable Execution Orchestration`
- `contracts/projection-runner.ts`
- accepted `GraphDefinitionRegistry`
- accepted `ExecutionProjector`
- accepted durable `ExecutionStore`

## 1. Purpose

Close the production control-path gap between authoritative journal history and durable execution intents:

```text
Authoritative journal
  -> exact GraphDefinitionRegistry
  -> pure ExecutionProjector
  -> durable ExecutionStore checkpoint + intents
```

The runner is stateless. Durable progress belongs exclusively to the `ExecutionStore` projection checkpoint.

## 2. Narrow authority ports

The runner receives only:

- `AuthoritativeJournalReader.readJournal`;
- `GraphDefinitionRegistry.get`;
- `ExecutionProjector.derive`;
- projection-only `ExecutionStore.getCheckpoint/projectJournalEntry`.

It has no graph `commit`, no claim/dispatch/result API, and no executor/OMP port.

This narrow type boundary is part of ORCH-047 enforcement.

## 3. Batch configuration

`batchSize` MUST be a finite positive integer.

Each `run(runId)` processes at most `batchSize` journal entries sequentially.

## 4. Resume algorithm

For one run:

1. load projection checkpoint `(projectorId, runId)`;
2. if checkpoint exists, call `readJournal({runId, afterSequence: checkpoint})`;
3. if checkpoint does not exist, call `readJournal({runId})`;
4. process returned entries in journal order, at most `batchSize`;
5. for each entry, resolve exact `(entry.graphId, entry.graphVersion)`;
6. derive projection using `entry.committedAt` as deterministic intent `createdAt`;
7. atomically project entry effects/checkpoint through `ExecutionStore.projectJournalEntry`;
8. proceed only after PROJECTED or REPLAYED.

The runner owns no independent cursor.

## 5. Journal outcomes

- authoritative `NOT_FOUND` -> `RUN_NOT_FOUND`;
- authoritative `INTEGRITY_ERROR` -> `BLOCKED/AUTHORITATIVE_INTEGRITY_ERROR`;
- FOUND with no entries after checkpoint -> `IDLE`;
- returned entries inconsistent with strict forward sequence relative to checkpoint -> `BLOCKED/AUTHORITATIVE_INTEGRITY_ERROR`.

## 6. Exact graph lookup

For every journal entry:

- registry lookup MUST use exactly `entry.graphId` + `entry.graphVersion`;
- NOT_FOUND -> stop immediately with `GRAPH_DEFINITION_MISSING` and do not advance that sequence;
- INTEGRITY_ERROR -> stop with `GRAPH_DEFINITION_INVALID`;
- FOUND identity mismatch -> `GRAPH_DEFINITION_INVALID`.

No version fallback is allowed.

## 7. Projection

`projector.derive(entry, graph, entry.committedAt)` is mandatory.

- PROJECTED -> submit exact derived intents to store;
- projector INTEGRITY_ERROR -> stop with `PROJECTION_INTEGRITY_FAILURE`;
- runner MUST NOT synthesize/alter intent identity, attempt, bindings, or timestamps.

## 8. Projection-store outcomes

For each entry the runner submits:

- exact configured projector ID;
- journal entry;
- exact graph;
- expected checkpoint equal to the immediately previous processed journal sequence, omitted only for sequence 0 when no checkpoint exists;
- exact derived intent list.

Outcomes:

- PROJECTED / REPLAYED -> accepted progress;
- CHECKPOINT_CONFLICT -> `BLOCKED/CHECKPOINT_CONFLICT`;
- INTEGRITY_ERROR -> `BLOCKED/EXECUTION_STORE_INTEGRITY_ERROR`.

## 9. Crash/restart semantics

If process crashes:

- before store projection commit: no checkpoint advances; next run reprocesses the entry;
- after store commit but before runner returns: next run reads the durable checkpoint and starts after the committed entry;
- replay/race must not create duplicate intents.

No runner-local recovery state is allowed.

## 10. Concurrency

Two runners with the same `(projectorId, runId)` may race.

Safety relies on accepted `ExecutionStore` checkpoint/idempotency semantics:

- identical projection replay is safe;
- conflicting checkpoint progress is surfaced explicitly;
- no duplicate execution intent is allowed.

The runner does not claim a global leader role in v1.

## 11. ORCH-047 authority separation

The runner's authoritative port is read-only by type. It cannot commit graph state.

Projection of executor-derived orchestration state therefore cannot directly advance graph authority. A later application layer must construct and validate a separate graph transition through the authoritative kernel/store path.

## 12. ORCH-056 OMP isolation

Generic orchestration contracts and implementation through the projection runner MUST NOT import OMP/OhMyPI packages or types.

Phase 10 includes an executable source-boundary test for this constraint.

## 13. Acceptance

Phase 10 must prove before D-015 acceptance:

- run not found / authoritative integrity handling;
- sequence-0 bootstrap;
- exact graph lookup;
- transition journal entry -> durable intent;
- missing/corrupt graph fail-closed with checkpoint not advanced;
- batch-size bounded processing;
- repeated run idempotency;
- process restart resume using durable checkpoint;
- two-runner race safety;
- ORCH-047 read-only authority boundary;
- ORCH-056 no OMP imports/types in generic orchestration surfaces.
