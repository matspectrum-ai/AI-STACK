# ADR-005 — SQLite as Initial Durable GraphDefinitionRegistry

Status: ACCEPTED
Date: 2026-08-09
Accepted in: Phase 9 — Graph Registry TDD
Depends on:
- `docs/contracts/GRAPH-DEFINITION-REGISTRY.md`
- `contracts/graph-registry.ts`

## Context

The production journal projection path requires exact immutable lookup of the graph version referenced by authoritative journal history.

The registry needs durable write-once identity, exact lookup, concurrent registration safety, restart durability, and fail-closed decoding. It does not require a network service for the initial local OMP-oriented harness.

## Decision

Use SQLite through Bun's built-in `bun:sqlite` driver as the first durable `GraphDefinitionRegistry` adapter.

The registry is a separate adapter boundary and uses its own local file in conformance. It does not share transaction authority with `AuthoritativeStateStore` or `ExecutionStore`.

## Logical schema v1

Logical table `graph_definitions`:

- `graph_id` text;
- `graph_version` text;
- `canonical_json` deterministic canonical representation used only for equality/conflict detection;
- `definition_json` versioned envelope preserving the first registered representation for lookup;
- primary key `(graph_id, graph_version)`.

The production API has no update/delete operation.

Keeping canonical equality separate from the first stored representation allows incidental collection reordering to replay idempotently without rewriting the originally registered immutable artifact.

## Transaction semantics

Registration uses a serialized immediate write transaction:

1. validate graph and execution metadata;
2. derive canonical representation;
3. read exact identity;
4. absent -> insert and return REGISTERED;
5. present with same canonical representation -> REPLAYED;
6. present with different canonical representation -> CONFLICT;
7. commit.

Concurrent writers therefore cannot rebind one graph identity.

## Why SQLite first

- local zero-service deployment aligns with AI-STACK's initial runtime;
- primary-key uniqueness provides a durable identity boundary;
- immediate transactions provide deterministic concurrent registration behavior;
- file-backed storage proves close/reopen semantics;
- SQL/storage types remain behind the generic registry port.

## Rejected alternatives

### Mutable filesystem path per graph/version

Deferred. Correct atomic create-if-absent plus concurrent conflicting writers and fail-closed metadata handling would require additional locking/rename discipline with no current advantage.

### In-memory map

Rejected as acceptance evidence because it cannot prove restart durability or real concurrent access.

### PostgreSQL first

Deferred until graph-definition coordination must span independent hosts.

## Acceptance evidence

Phase 9 proved:

- first registration and exact retrieval;
- ORCH-053 exact-version lookup with no fallback;
- ORCH-054 invalid graph rejection at the registry boundary;
- canonical reorder replay;
- conflicting same-identity rejection;
- independent version coexistence;
- close/reopen durability;
- same-content and conflicting-content two-connection races;
- corrupted persisted definition fail-closed;
- no SQLite/OMP/graph-state mutation authority through the public registry port.

TDD evidence:

- clean RED: run `31298836779` — previously accepted suites remained green while registry tests/typecheck failed only because the contracted SQLite registry module did not exist;
- GREEN: run `31298908373` — all suites, strict typecheck, and enforcement passed against the real file-backed adapter;
- post-refactor GREEN: run `31298941526` — complete suite passed after SQLite row lookup/integrity decoding was isolated from the registry transaction flow.

## Consequences

Accepted:

- exact immutable `graphId@graphVersion` lookup is now durable;
- canonical equivalence is non-cryptographic and independent from D-014;
- the journal projection runner can now resolve the exact graph version before projection.

Not accepted by this ADR:

- production journal projection runner/pump;
- graph activation/latest-version semantics;
- distributed registry coordination;
- OMP integration.

## Revisit triggers

Revisit when registry writes/lookups must coordinate across independent hosts, remote availability/replication is required, or SQLite's local locking scope is insufficient.
