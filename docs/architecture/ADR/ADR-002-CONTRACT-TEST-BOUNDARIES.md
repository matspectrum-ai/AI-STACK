# ADR-002 — Contract Test Ownership Boundaries

Status: ACCEPTED
Date: 2026-08-09

## Context

Phase 1 defined DOMAIN-001..047 as system-level acceptance behaviors. During conversion to executable tests, several cases were found to depend on contracts that Phase 1 intentionally left open, including persistence/reconstruction format, evidence payload integrity algorithm, and executor/tool adapters.

Forcing all 47 cases through `GraphKernel` would create hidden responsibilities and prematurely couple the pure domain kernel to persistence and adapter concerns.

## Decision

Partition the system-level acceptance cases by authoritative owner. A component may be implemented only after the tests for behaviors owned by that component exist and have been observed RED.

No component may implement behavior owned by another boundary merely to make a test pass.

## Ownership classes

### A. Pure domain kernel

Owned by `GraphKernel` and executable without I/O.

Initial cases:

- DOMAIN-001 specification gate
- DOMAIN-002 contract gate
- DOMAIN-003 RED evidence gate
- DOMAIN-004 invalid RED evidence status prevents gate pass
- DOMAIN-005 verification evidence gate
- DOMAIN-006 self-approval prohibition when bound to transition evaluation
- DOMAIN-007 approval scope binding when bound to transition evaluation
- DOMAIN-008 approval expiry when `now` is supplied explicitly
- DOMAIN-012 stale revision rejection
- DOMAIN-015 denied transition state safety
- DOMAIN-016 paused transition is not success
- DOMAIN-019 lineage cycle rejection
- DOMAIN-021 unverified evidence cannot satisfy a gate
- DOMAIN-022 invalid evidence cannot satisfy a gate
- DOMAIN-023 expired evidence cannot satisfy freshness-constrained gate when status is authoritative input
- DOMAIN-025 non-retryable failure cannot auto-retry
- DOMAIN-026 retry budget enforcement
- DOMAIN-028 explicit retry exhaustion edge
- DOMAIN-029 edge endpoint integrity
- DOMAIN-030 immutable graph-definition version at activation boundary
- DOMAIN-031 edge existence is not authorization
- DOMAIN-032 indeterminate gate blocks transition
- DOMAIN-033 indeterminate policy blocks transition
- DOMAIN-034 deterministic gate/transition result for identical authoritative inputs
- DOMAIN-035 agent narrative is non-authoritative
- DOMAIN-036 identifier uniqueness
- DOMAIN-037 identifier opacity
- DOMAIN-038 non-entry executable node requires inbound edge
- DOMAIN-039 graph-version attribution
- DOMAIN-040 one decision value per evaluation call
- DOMAIN-041 pure gate/transition evaluation does not mutate supplied inputs
- DOMAIN-042 policy-version attribution
- DOMAIN-043 capability does not equal authority when represented by policy input
- DOMAIN-045 retry policy bounds
- DOMAIN-046 unknown mandatory input fails closed
- DOMAIN-047 invalid output contract cannot authorize downstream transition once output-validation evidence is modeled

### B. State persistence / concurrency adapter

Requires a separate persistence contract and test suite before implementation.

- DOMAIN-013 deterministic resume
- DOMAIN-014 malformed persisted state fails closed
- DOMAIN-027 retry accounting persisted before activation
- durable association between transition decision and committed state revision

DOMAIN-012 remains kernel-testable because stale revision comparison is part of transition eligibility; persistence atomicity is adapter-owned.

### C. Artifact/evidence integrity service

Requires a concrete digest and payload-verification contract before implementation.

- DOMAIN-017 artifact version immutability across stored revisions
- DOMAIN-018 producer execution referential integrity when persistence catalog is authoritative
- DOMAIN-020 persisted requirement-to-code lineage traversal
- DOMAIN-024 payload mutation invalidates digest binding

The kernel may validate lineage relationships supplied in-memory, but durable referential integrity is storage-owned.

### D. Executor/tool adapter

Requires `ExecutorPort` and permission-boundary contracts before implementation.

- DOMAIN-009 unstructured agent output is never implicit shell execution
- DOMAIN-010 explicit tool invocation still requires policy
- DOMAIN-011 privileged action approval path

The kernel may return policy/approval decisions, but actual prevention of tool execution is adapter-owned.

### E. Failure persistence / orchestration

Requires orchestration-state contracts before implementation.

- DOMAIN-044 FailureRecord persisted before retry/recovery activation

The kernel can classify retry eligibility; durable sequencing is orchestration/persistence-owned.

## TDD rule after decomposition

The rule is component-scoped and strict:

```text
SPEC(component behavior)
  -> CONTRACT(component boundary)
  -> EXECUTABLE TESTS
  -> OBSERVED RED
  -> IMPLEMENT ONLY THAT COMPONENT BEHAVIOR
  -> GREEN
  -> REFACTOR
```

System-level acceptance remains authoritative across boundaries, but unresolved adapter contracts do not justify bloating `GraphKernel`.

## Consequences

- Phase 2 begins with the pure domain-kernel RED suite.
- Persistence, evidence-integrity, and OMP/tool adapters remain implementation-blocked.
- `DOMAIN-CONTRACT-COVERAGE.md` remains a system acceptance index, not a claim that one class owns every behavior.
- ADR-001 may be accepted after the Bun/TypeScript pure-domain RED suite is demonstrated.

## Rejected alternative

### Put every behavior on GraphKernel

Rejected because it would mix pure decision logic, I/O, cryptographic integrity, agent execution, and persistence atomicity behind one interface, reducing cohesion and making deterministic testing harder.