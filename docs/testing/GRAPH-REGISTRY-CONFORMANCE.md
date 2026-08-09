# GraphDefinitionRegistry Conformance

Status: FAIL-FIRST EXECUTABLE MAPPING
Phase: 9 — Graph Registry TDD
Depends on:
- `docs/contracts/GRAPH-DEFINITION-REGISTRY.md`

## Cases

- REG-001 first valid registration + exact retrieval
- ORCH-053 exact-version lookup with no fallback
- ORCH-054 / REG-002 invalid graph rejected before persistence
- REG-003 canonical reorder replay
- REG-004 immutable same-identity conflict
- REG-005 independent versions coexist
- REG-006 close/reopen durability
- REG-007 two-connection equivalent registration race
- REG-008 two-connection conflicting registration race
- REG-009 corrupted persisted graph fails closed
- REG-010 public registry exposes no graph-run/executor mutation methods

## RED criterion

RED is valid only when all previously accepted suites remain green and the registry test/typecheck failures are caused by the contracted SQLite registry module being absent.

## GREEN criterion

All suites plus strict typecheck pass against a real file-backed registry implementation.

## Refactor criterion

After first GREEN, canonicalization, runtime decoding, and SQLite schema/configuration may be separated for cohesion only while the complete suite remains green.
