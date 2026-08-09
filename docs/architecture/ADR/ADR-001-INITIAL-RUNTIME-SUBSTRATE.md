# ADR-001 — Initial Runtime and Test Substrate

Status: PROPOSED
Date: 2026-08-09

## Context

AI-STACK needs an executable contract-test substrate before any control-plane behavior is implemented. The primary execution kernel, OMP / OhMyPI, exposes a native in-process SDK for Node/TypeScript hosts and an RPC mode for cross-language/process-isolated hosts.

The Engineering Graph domain must remain independent from OMP-specific types and transport.

## Decision

Use **TypeScript on Bun** as the initial v1 contract-test and runtime substrate, subject to the Phase 1 RED test proving the harness can be bootstrapped without violating domain boundaries.

Use OMP through an AI-STACK-owned `ExecutorPort`. The first adapter may use the OMP TypeScript SDK in-process. OMP RPC remains the required alternative boundary for future process isolation or non-TypeScript hosts.

## Scope of decision

This ADR selects the initial implementation substrate only. It does not permit OMP types to leak into the domain model and does not prohibit a future Rust, Go, or other adapter/runtime if evidence justifies migration.

## Options considered

### A. TypeScript + Bun + OMP SDK

Advantages:

- lowest impedance to OMP's documented native SDK;
- preserves upstream TypeScript types;
- OMP itself uses Bun in its development workflow;
- simple test bootstrap with Bun's test runner;
- minimizes adapter surface during v1.

Risks:

- in-process integration gives weaker fault isolation than RPC;
- JavaScript runtime must not become the source of implicit dynamic contracts;
- domain invariants require strict runtime validation in addition to TypeScript compile-time types.

### B. Rust + OMP RPC

Advantages:

- strong static modeling and explicit error handling;
- process boundary from OMP;
- suitable for a hardened control plane.

Costs:

- larger initial adapter/protocol surface;
- duplicates types across RPC boundary;
- increases time before first executable graph-contract tests.

### C. Go + OMP RPC

Advantages:

- simple deployment model;
- explicit concurrency primitives;
- process isolation from OMP.

Costs:

- same RPC translation burden as Rust;
- no direct use of OMP SDK types;
- weaker justification than TypeScript for initial v1 integration.

## Architectural constraints

Regardless of substrate:

1. `domain` MUST NOT import OMP packages.
2. OMP access MUST occur through an adapter implementing AI-STACK contracts.
3. authoritative state transitions MUST remain deterministic and AI-STACK-owned.
4. unstructured OMP output MUST remain non-authoritative.
5. runtime validation MUST exist at trust boundaries; TypeScript types alone are insufficient.
6. persistence and evidence formats MUST not depend on OMP session serialization.

## Consequences

The initial repository test bootstrap should target Bun and TypeScript.

Expected dependency direction:

```text
contracts/domain
      ^
      |
domain kernel
      ^
      |
ExecutorPort
      ^
      |
OmpSdkExecutorAdapter ---> @oh-my-pi/pi-coding-agent
```

Forbidden dependency:

```text
domain kernel ---> @oh-my-pi/pi-coding-agent
```

## Acceptance criteria

ADR-001 may move to ACCEPTED when:

- contract-only TypeScript types can represent Phase 1 domain entities without OMP imports;
- executable tests can be authored against those contracts;
- the first test run is RED because domain behavior is absent, not because the specification is ambiguous;
- Bun/TypeScript does not force a violation of the Engineering Graph contracts.

## Revisit triggers

Reconsider the decision if:

- in-process OMP execution prevents required isolation;
- OMP SDK compatibility is materially unstable;
- deterministic state/policy requirements are materially easier to satisfy in another runtime;
- performance or deployment evidence shows TypeScript/Bun is inadequate;
- RPC becomes mandatory for security boundaries.