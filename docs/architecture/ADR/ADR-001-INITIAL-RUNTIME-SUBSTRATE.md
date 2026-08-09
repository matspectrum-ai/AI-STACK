# ADR-001 — Initial Runtime and Test Substrate

Status: ACCEPTED
Date: 2026-08-09
Accepted: 2026-08-09

## Context

AI-STACK needs an executable contract-test substrate before any control-plane behavior is implemented. The primary execution kernel, OMP / OhMyPI, exposes a native in-process SDK for Node/TypeScript hosts and an RPC mode for cross-language/process-isolated hosts.

The Engineering Graph domain must remain independent from OMP-specific types and transport.

## Decision

Use **TypeScript on Bun** as the initial v1 contract-test and runtime substrate.

Use OMP through an AI-STACK-owned `ExecutorPort`. The first adapter may use the OMP TypeScript SDK in-process. OMP RPC remains the required alternative boundary for future process isolation or non-TypeScript hosts.

The accepted toolchain baseline is pinned in `package.json`; CI setup actions are pinned to immutable commit SHAs.

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

The initial repository test and runtime substrate is Bun + TypeScript.

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

## Acceptance evidence

The acceptance criteria were exercised in Phase 2:

1. `contracts/domain.ts` represents the Phase 1 domain using AI-STACK-owned strict TypeScript contracts and contains no OMP imports.
2. Executable Bun tests were authored against `createGraphKernel(): GraphKernel` before `src/domain/create-graph-kernel.ts` existed.
3. The RED baseline commit `c844d622c1d39c60639f529540e8b9ded77cc8a5` produced failing GitHub Actions run `31295904452` while the contracted implementation module was absent.
4. The initial workflow did not retain enough stdout to prove that the missing module was the *only* failure in that first run. This observability gap was corrected before GREEN and is recorded rather than inferred away.
5. After minimal implementation, diagnostic run `31296053662` proved the behavior tests passed while strict TypeScript still rejected five `ReasonCode` inference errors. The contracts/tests were not weakened; the implementation typing was fixed.
6. GREEN run `31296085464` completed successfully for domain tests, strict typecheck, and enforcement.
7. After cohesion refactoring, run `31296156440` again completed successfully, proving behavior-preserving refactor under the same contract suite.
8. The pure domain implementation remains independent of OMP, persistence, shell execution, network I/O, and UI concerns.

These observations are sufficient to accept TypeScript/Bun as the v1 substrate. They do not accept the OMP adapter design as implemented; that boundary requires its own RED/GREEN cycle.

## Revisit triggers

Reconsider the decision if:

- in-process OMP execution prevents required isolation;
- OMP SDK compatibility is materially unstable;
- deterministic state/policy requirements are materially easier to satisfy in another runtime;
- performance or deployment evidence shows TypeScript/Bun is inadequate;
- RPC becomes mandatory for security boundaries.