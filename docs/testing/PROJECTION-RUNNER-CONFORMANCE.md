# Projection Runner Conformance

Status: FAIL-FIRST EXECUTABLE MAPPING
Phase: 10 — Projection Runner TDD
Depends on:
- `docs/contracts/PROJECTION-RUNNER.md`

## Cases

- RUN-001 unknown run -> RUN_NOT_FOUND
- RUN-002 sequence 0 + transition -> durable checkpoint/intents
- RUN-003 bounded batch progression
- RUN-004 repeated invocation idempotency
- RUN-005 missing exact graph blocks without checkpoint advance
- RUN-006 corrupt exact graph blocks fail-closed
- RUN-007 process restart resumes from durable checkpoint
- RUN-008 two-runner race cannot duplicate intent
- RUN-009 non-contiguous journal result fails closed
- RUN-010 authoritative integrity error propagation
- RUN-011 invalid batch configuration rejection
- ORCH-047 read-only graph-authority boundary
- ORCH-056 no OMP dependency in generic orchestration contracts/runtime

## RED criterion

All previously accepted suites remain green. New runner tests and strict typecheck fail only because `src/orchestration/runner/create-projection-runner.ts` is absent, after correcting any independent test defects.

## GREEN criterion

All suites and strict typecheck pass using real file-backed authoritative, graph-registry, and execution-store adapters. No executor/OMP participates.

## Refactor criterion

After first GREEN, journal sequencing, per-entry projection, and result mapping may be separated for cohesion only while the full suite remains green.

## D-015 acceptance criterion

Phase 10 may move D-015 to ACCEPTED only if the complete journal-to-durable-intent path is green and ORCH-047/056 are executable and passing.
