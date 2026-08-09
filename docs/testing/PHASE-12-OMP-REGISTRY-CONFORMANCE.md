# Phase 12 — Launch Validation + OMP Registry Conformance

Status: FAIL-FIRST EXECUTABLE MAPPING
Depends on:
- `docs/contracts/EXECUTION-LAUNCH-SPEC.md`
- `docs/contracts/OMP-EXECUTION-REGISTRY.md`
- `docs/contracts/SQLITE-OMP-EXECUTION-REGISTRY.md`
- `docs/testing/OMP-EXECUTOR-CONFORMANCE.md`

## Executable cases

Launch validation:

- LAUNCH-001 exact execution identity
- LAUNCH-002 exact provenance bindings
- LAUNCH-003 explicit absolute normalized workspace
- LAUNCH-004 materialized non-empty instruction
- LAUNCH-005 explicit model/reasoning profile
- LAUNCH-006 fail-closed unique tool allowlist
- LAUNCH-007 structured output contract
- LAUNCH-008 finite positive deadline

Registry:

- OMPREG-001 first prepare
- OMPREG-002 identical prepare replay
- OMPREG-003 immutable mapping conflict
- OMPREG-004 PREPARED -> ACTIVE + replay
- OMPREG-005 success requires bound structured output
- OMPREG-006 failure may settle without structured output
- OMPREG-007 terminal immutability
- OMPREG-008 interruption lifecycle
- OMPREG-009 restart durability
- OMPREG-010 concurrent divergent prepare race
- OMPREG-010b concurrent identical prepare replay
- OMPREG-011 corruption fail-closed
- OMPREG-012 authority isolation
- invalid identity/session path/timestamp rejection

## RED criterion

The RED is valid only when all previously accepted domain/persistence/orchestration behavior remains green and the new Phase 12 tests/typecheck fail because these contracted modules do not yet exist:

- `src/executors/launch/create-execution-launch-spec-validator.ts`
- `src/executors/omp/registry/sqlite/create-sqlite-omp-execution-registry.ts`

Independent fixture/type errors must be corrected before implementation is authorized.

## GREEN criterion

All existing suites plus all Phase 12 cases and strict typecheck pass without adding the OMP package/runtime dependency.

## Refactor criterion

After first GREEN:

- runtime codecs/schema/configuration may be separated for cohesion;
- Phase 12 tests may receive a dedicated CI step;
- full suite must remain green.

## Decision gate

Only after post-refactor GREEN may:

- D-021 ExecutionLaunchSpec boundary move to ACCEPTED;
- D-022 durable OMP execution registry move to ACCEPTED;
- ADR-006 SQLite OMP registry move to ACCEPTED.

D-010 and D-016 remain PROPOSED until Phase 14 real OMP SDK conformance.
