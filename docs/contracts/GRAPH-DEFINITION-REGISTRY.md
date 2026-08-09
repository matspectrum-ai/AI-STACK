# Immutable GraphDefinitionRegistry Contract v1

Status: CONTRACT FOR RED TESTS
Phase: 9 — Graph Registry TDD
Depends on:
- `contracts/execution.ts`
- `contracts/graph-registry.ts`
- accepted `GraphKernel.validateGraph`

## 1. Purpose

Provide durable, immutable, exact-version lookup for execution-capable graph definitions used by the journal projection path.

The registry prevents the projector from silently substituting a newer/older graph version and prevents an already-used `graphId@graphVersion` identity from being rebound to different semantics.

## 2. Identity

Registry identity is exactly:

```text
(graphId, graphVersion)
```

Rules:

- both values are required and non-empty;
- graph version has no implicit ordering authority;
- `get(G,V)` returns exactly `G@V` or `NOT_FOUND`;
- latest/newest/fallback lookup is forbidden in v1.

## 3. Registration

`register(graph)` validates before any durable mutation.

Outcomes:

- first valid definition for identity -> `REGISTERED`;
- re-registration of canonically equivalent valid definition -> `REPLAYED`;
- same identity with different canonical definition -> `CONFLICT`;
- structurally invalid graph or invalid execution metadata -> `INVALID_GRAPH`.

Registration MUST NOT mutate an existing identity.

## 4. Graph validation

A registrable graph MUST satisfy:

- accepted `GraphKernel.validateGraph(graph)` produces zero errors;
- every node exposes execution metadata `executionMode` equal to `control` or `dispatch`;
- graph ID/version are non-empty;
- all opaque IDs used by the stored graph are non-empty strings;
- optional executor/retry policy IDs, when present, are non-empty;
- output contracts have non-empty `contractId` and `schemaRef`.

Validation is fail-closed.

## 5. Canonical equivalence

Registry replay equivalence MUST ignore incidental collection ordering where ordering has no declared semantics.

The v1 canonical form sorts:

- nodes by `nodeId`;
- edges by `edgeId`;
- entry node IDs lexicographically;
- terminal node IDs lexicographically;
- node `requiredArtifactKinds` lexicographically;
- node `requiredGateIds` lexicographically;
- node output contracts by `contractId`, then artifact kind, then schema ref;
- edge gate IDs lexicographically;
- edge policy IDs lexicographically.

All scalar semantic fields remain exact, including:

- graph ID/version;
- node kind;
- execution mode;
- executor policy ID;
- retry policy ID;
- edge endpoints/kind;
- output-contract schema refs.

The canonical representation is an internal equality/storage mechanism, not D-014's generic operation digest contract and not a cryptographic identity claim.

## 6. Immutability

After first registration of `G@V`:

- no production API may update/delete it;
- conflicting register returns `CONFLICT`;
- another version may be registered independently;
- callers receive decoded copies/values, not mutable database/storage handles.

## 7. Lookup

`get(graphId, graphVersion)`:

- exact match -> `FOUND` plus runtime-decoded `ExecutionGraphDefinition`;
- absent exact identity -> `NOT_FOUND`, even when other versions exist;
- malformed/corrupt persisted definition -> `INTEGRITY_ERROR/GRAPH_DEFINITION_INVALID`;
- returned graph identity MUST exactly match lookup identity.

## 8. Durability

The accepted first durable adapter MUST prove:

- close/reopen preserves definitions;
- concurrent registration of the same previously absent identity cannot create divergent state;
- same canonical content races resolve to one registration plus replay/equivalent success;
- conflicting content races resolve to one immutable winner plus conflict;
- exact lookup remains deterministic after restart.

## 9. Authority boundary

The registry stores immutable graph definitions only.

It MUST NOT:

- mutate `GraphRunState`;
- append authoritative journal operations;
- create execution intents;
- dispatch executors;
- call OMP/tools/network;
- approve gates/policies.

## 10. Acceptance

Phase 9 must encode executable tests before implementation for:

- exact version lookup / no fallback (ORCH-053);
- invalid graph rejection (ORCH-054 at registry boundary);
- first registration;
- canonical replay;
- immutable conflict;
- independent versions;
- restart durability;
- two-connection same-content race;
- two-connection conflicting-content race;
- malformed persisted graph fail-closed;
- no storage/OMP authority leakage.
