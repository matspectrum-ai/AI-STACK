# OMP Execution Registry Contract v1

Status: CONTRACT — PRE-IMPLEMENTATION
Phase: 11 — OMP Executor Contracts
Depends on:
- `contracts/omp-executor.ts`
- `contracts/execution-launch.ts`
- `RFC-004 — OMP ExecutorPort Adapter`

## 1. Purpose

Persist the adapter-owned identity/lifecycle bridge between one stable AI-STACK `ExecutionId` and one OMP-generated session identity/path before model execution begins.

This registry exists specifically to close the crash window:

```text
OMP session/prompt starts
       X process crashes
AI-STACK never persisted executorRef
```

Without a durable mapping, restart reconciliation cannot know which OMP session belonged to the execution.

## 2. Identity

Primary identity is exactly `ExecutionId`.

One execution ID may bind to only one immutable tuple:

- complete `ExecutionLaunchSpec`;
- OMP `sessionId`;
- OMP `sessionFile`.

Rebinding any of these is a conflict.

## 3. Lifecycle

```text
PREPARED
   ↓
ACTIVE
   ├──→ SUCCEEDED
   ├──→ FAILED
   └──→ INTERRUPTED
```

Rules:

- PREPARED means session identity/path + launch spec are durable before prompt activation;
- ACTIVE means the adapter has intentionally activated the logical OMP turn;
- SUCCEEDED/FAILED are immutable terminal phases;
- INTERRUPTED means a previously prepared/active execution lost trustworthy live runtime settlement and must not be blind-restarted.

Terminal phases cannot transition to another phase.

## 4. prepare()

First valid prepare -> `PREPARED`.

Identical prepare replay -> `REPLAYED`.

Same execution ID with different launch spec, session ID, or session file -> `CONFLICT`.

Invalid persisted/current lifecycle -> `INTEGRITY_ERROR`.

Preparation requires:

- valid non-empty session ID;
- absolute non-empty session file path;
- valid timestamp;
- launch spec execution ID equals request execution ID.

## 5. markActive()

Allowed:

- PREPARED -> ACTIVE;
- identical ACTIVE replay -> REPLAYED.

Forbidden:

- terminal -> ACTIVE;
- INTERRUPTED -> ACTIVE without an explicit future recovery contract;
- missing execution -> NOT_FOUND.

`activatedAt` must be valid and not precede `preparedAt`.

## 6. markTerminal()

Allowed:

- ACTIVE -> SUCCEEDED/FAILED;
- identical terminal settlement replay -> REPLAYED.

Result requirements:

- `result.executionId` exactly matches registry execution ID;
- `settledAt` is valid and not earlier than activation;
- SUCCEEDED requires `terminalOutput` validated against the bound launch spec's output schema and matching `schemaRef`;
- FAILED may omit structured output;
- result outcome maps exactly to terminal phase.

Conflicting terminal replay -> CONFLICT.

## 7. markInterrupted()

Allowed when the adapter has durable evidence that PREPARED/ACTIVE cannot be trusted as a currently live execution after runtime/process loss.

Rules:

- non-empty reason;
- valid observed timestamp;
- terminal states cannot become INTERRUPTED;
- repeated identical interruption is idempotent;
- INTERRUPTED remains fail-closed until an explicit recovery contract is introduced.

## 8. get()

Returns exact durable record or NOT_FOUND.

Persisted corruption/invalid lifecycle/identity/output binding -> INTEGRITY_ERROR.

The registry MUST runtime-decode all structured persisted data. `JSON.parse` success alone is insufficient.

## 9. Structured output

For SUCCEEDED:

- registry stores the validated output value and schema ref;
- adapter generates an immutable `ExecutionResult.resultRef` that refers to this durable adapter-owned settlement until a later generic artifact/evidence store ingests it;
- generic graph authority still cannot be mutated by this registry.

This is an interim executor-result storage boundary, not D-007's final evidence-store decision.

## 10. Durability

The accepted first adapter must prove:

- close/reopen mapping durability;
- PREPARED survives restart;
- ACTIVE survives restart as lifecycle metadata but not as proof of live process activity;
- terminal settlement survives restart;
- conflicting concurrent prepare cannot create two OMP session mappings;
- terminal settlement is immutable under concurrent/replayed writes.

## 11. Authority boundary

Registry has no methods for:

- graph commit/journal mutation;
- gate/policy approval;
- ExecutionStore claim/result mutation;
- OMP prompt invocation;
- tool execution.

It is metadata/result durability for the OMP adapter only.

## 12. Initial backend hypothesis

SQLite is the leading local adapter candidate because the registry needs write-once identity, atomic lifecycle updates, concurrent prepare protection, and restart durability beside the existing local OMP runtime.

The backend is not accepted until its own fail-first conformance suite passes.
