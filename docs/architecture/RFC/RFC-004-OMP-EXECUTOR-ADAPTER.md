# RFC-004 — OMP ExecutorPort Adapter

Status: DRAFT
Date: 2026-08-09
Phase: 11 — OMP Executor Contracts
Decisions targeted:
- D-010 — OMP integration boundary
- D-016 — stable-identity real-executor delivery
Depends on:
- accepted D-015 journal-as-outbox orchestration
- accepted D-020 generic durable dispatcher
- `contracts/execution.ts`
- `contracts/execution-launch.ts`
- `contracts/omp-executor.ts`
- `docs/research/OMP-EXECUTOR-CONFORMANCE.md`

## 1. Problem

AI-STACK now has a proven generic durable orchestration path ending at `ExecutorPort`, but OMP is not yet a conforming executor.

A correct OMP adapter must solve four independent problems:

1. materialize enough application input to execute a coding agent without hidden defaults;
2. bind stable AI-STACK `ExecutionId` to OMP-generated durable session identity;
3. turn OMP's in-process session runtime into safe `start/getStatus` semantics across host-process restart;
4. produce schema-validated terminal results rather than inferring success from free-form text.

## 2. Verified OMP facts

Primary-source research establishes:

- OMP SDK is in-process;
- `SessionManager` supports file-backed create/open and append-only session history;
- caller may choose `cwd` and session directory while OMP generates native session ID/file name;
- completed session entries are software-crash durable, while in-flight streaming content is not durable until message completion;
- `AgentSession.prompt()` does not return AI-STACK's structured terminal result;
- `agent_end` has an OMP-specific `isTerminal?` refinement because not every apparent end means final settlement;
- active abort/streaming/subagent registry state is process-local;
- `CreateAgentSessionOptions` exposes `toolNames` plus `restrictToolNames` for explicit tool restriction;
- restricted sessions suppress ambient capability expansion including inherited/discovered MCP behavior;
- SDK options expose `outputSchema`, `outputSchemaMode`, and `requireYieldTool`, with upstream comments/design centered on structured subagent completion;
- OMP's task subsystem demonstrates strict schema-validation/yield patterns, but top-level adapter conformance still requires executable proof.

## 3. Proposed architecture

```text
AI-STACK Dispatcher
       ↓ ExecutorPort
OmpExecutorAdapter
       ├── ExecutionLaunchSpecResolver
       ├── OmpExecutionRegistry   (durable)
       └── live AgentSession map  (process-local only)
                  ↓
          SessionManager
                  ↓
          createAgentSession
                  ↓
                OMP
```

No OMP type crosses into generic AI-STACK orchestration contracts.

## 4. ExecutionLaunchSpec

The adapter MUST resolve the immutable launch spec before creating/starting an OMP turn.

It MUST fail without launching when:

- spec is absent;
- identity/provenance differs from `ExecutorStartRequest`;
- workspace is invalid;
- model/reasoning selection is invalid;
- tool allowlist is invalid/un enforceable;
- output schema is invalid;
- deadline is invalid/expired.

The adapter does not perform hidden artifact/evidence discovery.

## 5. OMP session creation

For a previously unseen execution:

1. resolve and validate `ExecutionLaunchSpec`;
2. create an execution-specific session directory under an adapter-owned root;
3. call `SessionManager.create(spec.workspace.cwd, sessionDir)`;
4. ensure the session has a stable file path/on-disk identity before model execution;
5. durably call `OmpExecutionRegistry.prepare()` with exact launch spec + generated OMP session ID/file;
6. only after PREPARED is durable may the agent turn be started.

This ordering closes the crash window in which OMP could start but AI-STACK would have no way to rediscover which OMP session belonged to the `ExecutionId`.

## 6. OMP session configuration

Candidate v1 mapping (must be proven before acceptance):

