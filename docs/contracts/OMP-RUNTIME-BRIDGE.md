# OMP Runtime Bridge Contract v1

Status: CONTRACT FOR PHASE 13 RED TESTS
Phase: 13 — OMP Adapter State Machine TDD
Depends on:
- `contracts/omp-runtime.ts`
- `RFC-004 — OMP ExecutorPort Adapter`

## 1. Purpose

Separate AI-STACK's adapter state machine from the concrete `@oh-my-pi/pi-coding-agent` SDK so lifecycle/ordering can be proven deterministically before real-SDK conformance.

Phase 13 uses a fake runtime implementation. Phase 14 supplies the real bridge.

## 2. Session preparation versus prompt activation

The bridge intentionally separates:

```text
prepareSession(config)
        ↓ no model/prompt execution
registry PREPARED
        ↓
registry ACTIVE
        ↓
startPrompt(executionId, instruction)
```

`prepareSession()` may create/open filesystem/session metadata but MUST NOT run the task prompt.

This ordering ensures AI-STACK has durable OMP session identity before any task side effect can begin.

## 3. Prepared session identity

`prepareSession()` returns:

- OMP session ID;
- OMP session file;
- executor reference.

For v1 the executor reference MUST be deterministically reconstructible from the durable OMP session ID. A real bridge that returns an unrelated process-local reference cannot conform because terminal/restart status must be reported after adapter reconstruction.

## 4. Runtime configuration

Phase 13 requires exact mapping from `ExecutionLaunchSpec` to:

- explicit session directory;
- cwd;
- additional directories;
- model selector;
- reasoning profile;
- exact tool-name allowlist;
- `restrictToolNames = true`;
- output schema ref/schema;
- strict output mode;
- required yield tool;
- absolute deadline.

The fake bridge records this config. Phase 14 proves the actual OMP SDK mapping.

## 5. openPreparedSession()

Used when PREPARED metadata survived but process-local runtime state did not.

It receives the exact durable session ID/file and exact launch-derived configuration.

It MUST NOT start the prompt.

## 6. startPrompt()

Starts only an already-prepared/opened logical session.

It returns promptly with either:

- REJECTED; or
- STARTED plus a settlement promise.

The settlement promise is process-local; durable terminal authority is the `OmpExecutionRegistry` after the adapter records settlement.

## 7. isLive()

Reports process-local live runtime state only.

It is never a durability authority.

An ACTIVE durable registry record with `isLive() == false` after adapter reconstruction is treated as interrupted/UNKNOWN rather than proof that the task never started.

## 8. Settlement

Runtime settlement is one of:

- SUCCEEDED with schema-valid structured output;
- FAILED with explicit error code and optional structured output;
- INTERRUPTED with explicit reason.

Phase 13 trusts the fake bridge contract that SUCCEEDED output values were schema validated; it still verifies schema binding. Phase 14 must prove real OMP structured-validation semantics.

## 9. Prohibited authority

The bridge has no methods for:

- graph commit/journal mutation;
- gates/policies/approvals;
- generic ExecutionStore mutation;
- artifact/evidence authority.

It only translates prepared AI-STACK execution material into OMP runtime behavior.
