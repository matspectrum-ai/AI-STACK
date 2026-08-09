# OMP Executor Conformance Research

Status: VERIFIED RESEARCH INPUT
Date: 2026-08-09
Target: Phase 11 — OMP Executor Contracts
Upstream reviewed: `can1357/oh-my-pi`, main around commit `45e12e5bb758198a920c6070e7e64cb33b21beac`; package `@oh-my-pi/pi-coding-agent` reports version `17.1.8`.

## 1. Research question

Determine which guarantees OMP / OhMyPI actually provides for an AI-STACK `ExecutorPort` adapter, especially:

- durable identity across process restart;
- session creation/resume;
- start acknowledgement versus terminal completion;
- live-status observability;
- crash-mid-turn behavior;
- structured terminal output;
- workspace/model/tool configuration;
- abort/interruption;
- suitability for AI-STACK stable `ExecutionId` reconciliation.

No conclusion below treats OMP as a durable remote job system unless the source explicitly proves it.

## 2. Verified SDK boundary

Primary sources:

- `packages/coding-agent/src/sdk.ts`
- `docs/sdk.md`

Verified:

- the SDK is an in-process integration surface;
- `createAgentSession()` accepts an explicit `cwd` and an optional `sessionManager`;
- if no manager is supplied, the SDK creates a file-backed `SessionManager` for the cwd;
- callers can provide model/model-pattern configuration, settings, auth/model registries, custom tools/extensions, skill paths, MCP configuration, and a wall-clock `deadline`;
- an `AgentSession` exposes session identity/path, subscription, prompt, abort, state, messages, model controls, and disposal;
- RPC is a separate JSONL-over-stdio mode intended for process/cross-language isolation.

Implication:

AI-STACK can embed OMP directly, but SDK embedding does not create an independently durable background worker. The agent execution lives in the host process.

## 3. Verified SessionManager durability

Primary source:

- `packages/coding-agent/src/session/session-manager.ts`

Verified API:

```ts
SessionManager.create(cwd: string, sessionDir?: string, storage = FileSessionStorage)
SessionManager.open(filePath: string, sessionDir?, storage?, options?): Promise<SessionManager>
```

Verified persistence semantics from the source comments/implementation:

- sessions are append-only JSONL trees;
- completed entries are synchronously handed to the OS during append;
- persistence is described as software-crash safe, not power-loss safe;
- in-flight streaming text is intentionally not durable until `message_end` persists a finished message;
- a session has a generated OMP session ID and generated session file name;
- the caller can choose the parent session directory but not use AI-STACK `ExecutionId` directly as OMP's native session ID through `SessionManager.create`;
- `SessionManager.open()` can reopen a known persisted session file.

Implication:

OMP gives AI-STACK a durable transcript/session artifact, but AI-STACK still needs a durable mapping from its stable `ExecutionId` to the generated OMP `sessionId/sessionFile` before the external agent turn is launched.

## 4. Verified AgentSession turn semantics

Primary sources:

- `packages/coding-agent/src/session/agent-session.ts`
- `packages/coding-agent/src/session/agent-session-events.ts`

Verified:

- `AgentSession.prompt(text, options)` returns `Promise<boolean>`;
- the boolean reports whether the prompt was forwarded/queued to the agent, not a structured terminal execution result;
- session consumers use `agent_end` to reason about turn completion;
- OMP's `AgentSessionEvent` refines `agent_end` with optional `isTerminal` because intermediate agent-end events can exist when recovery/continuation will resume;
- session exposes `sessionFile` and `sessionId`;
- abort is an explicit runtime operation.

Implication:

An AI-STACK adapter MUST NOT equate `prompt() === true` with successful execution and MUST NOT equate every `agent_end` with terminal success. Terminal settlement needs an explicit adapter protocol.

## 5. RPC semantics

Primary source:

- `docs/rpc.md`

Verified:

- RPC commands and events are JSONL over stdio;
- `prompt` is acknowledged before completion;
- `agent_end` is the event-level completion watermark for an invoked agent turn;
- state inspection includes session file/ID and streaming state;
- status/message queries exist in the running RPC process.

Implication:

RPC can improve process isolation but does not, by itself, prove restart-safe remote-job identity after the RPC process dies. AI-STACK still requires its own durable execution identity/mapping semantics.

## 6. Durable versus in-memory state

Primary sources:

- `packages/coding-agent/DEVELOPMENT.md`
- `packages/coding-agent/src/session/session-manager.ts`
- `packages/coding-agent/src/task/executor.ts`

Verified distinction:

Durable/session-backed:

- completed conversation/message entries;
- session header/tree state;
- model/thinking/session history sufficient for normal session reopen;
- completed tool results that have been persisted as session entries.

Process/runtime state includes non-durable operational objects such as:

- abort controllers;
- active streaming state;
- retry/runtime counters;
- queued steering/follow-up work;
- provider/session caches;
- in-process subagent registry/lifecycle objects.

