# Phase 13 — OMP Adapter State-Machine Conformance

Status: FAIL-FIRST EXECUTABLE MAPPING
Depends on:
- `docs/contracts/OMP-EXECUTOR-ADAPTER.md`
- `docs/contracts/OMP-RUNTIME-BRIDGE.md`
- `docs/testing/OMP-EXECUTOR-CONFORMANCE.md`

## Cases

- OMP-001 launch material missing/invalid/mismatched -> reject before runtime
- OMP-002 durable PREPARED + ACTIVE precede prompt activation
- OMP-003 exact restricted runtime configuration
- OMP-004 STARTED returns while settlement remains pending
- OMP-005 same live ExecutionId -> ALREADY_STARTED, one prompt only
- OMP-006 durable terminal replay after adapter reconstruction
- OMP-007 PREPARED restart path reopens same session and starts same identity
- OMP-008 ACTIVE live -> RUNNING
- OMP-009 orphan ACTIVE after restart -> INTERRUPTED/UNKNOWN, no new prompt
- OMP-010 structured success settlement
- OMP-011 invalid structured success cannot become SUCCEEDED
- OMP-012 unresolved/non-terminal runtime remains RUNNING
- OMP-013 terminal lifecycle without accepted structured output is not success
- OMP-014 runtime/tool-configuration rejection starts nothing
- OMP-015 changed launch binding under same ExecutionId rejected
- OMP-016 session construction failure explicit
- OMP-017 expired deadline starts nothing
- OMP-018 runtime settlement loss fails closed to INTERRUPTED/UNKNOWN
- OMP-019 adapter authority surface is only ExecutorPort
- prompt rejection after ACTIVE -> INTERRUPTED + REJECTED
- relative session root rejected at construction

## RED criterion

All accepted domain/persistence/orchestration/Phase 12 behavior remains green. New Phase 13 tests/typecheck fail only because:

`src/executors/omp/create-omp-executor-adapter.ts`

does not exist.

Independent test/contract defects are corrected before implementation.

## GREEN criterion

All existing suites plus Phase 13 pass against:

- real durable SQLite `OmpExecutionRegistry`;
- pure accepted launch validator;
- fake launch resolver;
- deterministic injected fake OMP runtime bridge.

No `@oh-my-pi/pi-coding-agent` package/runtime is added.

## Refactor criterion

After first GREEN, runtime-config mapping, executor-reference/result-reference derivation, and asynchronous settlement handling may be extracted for cohesion only while the full suite stays green.

## Decision gate

Phase 13 may accept the adapter state-machine design itself, but MUST NOT accept D-010 or D-016. Real OMP behavior remains Phase 14's responsibility.
