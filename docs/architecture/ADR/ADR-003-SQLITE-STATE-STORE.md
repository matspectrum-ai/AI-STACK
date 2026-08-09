# ADR-003 — SQLite as Initial Authoritative State Store Adapter

Status: PROPOSED
Date: 2026-08-09
Depends on:
- `RFC-002 — Authoritative State Persistence`
- `contracts/persistence.ts`

## Context

AI-STACK requires a first durable backend against which the persistence conformance suite can be executed.

The v1 execution model is local-first around OMP, while the storage port must remain capable of supporting a future networked SQL adapter.

The selected backend must provide a real atomic transaction primitive for compare-and-swap revision checks, idempotency lookup, journal append, and snapshot update.

## Decision proposal

Use **SQLite through Bun's built-in `bun:sqlite` driver** as the first local durable adapter.

The adapter will be named conceptually:

`SqliteAuthoritativeStateStore`

This ADR remains PROPOSED until the real SQLite adapter passes the executable persistence conformance suite, including concurrency tests.

## Required configuration

The initial adapter MUST:

- use a file-backed SQLite database for durability tests;
- enable WAL mode for the normal local runtime profile;
- execute state-changing commit logic inside an explicit write transaction;
- use an immediate write transaction (`BEGIN IMMEDIATE` semantics) or an equivalent Bun transaction mode sufficient to acquire writer intent before reading/modifying the authoritative row set;
- enable foreign-key enforcement when the schema uses foreign keys;
- define a bounded busy/lock policy rather than indefinite blocking;
- keep all SQL inside the persistence adapter boundary;
- expose only the AI-STACK `AuthoritativeStateStore` contract upstream.

## Why SQLite first

### Fit

- local, zero-service deployment matches an AI engineering harness running beside OMP;
- SQLite provides transactional atomicity;
- Bun ships a native SQLite driver with transactions;
- Bun exposes deferred/immediate/exclusive transaction variants;
- WAL supports concurrent readers while writes remain serialized;
- a real file-backed database allows crash/reopen and multi-connection conformance tests unavailable to an in-memory fake.

### Portability

SQLite is an adapter choice, not a domain choice.

The application depends on:

```text
AuthoritativeStateStore
        ^
        |
SqliteAuthoritativeStateStore
```

A future adapter can implement:

```text
AuthoritativeStateStore
        ^
        |
PostgresAuthoritativeStateStore
```

without changing Engineering Graph contracts.

## Concurrency scope

The SQLite adapter v1 claims authority only for processes/connections coordinating through the same supported local SQLite database file and SQLite locking semantics.

It does not claim distributed consensus, multi-primary writes, network partition tolerance, or multi-region availability.

If AI-STACK later requires a networked multi-host control plane, that is a trigger for a PostgreSQL or equivalent adapter ADR.

## Transaction design constraint

One commit transaction must contain, in order:

1. operation-id lookup;
2. idempotent replay/conflict resolution;
3. current run/snapshot read under the write transaction;
4. expected-revision comparison;
5. structural commit validation;
6. journal append;
7. snapshot update;
8. idempotency binding insert;
9. commit.

Any error before commit must roll back the whole unit.

## Expected schema responsibilities

The eventual schema will need logical storage for:

- runs/current snapshots;
- append-only journal entries;
- idempotency bindings;

The concrete DDL is implementation and MUST be derived after executable tests exist.

## Rejected for first adapter

### JSON/filesystem journal only

Rejected as first adapter because implementing crash-safe atomic multi-record mutation, locking, idempotency uniqueness, and concurrency correctly would recreate database responsibilities.

### PostgreSQL first

Not rejected as a future production/network adapter, but rejected for the first local harness adapter because it introduces an external service before requirements justify it.

### In-memory adapter as proof of durability

Rejected as acceptance evidence. An in-memory fake may be useful for application tests but cannot prove reopen/resume durability or SQLite transaction behavior.

## Acceptance criteria

ADR-003 may move to ACCEPTED only when a real file-backed SQLite adapter proves:

- create/reopen deterministic resume;
- CAS conflict behavior;
- idempotent replay;
- conflicting replay rejection;
- atomic journal + snapshot state;
- concurrent same-revision writes produce one winner;
- retry/failure ordering invariants;
- journal ordering and immutability through the public port;
- corruption detection cases supported by the schema;
- no SQL/database types leak through the port.

## Revisit triggers

Revisit when:

- authoritative writes must coordinate across hosts that do not share one supported local SQLite file;
- write contention becomes material;
- remote service availability is required;
- replication/failover requirements exceed SQLite's selected deployment scope;
- conformance tests expose a contract SQLite cannot satisfy safely.