The task/subagent executor is currently explicitly in-process.

Implication:

The OMP `AgentRegistry` or active subagent runtime MUST NOT be used as AI-STACK's durable execution registry.

## 7. Structured subagent output is not yet the top-level executor contract

Primary source:

- `packages/coding-agent/src/task/executor.ts`

Verified:

- OMP's subagent task machinery has explicit structured-output/yield machinery, including schema validation and forced-yield behavior;
- it is implemented inside the task/subagent execution subsystem;
- the subsystem is currently in-process.

Conclusion:

This proves OMP has reusable design primitives for structured completion, but it does **not** prove that a top-level `AgentSession.prompt()` naturally returns the structured `ExecutionResult` AI-STACK requires.

AI-STACK should study/reuse the pattern, not silently treat task-subagent internals as the public executor contract.

## 8. AI-STACK contract gap discovered

Current generic `ExecutorStartRequest` contains:

- execution/run/graph/node identity;
- attempt;
- bound artifact/evidence/approval IDs.

It does **not** contain enough information to run OMP:

- no cwd/workspace path;
- no additional workspace roots;
- no materialized instruction/prompt;
- no explicit model selector;
- no explicit tool/capability policy;
- no structured output schema/completion protocol;
- no deadline;
- no immutable materialized context payload.

An OMP adapter implemented against the current request would have to invent defaults or perform hidden application-level materialization. Both violate AI-STACK's control-plane principles.

## 9. Required architecture before adapter implementation

Target split:

```text
ExecutionIntent / ExecutorStartRequest
          ↓
ExecutionLaunchSpecResolver
          ↓ immutable materialized launch spec
OmpExecutorAdapter
          ↓
OmpExecutionRegistry  (durable AI-STACK identity ↔ OMP session mapping)
          ↓
SessionManager + AgentSession
```

The launch resolver owns application/context materialization.
The OMP adapter owns transport/runtime translation.
The OMP execution registry owns restart-safe mapping and terminal-state bookkeeping.
Neither receives graph-authority mutation methods.

## 10. Stable identity requirement

Before invoking an OMP prompt for a previously unseen AI-STACK execution, the adapter must establish durable metadata sufficient to recover the mapping after a host-process crash:

```text
ExecutionId
  -> launch-spec identity/content binding
  -> OMP sessionId
  -> OMP sessionFile
  -> workspace binding
  -> adapter lifecycle
```

Because OMP session IDs/file names are generated by OMP, this mapping cannot be reconstructed safely from `ExecutionId` alone unless AI-STACK persists it.

## 11. Crash-mid-turn classification

A host crash can leave:

- a durable OMP session file;
- completed messages/tool results up to the last durable append;
- no live in-process agent execution;
- no guarantee that streaming content after the last completed message survived.

Therefore, after restart, an execution with a known OMP session but without an AI-STACK terminal result is not automatically:

- `SUCCEEDED`;
- `FAILED`;
- or safely `NOT_FOUND`.

Default classification must be fail-closed (`UNKNOWN` / interrupted) until an explicit recovery policy proves a safe continuation or terminal result.

## 12. D-016 implication

Generic AI-STACK already proves stable-ID at-least-once orchestration.

OMP does not natively prove exactly-once execution. D-016 can only be accepted for OMP if the adapter demonstrates one of:

1. durable idempotent start keyed by AI-STACK `ExecutionId`; or
2. a durable session-mapping + interruption/reconciliation protocol that prevents uncontrolled duplicate work and resumes/settles the same logical execution.

The second path is the current architectural candidate.

## 13. Unknowns that remain before OMP adapter code

Must be specified/tested, not guessed:

- how a materialized launch spec is produced and bound immutably to `ExecutionId`;
- exact tool/capability allowlist mapping into an OMP session;
- exact structured completion protocol for top-level OMP execution;
- how interrupted sessions are recognized from durable session history;
- whether safe interrupted-session continuation can be automated for all execution classes or must sometimes return `UNKNOWN` for human/application recovery;
- adapter-owned durable registry backend/schema;
- terminal result representation and provenance;
- cancellation semantics and whether a cancelled execution may be resumed;
- workspace/worktree ownership and cleanup semantics.

## 14. Primary sources

Reviewed from `can1357/oh-my-pi`:

- `packages/coding-agent/package.json`
- `packages/coding-agent/src/sdk.ts`
- `packages/coding-agent/src/session/session-manager.ts`
- `packages/coding-agent/src/session/agent-session.ts`
- `packages/coding-agent/src/session/agent-session-events.ts`
- `packages/coding-agent/src/task/executor.ts`
- `packages/coding-agent/DEVELOPMENT.md`
- `docs/sdk.md`
- `docs/session.md`
- `docs/rpc.md`

No community implementation is treated as authoritative for the contracts above.