```text
launch.workspace.cwd            -> createAgentSession.cwd / SessionManager cwd
launch.workspace.additionalDirs -> createAgentSession.additionalDirectories
launch.model.selector            -> explicit model/modelPattern resolution
launch.model.reasoningProfile    -> thinkingLevel mapping
launch.tools.toolNames           -> toolNames
ALLOWLIST                        -> restrictToolNames = true
structured output schema         -> outputSchema
strict validation                -> outputSchemaMode = "strict"
structured completion            -> requireYieldTool = true
deadlineEpochMs                  -> createAgentSession.deadline
```

Restricted sessions MUST NOT silently add ambient discovered tools/MCP capabilities.

If the SDK cannot enforce a requested capability profile, launch is rejected.

## 7. Async start semantics

Generic `ExecutorPort.start()` must return promptly; it must not block for an entire potentially long coding turn.

The proposed adapter:

1. opens/creates the prepared OMP session;
2. installs event/result capture;
3. marks adapter record ACTIVE;
4. starts `AgentSession.prompt()` as an in-process asynchronous task;
5. stores the live task/session in a process-local map keyed by `ExecutionId`;
6. returns `STARTED` with an opaque executor reference derived from the prepared OMP session identity.

The background task is responsible for durable terminal settlement in `OmpExecutionRegistry`.

The process-local map is an optimization/observability surface only and is never a durability authority.

## 8. Start replay semantics

`start(request)` first checks `OmpExecutionRegistry`.

### No record

Prepare and start as described above.

### PREPARED

If launch binding is identical and no active runtime exists, the same prepared OMP session may be opened and launched. No new session/ExecutionId is created.

### ACTIVE with live runtime

Return `ALREADY_STARTED` using the same executor reference.

### ACTIVE without live runtime

This indicates host-process restart or runtime loss. The adapter MUST NOT automatically start another prompt. Return an already-known/external identity state such that subsequent `getStatus` resolves to `UNKNOWN`/interrupted until an explicit recovery policy acts.

### SUCCEEDED / FAILED

Return `ALREADY_COMPLETED` with the immutable terminal `ExecutionResult`.

### INTERRUPTED

Do not blind-restart. The default status is `UNKNOWN` until explicit same-session recovery/failure handling is requested by a future control contract.

## 9. getStatus semantics

### Registry NOT_FOUND

Return `NOT_FOUND`.

### PREPARED

If no prompt has been accepted/activated, return `NOT_FOUND` so generic orchestration may retry `start()` with the same `ExecutionId` and prepared session.

### ACTIVE + live task/session

Return `RUNNING`.

### ACTIVE + no live task after adapter restart

Inspect durable session metadata/history only for integrity/recovery evidence; do not infer successful completion from partial transcript.

Unless a valid terminal structured payload was durably settled, mark/return interrupted `UNKNOWN`.

### INTERRUPTED

Return `UNKNOWN`.

### SUCCEEDED / FAILED

Return exact terminal result.

## 10. Crash-mid-turn rule

OMP is not treated as a durable remote job.

If the adapter process dies while the OMP turn is active:

- the live model/tool execution is lost with the process;
- the file-backed OMP session may preserve completed messages/tool results up to the last durable append;
- streaming tail may be absent;
- OMP session identity remains recoverable from `OmpExecutionRegistry`;
- AI-STACK MUST NOT create a new execution attempt/session automatically;
- the execution becomes `UNKNOWN/INTERRUPTED` until an explicit same-session recovery strategy settles it.

This is a fail-closed correctness choice.

## 11. Structured completion protocol

Successful AI-STACK execution requires a schema-valid terminal payload.

Candidate OMP v1 protocol:

- configure launch JSON Schema through SDK `outputSchema`;
- use strict schema mode;
- require OMP yield/structured completion primitive;
- listen for terminal agent lifecycle and structured-yield result;
- only accept terminal success when the structured payload validates against the launch schema;
- free-form assistant text may be diagnostic evidence but cannot independently create success.

