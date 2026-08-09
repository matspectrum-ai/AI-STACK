# Domain Public API v1

Status: CONTRACT
Depends on:
- `docs/architecture/ENGINEERING-GRAPH.md`
- `docs/contracts/ENGINEERING-GRAPH-CONTRACTS.md`
- `contracts/domain.ts`

## Purpose

Define the smallest executable public boundary required by the Phase 2 RED suite without prescribing implementation internals.

## Package boundary

The domain kernel MUST expose one construction function from:

`src/domain/create-graph-kernel.ts`

Contract:

```ts
createGraphKernel(): GraphKernel
```

where `GraphKernel` is the interface defined in `contracts/domain.ts`.

## Dependency rule

`src/domain/**` MUST NOT import:

- `@oh-my-pi/pi-coding-agent`
- OMP RPC types
- application adapters
- persistence adapters
- UI code

The domain kernel may depend only on AI-STACK-owned domain contracts and pure validation utilities.

## Behavioral authority

The returned `GraphKernel` is authoritative only for pure domain decisions explicitly defined by the contracts. It MUST NOT:

- execute agent work;
- execute shell commands;
- perform network I/O;
- persist state directly;
- infer approvals/evidence from unstructured prose;
- verify raw evidence payload digests;
- reconstruct persisted runs.

Persistence, execution, payload integrity, clocks, and adapters remain outside the pure domain decision surface. Time-dependent gate evaluation receives `now` explicitly as input.

## Initial methods

The Phase 2 pure-domain RED suite targets:

- `validateGraph`
- `validateGraphReplacement`
- `evaluateGate`
- `evaluateTransition`
- `validateArtifactLineage`
- `validateRetryPolicy`
- `evaluateRetry`

Tests MUST NOT invent hidden methods. New behavior requires contract expansion before its test is encoded.

## Gate contract

`GateDefinition` is a closed discriminated union in v1. The initial supported gate types are:

- `artifact_present`
- `evidence_valid`
- `approval_present`

Unknown gate types are not part of the v1 public contract.

Gate evaluation MUST be pure: supplied graph state, artifacts, evidence, and approvals are read-only inputs. The returned `GateResult` identifies bound artifacts/evidence/approvals so transition decisions can remain traceable.

## Transition contract

`evaluateTransition` consumes already-evaluated `GateResult[]` and `PolicyResult[]` plus authoritative graph/state/artifact inputs.

This separation is deliberate:

```text
Gate evaluator -----> GateResult ----┐
                                     |
Policy engine -----> PolicyResult ---+--> Transition evaluator
                                     |
Graph/state/artifacts ---------------┘
```

The transition evaluator MUST NOT execute policy rule code or agent logic. It validates edge eligibility, required artifact presence, mandatory gate/policy outcomes, stale-state protection, and decision attribution.

Missing required gate or policy results MUST fail closed.

## Retry contract

`evaluateRetry` is a pure eligibility decision. It does not schedule work or persist counters.

Persistence of retry accounting before activation belongs to the orchestration/state boundary defined by ADR-002.

## Failure contract

Domain validation failures MUST be returned as typed outcomes/reason codes defined by contracts. Expected domain invalidity MUST NOT be represented by arbitrary uncaught exceptions.

Programming errors or violated internal invariants may throw, but they are not substitutes for contract-defined `DENY`, `PAUSE`, validation reason codes, gate outcomes, or retry decisions.
