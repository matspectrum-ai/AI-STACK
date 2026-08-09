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

The returned `GraphKernel` is authoritative only for the behaviors explicitly defined by the domain contracts. It MUST NOT:

- execute agent work;
- execute shell commands;
- perform network I/O;
- persist state directly;
- infer approvals/evidence from unstructured prose.

Persistence, execution, clock, and adapter concerns are inputs or ports outside the pure domain decision surface.

## Initial methods

The Phase 2 RED suite targets the methods currently declared by `GraphKernel`:

- `validateGraph`
- `evaluateTransition`
- `validateArtifactLineage`
- `validateRetryPolicy`

If a Phase 2 test cannot be expressed through those methods without ambiguity, the contract MUST be expanded before that test is encoded. Tests MUST NOT invent hidden methods.

## Failure contract

Domain validation failures MUST be returned as typed outcomes/reason codes defined by contracts. Expected domain invalidity MUST NOT be represented by arbitrary uncaught exceptions.

Programming errors or violated internal invariants may throw, but they are not substitutes for contract-defined `DENY`, `PAUSE`, validation reason codes, or validation results.