If top-level `AgentSession` cannot meet this contract in executable conformance tests, the adapter must implement an explicit custom terminal tool/protocol or remain unaccepted. It must not fall back to regex/JSON extraction from assistant prose.

## 12. Terminal result persistence

Before `getStatus` may report SUCCEEDED/FAILED after process restart, the adapter must durably persist terminal settlement in `OmpExecutionRegistry`.

The registry must retain:

- execution ID;
- launch-spec binding;
- session ID/file;
- lifecycle phase;
- terminal `ExecutionResult` when present;
- validated structured output or a durable reference to it;
- terminal timestamps/provenance.

A later evidence/artifact layer may ingest the structured payload; executor success does not directly mutate graph authority.

## 13. Launch binding replay protection

A previously prepared `ExecutionId` cannot be rebound to:

- another workspace;
- another instruction;
- another model/reasoning profile;
- another tool allowlist;
- another output schema;
- another deadline;
- different artifact/evidence/approval bindings.

Until D-014 defines a universal canonical digest, the adapter registry may persist/compare the complete versioned launch structure directly.

## 14. Cancellation

OMP exposes abort, but generic `ExecutorPort` currently has no cancellation method.

Therefore cancellation is not silently added to `ExecutorPort` in this RFC.

If AI-STACK requires cancellation, it must be introduced as an explicit generic control contract and tested independently. An OMP-specific hidden abort side channel is forbidden as control-plane authority.

## 15. Tool/security policy

OMP v1 candidate configuration MUST use explicit restricted tools:

```text
toolNames = launch.tools.toolNames
restrictToolNames = true
```

No adapter execution is allowed to rely on ambient default tools when the launch spec declares an allowlist.

Permissions inside individual tools and filesystem/network sandboxing remain subject to D-011. Tool-name restriction is necessary but not sufficient to claim a full sandbox.

## 16. Workspace isolation

The adapter uses the already materialized absolute workspace root.

It does not create or switch Git worktrees implicitly.

Worktree creation/branch ownership/cleanup belongs to the execution-materialization/application layer so it can be evidenced before the executor starts.

## 17. Failure taxonomy

The adapter must distinguish at least:

- launch spec unavailable/invalid;
- model unavailable;
- session prepare conflict/corruption;
- OMP session construction failure;
- tool-policy enforcement failure;
- prompt rejected/not invoked;
- schema/structured-completion violation;
- explicit OMP/model/tool execution failure;
- deadline/abort;
- host-process interruption;
- durable registry corruption.

These must not collapse into generic success text.

## 18. Phase 11 deliverables

Phase 11 is contract/research only. It MUST NOT add OMP as a production dependency or implement `OmpExecutorAdapter`.

Required before implementation phase:

- primary-source OMP research artifact;
- `ExecutionLaunchSpec` contract;
- durable OMP execution registry contract;
- this RFC;
- fail-first conformance plan defining fake-runtime and real-OMP integration cases;
- explicit unknowns/recovery constraints.

## 19. Acceptance gate for D-010/D-016

D-010 cannot be ACCEPTED until a real adapter proves:

- exact launch-spec validation;
- restricted tool configuration;
- stable `ExecutionId -> OMP session` durable mapping;
- same-ID start replay;
- prompt/start does not equal terminal success;
- schema-valid structured terminal output;
- live RUNNING observation;
- terminal result survives adapter restart;
- ACTIVE-without-runtime becomes UNKNOWN rather than duplicate start;
- no graph-authority methods/types leak into OMP adapter boundary.

D-016 additionally requires evidence that uncertainty/restart cannot cause uncontrolled duplicate OMP work. Automatic crash recovery may remain fail-closed/explicit if correctness is preserved.

## 20. Non-goals

Not decided here:

- launch-spec storage/materializer implementation;
- artifact/evidence ingestion from terminal output;
- full filesystem/network sandbox mechanism;
- worker scheduler/executor routing;
- automatic interrupted-session continuation;
- generic cancellation API;
- graph transition after executor terminal result.
