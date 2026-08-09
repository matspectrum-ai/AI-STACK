# Durable ExecutionStore Conformance

Status: FAIL-FIRST EXECUTABLE MAPPING
Phase: 7 — SQLite ExecutionStore TDD
Depends on:
- `docs/testing/EXECUTION-ORCHESTRATION.md`
- `docs/contracts/SQLITE-EXECUTION-STORE.md`

## Assigned existing cases

Phase 7 owns executable coverage for:

- ORCH-016..030
- ORCH-041..046
- ORCH-048..049

## Additional recovery/concurrency cases

### ORCH-057 — Concurrent claim race has one winner

Given two independently opened durable stores target the same `PENDING` execution
When both valid workers claim concurrently
Then exactly one returns `CLAIMED`
And exactly one returns `CLAIM_CONFLICT`.

### ORCH-058 — Expired claimed/running work is recoverable

Given non-terminal work has an expired lease
When `listRecoverable(now, limit)` executes
Then the same execution ID is discoverable for reclaim/reconciliation
And no new attempt is created.

### ORCH-059 — Terminal result survives restart

Given a terminal result is committed
When the store closes and reopens
Then status/result remain equivalent and immutable.

## Executable suite partition

- `sqlite-execution-store-projection.red.test.ts`
  - ORCH-016..022
- `sqlite-execution-store-leases.red.test.ts`
  - ORCH-023..030
  - ORCH-057..058
- `sqlite-execution-store-results.red.test.ts`
  - ORCH-041..046
  - ORCH-048..049
  - ORCH-059

## RED criterion

The Phase 7 RED is valid only when:

- accepted domain tests remain GREEN;
- accepted authoritative persistence tests remain GREEN;
- accepted projector tests remain GREEN;
- new ExecutionStore tests fail because the contracted SQLite adapter module is absent;
- strict typecheck fails only for that same missing module or another directly attributable missing implementation symbol.

Test defects or unrelated type errors must be corrected before implementation is authorized.

## GREEN criterion

All existing suites plus all Phase 7 cases and strict typecheck must pass against a real file-backed SQLite adapter.

## Refactor criterion

After first GREEN, persistence schema/configuration, codecs, and state-transition logic may be decomposed for cohesion only if the complete suite remains GREEN.
