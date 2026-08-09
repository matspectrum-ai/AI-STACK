# OMP ExecutorPort Adapter State Machine v1

Status: CONTRACT FOR PHASE 13 RED TESTS
Phase: 13 — Fake Runtime Adapter TDD
Depends on:
- `RFC-004 — OMP ExecutorPort Adapter`
- `contracts/omp-runtime.ts`
- accepted D-021 / D-022

## 1. Scope

Implement `ExecutorPort` behavior against an injected `OmpRuntimeBridge` and the accepted durable OMP execution registry.

This phase proves AI-STACK adapter logic only. It does not claim the fake runtime matches real OMP; that is Phase 14.

## 2. Constructor

Production path:

`src/executors/omp/create-omp-executor-adapter.ts`

The constructor requires:

- launch resolver;
- launch validator;
- OMP execution registry;
- OMP runtime bridge;
- deterministic clock;
- absolute normalized adapter-owned session root.

Invalid session root fails construction.

## 3. Executor reference

The v1 executor reference is deterministic from durable OMP session identity:

```text
omp:<sessionId>
```

The runtime bridge must return the same reference during prepare/open. A mismatch rejects activation.

This allows restart status to reconstruct the executor reference without process-local state.

## 4. start() — materialization

Every start first resolves and validates `ExecutionLaunchSpec` against the exact `ExecutorStartRequest`.

- resolver NOT_FOUND -> REJECTED `OMP_LAUNCH_SPEC_NOT_FOUND`;
- resolver INVALID -> REJECTED with explicit launch error;
- validator INVALID -> REJECTED;
- already-expired deadline -> REJECTED `OMP_DEADLINE_EXPIRED`;
- no runtime/session side effect occurs on these paths.

## 5. start() — existing durable record

The resolved launch spec must equal the durable record's bound spec. A changed binding is `OMP_LAUNCH_BINDING_CONFLICT` and nothing starts.

### SUCCEEDED / FAILED

Return `ALREADY_COMPLETED` with reconstructed executor ref and immutable terminal result.

### ACTIVE + live runtime

Return `ALREADY_STARTED`; do not invoke another prompt.

### ACTIVE + no live runtime

Fail closed: mark INTERRUPTED and return `ALREADY_STARTED` for the historically known external identity. Subsequent `getStatus()` returns UNKNOWN. No prompt is invoked.

### INTERRUPTED

Return `ALREADY_STARTED` with the known executor ref; no prompt is invoked. `getStatus()` returns UNKNOWN.

### PREPARED

Open the exact durable OMP session through the runtime bridge, verify executor-ref identity, persist ACTIVE, then invoke the prompt once.

## 6. start() — new execution

Order is mandatory:

1. derive exact runtime configuration/session directory;
2. runtime `prepareSession()` — creates session identity only, no prompt;
3. validate returned session ID/file/executor ref;
4. durable registry `prepare()`;
5. durable registry `markActive()`;
6. runtime `startPrompt()`;
7. attach asynchronous settlement handler;
8. return STARTED immediately.

Prompt invocation before durable PREPARED+ACTIVE is a contract violation.

If runtime prompt start is rejected/throws after ACTIVE, mark the durable record INTERRUPTED and return REJECTED. Do not silently reset to PREPARED.

## 7. Exact runtime configuration

From launch spec:

- execution ID;
- derived session directory under configured root;
- cwd/additional directories;
- model selector/reasoning profile;
- exact tool names;
- `restrictToolNames = true`;
- output schema ref/schema;
- `outputSchemaMode = strict`;
- `requireYieldTool = true`;
- exact deadline.

The adapter never adds ambient tools or extends the deadline.

## 8. Asynchronous settlement

STARTED returns before settlement.

A background handler records:

### SUCCEEDED

Create immutable generic `ExecutionResult(outcome=SUCCEEDED)` and persist terminal output/result.

If structured output binding is invalid or registry rejects terminal success, fail closed to INTERRUPTED when possible. Never report SUCCEEDED from prose or invalid output.

### FAILED

Persist generic FAILED result with error code and optional structured output.

### INTERRUPTED

Persist INTERRUPTED with reason; no generic terminal result is manufactured.

### settlement promise rejection

Persist INTERRUPTED with an explicit runtime-loss reason.

## 9. getStatus()

Registry NOT_FOUND -> NOT_FOUND.
Registry corruption -> UNKNOWN.
PREPARED -> NOT_FOUND (safe same-ID start retry).
ACTIVE + runtime live -> RUNNING.
ACTIVE + runtime not live -> persist INTERRUPTED, return UNKNOWN.
INTERRUPTED -> UNKNOWN.
SUCCEEDED / FAILED -> exact terminal status/result plus reconstructed executor ref.

## 10. Result reference

Until D-007 final evidence storage, v1 adapter may use a deterministic adapter-owned result reference:

```text
omp-result:<percent-encoded ExecutionId>
```

The actual validated structured output remains durably bound in `OmpExecutionRegistry`.

## 11. Authority

The adapter implements only:

- `start()`;
- `getStatus()`.

It receives no graph authority, gate/policy APIs, generic ExecutionStore mutation, or tool execution API.

## 12. Phase 13 acceptance

Phase 13 proves OMP-001..019 against a deterministic fake runtime and real durable registry.

D-010/D-016 remain PROPOSED after Phase 13. Only real SDK conformance in Phase 14 may accept them.
