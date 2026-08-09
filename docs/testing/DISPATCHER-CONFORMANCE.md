# Generic Dispatcher Conformance

Status: FAIL-FIRST EXECUTABLE MAPPING
Phase: 8 — Generic Dispatcher TDD
Depends on:
- `docs/testing/EXECUTION-ORCHESTRATION.md`
- `docs/contracts/EXECUTION-DISPATCHER.md`

## Assigned cases

Phase 8 owns executable coverage for:

- ORCH-031..040
- ORCH-050..052
- ORCH-055

The suite also verifies explicit `REJECTED` and `UNKNOWN` behavior needed to make the generic contract total enough for implementation.

## Suite partition

- `dispatcher-dispatch.red.test.ts`
  - durable intent/claim ordering
  - stable start request identity and bindings
  - STARTED / ALREADY_STARTED / ALREADY_COMPLETED
  - uncertain start → same-ID reconciliation
  - NOT_FOUND retry with the same ID/attempt
  - explicit REJECTED handling

- `dispatcher-recovery.red.test.ts`
  - RUNNING and terminal reconciliation
  - expired-lease restart recovery
  - durable terminal application gap
  - UNKNOWN outcome handling
  - generic ExecutorPort authority surface

## RED criterion

The Phase 8 RED is valid only when:

- domain tests remain GREEN;
- authoritative persistence tests remain GREEN;
- projector and durable ExecutionStore tests remain GREEN;
- new dispatcher tests fail because `create-execution-dispatcher.ts` is absent;
- strict typecheck fails only for the same missing implementation symbol or another directly attributable missing dispatcher implementation symbol.

Any independent fixture/type defect must be corrected before dispatcher implementation is authorized.

## GREEN criterion

All accepted suites plus dispatcher cases and strict typecheck pass with the generic fake executor. No OMP package or OMP type is introduced.

## Refactor criterion

After first GREEN, claim acquisition, executor request mapping, and status reconciliation may be decomposed for cohesion only if the full suite remains GREEN.

## Non-goals

Phase 8 does not implement:

- executor selection/routing;
- graph registry persistence;
- OMP adapter;
- graph application transition after terminal result;
- evidence/artifact production from executor results.
