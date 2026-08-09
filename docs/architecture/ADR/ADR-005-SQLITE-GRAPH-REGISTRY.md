# ADR-005 — SQLite as Initial Durable GraphDefinitionRegistry

Status: PROPOSED
Date: 2026-08-09
Depends on:
- `docs/contracts/GRAPH-DEFINITION-REGISTRY.md`
- `contracts/graph-registry.ts`

## Context

The production journal projection path requires exact immutable lookup of the graph version referenced by authoritative journal history.

The registry needs durable write-once identity, exact lookup, concurrent registration safety, restart durability, and fail-closed decoding. It does not require a network service for the initial local OMP-oriented harness.

## Decision proposal

Use SQLite through Bun's built-in `bun:sqlite` driver as the first durable `GraphDefinitionRegistry` adapter.

The registry is a separate adapter boundary. Its schema may reside in its own local database file for conformance and does not share transaction authority with `AuthoritativeStateStore` or `ExecutionStore`.

This ADR remains PROPOSED until a real file-backed adapter passes executable registry conformance tests.

## Proposed logical schema

Logical table `graph_definitions`:

- `graph_id` text;
- `graph_version` text;
- `definition_json` versioned canonical execution-graph envelope;
- primary key `(graph_id, graph_version)`.

The production API has no update/delete operation.

## Transaction semantics

Registration MUST use a serialized write transaction:

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

## Acceptance criteria

ADR-005 may move to ACCEPTED only when a real file-backed implementation proves:

- first registration and exact retrieval;
- ORCH-053 exact-version lookup with no fallback;
- invalid graph rejection;
- canonical reorder replay;
- conflicting same-identity rejection;
- independent version coexistence;
- close/reopen durability;
- same-content and conflicting-content two-connection races;
- corrupted persisted definition fails closed;
- no SQLite/OMP/graph-state mutation authority leaks through the registry port.

## Revisit triggers

Revisit when registry writes/lookups must coordinate across independent hosts, remote availability/replication is required, or SQLite's local locking scope is insufficient.
