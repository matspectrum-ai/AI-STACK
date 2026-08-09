# ADR-003 — SQLite as Initial Authoritative State Store Adapter

Status: ACCEPTED
Date: 2026-08-09
Accepted: 2026-08-09
Depends on:
- `RFC-002 — Authoritative State Persistence`
- `contracts/persistence.ts`

## Context

AI-STACK requires a first durable backend against which the persistence conformance suite can be executed.

The v1 execution model is local-first around OMP, while the storage port must remain capable of supporting a future networked SQL adapter.

The selected backend must provide a real atomic transaction primitive for compare-and-swap revision checks, idempotency lookup, journal append, and snapshot update.

## Decision

Use **SQLite through Bun's built-in `bun:sqlite` driver** as the first local durable adapter.

The accepted adapter boundary is exposed only through `AuthoritativeStateStore`; SQLite types remain internal to `src/persistence/sqlite/**`.

## Required configuration

The initial adapter:

- uses a file-backed SQLite database for durability tests;
- enables WAL mode for the normal local runtime profile;
- executes state-changing commit logic inside an immediate write transaction;
- enables foreign-key enforcement;
- applies a bounded busy timeout;
- keeps SQL inside the persistence adapter boundary;
- exposes only AI-STACK-owned contracts upstream.

## Why SQLite first

### Fit

- local, zero-service deployment matches an AI engineering harness running beside OMP;
- SQLite provides transactional atomicity;
- Bun ships a native SQLite driver with transactions;
- Bun exposes immediate transaction semantics;
- WAL supports concurrent readers while writes remain serialized;
- a real file-backed database permits reopen and multi-connection conformance tests.

### Portability

SQLite is an adapter choice, not a domain choice.

```text
AuthoritativeStateStore
        ^
        |
SqliteAuthoritativeStateStore
```

A future adapter can implement the same port:

```text
AuthoritativeStateStore
        ^
        |
PostgresAuthoritativeStateStore
```

without changing Engineering Graph contracts.

## Concurrency scope

The SQLite adapter v1 claims authority for processes/connections coordinating through the same supported local SQLite database file and SQLite locking semantics.

It does not claim distributed consensus, multi-primary writes, network partition tolerance, or multi-region availability.

A networked multi-host control plane remains a future PostgreSQL-or-equivalent decision.

## Transaction design

One commit transaction performs:

1. operation-ID lookup;
2. idempotent replay/conflict resolution;
3. current run/snapshot integrity validation under writer transaction;
4. expected-revision comparison;
5. structural commit validation;
6. snapshot CAS update;
7. journal append;
8. idempotency binding insert;
9. commit.

All writes remain one SQLite transaction; failures roll back the entire unit.

## Logical schema

The accepted v1 logical schema is defined in:

`docs/contracts/SQLITE-LOGICAL-SCHEMA.md`

It contains:

- current run snapshots;
- append-only journal records;
- idempotency bindings;
- schema metadata;
- versioned serialized envelopes.

## Rejected for first adapter

### JSON/filesystem journal only

Rejected because crash-safe atomic multi-record mutation, locking, uniqueness, and concurrency would recreate database responsibilities.

### PostgreSQL first

Retained as a future networked backend option, but unnecessary for the first local harness runtime.

### In-memory adapter as durability evidence

Rejected because it cannot prove close/reopen durability or real SQLite transaction behavior.

## Acceptance evidence

Phase 4 executed the required TDD cycle against a real file-backed SQLite adapter.

### RED

- Initial persistence run `31296741098` revealed both the intentionally missing adapter and test-only branded-number type errors.
- After fixing only the tests, run `31296829751` was a clean RED: domain tests remained green; persistence tests and typecheck failed solely because `src/persistence/sqlite/create-sqlite-authoritative-state-store.ts` did not exist.

### GREEN

- Minimal SQLite implementation was added only after the clean RED.
- Run `31296939329` showed the persistence behavior suite passing while one implementation-only TypeScript narrowing error remained.
- That implementation typing issue was corrected without weakening tests.
- Run `31296969993` passed domain tests, STORE conformance tests, strict typecheck, and CI enforcement.

### REFACTOR

- SQLite configuration/schema initialization was extracted from the main adapter into a cohesive schema module.
- Run `31297024859` passed the complete suite again after refactoring.

The accepted suite covers create/reopen, optimistic concurrency, idempotent replay, conflicting replay, atomic journal/snapshot state, two-connection same-revision races, failure/retry/recovery ordering, journal integrity, corruption fail-closed behavior, lifecycle, and backend isolation.

## Consequences

- D-013 is accepted for the local v1 adapter scope.
- The persistence model remains backend-independent.
- SQLite is not authority outside the `AuthoritativeStateStore` contract.
- Canonical operation digest generation remains a separate future contract.
- OMP execution remains blocked from authoritative workflow dispatch until orchestration/executor contracts are specified and tested.

## Revisit triggers

Revisit when:

- authoritative writes must coordinate across hosts that do not share one supported local SQLite file;
- write contention becomes material;
- remote service availability is required;
- replication/failover requirements exceed SQLite's selected deployment scope;
- conformance evidence exposes a guarantee SQLite cannot satisfy safely.