# OMP Executor Conformance Research

Status: VERIFIED RESEARCH INPUT
Date: 2026-08-09
Target: Phase 11 — OMP Executor Contracts
Upstream reviewed: `can1357/oh-my-pi`, main around commit `45e12e5bb758198a920c6070e7e64cb33b21beac`; package `@oh-my-pi/pi-coding-agent` reports version `17.1.8`.

## 1. Research question

Determine which guarantees OMP / OhMyPI actually provides for an AI-STACK `ExecutorPort` adapter, especially durable identity, session resume, terminal settlement, crash-mid-turn behavior, tool restriction, structured output, workspace/model configuration, and stable `ExecutionId` reconciliation.

No conclusion below treats OMP as a durable remote job system unless the source explicitly proves it.

## 2. Verified SDK boundary

Primary sources:

- `packages/coding-agent/src/sdk.ts`
- `packages/coding-agent/src/tools/index.ts`
- `docs/sdk.md`

Verified:

- the SDK is an in-process integration surface;
- `createAgentSession()` accepts explicit `cwd` and optional `sessionManager`;
- if no manager is supplied, the SDK creates a file-backed `SessionManager` for the cwd;
- callers can provide model/model-pattern configuration, settings, auth/model registries, custom tools/extensions, skill paths, MCP configuration, additional directories, and a wall-clock deadline;
- an `AgentSession` exposes session identity/path, subscription, prompt, abort, state, messages, model controls, and disposal;
- RPC is a separate JSONL-over-stdio mode intended for process/cross-language isolation;
- SDK `CreateAgentSessionOptions` exposes `toolNames` and `restrictToolNames`;
- when `restrictToolNames` is enabled, OMP creates a restricted tool session and suppresses ambient capability expansion such as inherited/discovered MCP tools;
- SDK options also expose `outputSchema`, `outputSchemaMode`, and `requireYieldTool` and wire them into the tool-session construction path.

Implication:

AI-STACK can enforce an explicit OMP tool-name allowlist without relying on ambient defaults. This is necessary but not sufficient to claim filesystem/network sandboxing inside the allowed tools.

SDK embedding still does not create an independently durable background worker; live agent execution belongs to the host process.

## 3. Verified SessionManager durability

Primary source:

- `packages/coding-agent/src/session/session-manager.ts`

Verified API:

```ts
SessionManager.create(cwd: string, sessionDir?: string, storage = FileSessionStorage)
SessionManager.open(filePath: string, sessionDir?, storage?, options?): Promise<SessionManager>
```

Verified persistence semantics:

- sessions are append-only JSONL trees;
- completed entries are synchronously handed to the OS during append;
- persistence is described as software-crash safe, not power-loss safe;
- in-flight streaming text is intentionally not durable until `message_end` persists a finished message;
- a session has a generated OMP session ID and generated session file name;
- the caller can choose the parent session directory but not replace OMP's generated native session ID with AI-STACK `ExecutionId` through `SessionManager.create`;
- `SessionManager.open()` can reopen a known persisted session file.

Implication:

OMP gives AI-STACK a durable transcript/session artifact, but AI-STACK still needs a durable mapping from stable `ExecutionId` to generated OMP `sessionId/sessionFile` before model execution starts.

## 4. Verified AgentSession turn semantics

Primary sources:

- `packages/coding-agent/src/session/agent-session.ts`
- `packages/coding-agent/src/session/agent-session-events.ts`

Verified:

- `AgentSession.prompt(text, options)` returns `Promise<boolean>`;
- the boolean reports whether the prompt was forwarded/queued, not an AI-STACK structured terminal result;
- the method awaits the underlying agent turn when it is invoked, so calling it directly would block a generic `ExecutorPort.start()` for the duration of the turn;
- session consumers use `agent_end` to reason about turn completion;
- OMP refines `agent_end` with optional `isTerminal` because intermediate agent-end events can exist when recovery/continuation will resume;
- session exposes `sessionFile`, `sessionId`, `isStreaming`, messages, subscribe, and abort.

Implication:

An AI-STACK adapter MUST NOT equate `prompt() === true` with successful execution and MUST NOT equate every `agent_end` with terminal success. To satisfy generic prompt start semantics, the adapter should launch the awaited prompt in its own tracked async task and return `STARTED` after durable session preparation/activation rather than wait for terminal completion.

## 5. RPC semantics

Primary source:

- `docs/rpc.md`

Verified:

- RPC commands/events are JSONL over stdio;
- RPC `prompt` is acknowledged before completion;
- `agent_end` is the event-level completion watermark for an invoked turn;
- state inspection includes session file/ID and streaming state;
- status/message queries exist while the RPC process is running.

Implication:

RPC can improve process isolation but does not by itself prove restart-safe remote-job identity after the RPC process dies. AI-STACK still requires its own durable execution identity/mapping semantics.

## 6. Durable versus in-memory state

Primary sources:

- `packages/coding-agent/DEVELOPMENT.md`
- `packages/coding-agent/src/session/session-manager.ts`
- `packages/coding-agent/src/task/executor.ts`

Durable/session-backed state includes completed conversation/message entries, session header/tree state, model/thinking/session history sufficient for normal reopen, and completed tool results once persisted as session entries.

Process/runtime state includes abort controllers, active streaming state, runtime retry counters, queued steering/follow-up work, provider/session caches, and in-process subagent registry/lifecycle objects.

The task/subagent executor is currently explicitly in-process.

Implication:

OMP `AgentRegistry` or active subagent runtime MUST NOT be used as AI-STACK's durable execution registry.

## 7. Structured output capability

Primary sources:

- `packages/coding-agent/src/sdk.ts`
- `packages/coding-agent/src/tools/index.ts`
- `packages/coding-agent/src/task/executor.ts`
- `packages/coding-agent/src/task/types.ts`

Verified:

- OMP's task/subagent machinery has explicit structured-output/yield behavior;
- `StructuredSubagentSchemaMode` includes `permissive | strict`;
- task execution contains schema validation and forced-yield logic;
- `createAgentSession()` itself exposes `outputSchema`, `outputSchemaMode`, and `requireYieldTool` and passes them into coding-tool session construction;
- `createCodingTools()` can include the yield tool when `requireYieldTool` is true and can receive the output schema/mode.

Conclusion:

The capability exists in the top-level SDK configuration path, so AI-STACK has a plausible native structured-completion strategy. However, Phase 11 still requires executable conformance proof that a top-level AgentSession configured this way produces the exact terminal semantics AI-STACK needs under normal completion, schema violation, retry/recovery, and process interruption.

Free-form assistant text remains non-authoritative for success.

## 8. AI-STACK contract gap discovered

Current generic `ExecutorStartRequest` contains identity, attempt, and bound artifact/evidence/approval IDs, but not enough information to execute OMP:

- no cwd/workspace path;
- no additional workspace roots;
- no materialized instruction/prompt;
- no explicit model selector/reasoning profile;
- no explicit tool allowlist;
- no structured output schema;
- no deadline.

An OMP adapter implemented against the request alone would have to invent defaults or perform hidden application-level materialization. Both violate AI-STACK's control-plane principles.

## 9. Required architecture before adapter implementation

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

The launch resolver owns application/context materialization. The OMP adapter owns runtime translation. The OMP registry owns restart-safe mapping and terminal bookkeeping. None receive graph-authority mutation methods.

## 10. Stable identity requirement

Before invoking OMP for a previously unseen execution, the adapter must durably establish:

```text
ExecutionId
  -> exact launch-spec binding
  -> OMP sessionId
  -> OMP sessionFile
  -> workspace binding
  -> adapter lifecycle
```

Because OMP session IDs/file names are generated by OMP, this mapping cannot be reconstructed safely from `ExecutionId` alone.

## 11. Crash-mid-turn classification

A host crash can leave a durable OMP session file and completed messages/tool results up to the last durable append, but no live in-process execution and no guarantee that streaming tail survived.

Therefore, after restart, a known OMP session without an AI-STACK terminal result is not automatically SUCCEEDED, FAILED, or safely NOT_FOUND.

Default classification must be fail-closed (`UNKNOWN` / interrupted) until an explicit recovery policy proves a safe continuation or terminal result.

## 12. D-016 implication

Generic AI-STACK already proves stable-ID at-least-once orchestration.

OMP does not natively prove exactly-once execution. D-016 can only be accepted for OMP if the adapter demonstrates either durable idempotent start keyed by AI-STACK `ExecutionId` or a durable session-mapping + interruption/reconciliation protocol that prevents uncontrolled duplicate work.

The second path is the current candidate.

## 13. Remaining unknowns before adapter code

Must be specified/tested, not guessed:

- how a materialized launch spec is produced/persisted and bound immutably to `ExecutionId`;
- top-level structured completion behavior with `outputSchema + strict + requireYieldTool` under real OMP execution;
- how interrupted sessions are recognized from durable session history;
- whether safe interrupted-session continuation can be automated for all execution classes or must sometimes remain `UNKNOWN` for explicit recovery;
- adapter-owned durable registry backend/schema;
- terminal structured-payload storage/result-reference semantics;
- generic cancellation contract and whether interrupted/cancelled executions may be resumed;
- workspace/worktree ownership and cleanup semantics;
- full permission/sandbox enforcement *inside* allowed tools (D-011). Tool-name allowlisting itself is verified.

## 14. Primary sources

Reviewed from `can1357/oh-my-pi`:

- `packages/coding-agent/package.json`
- `packages/coding-agent/src/sdk.ts`
- `packages/coding-agent/src/tools/index.ts`
- `packages/coding-agent/src/session/session-manager.ts`
- `packages/coding-agent/src/session/agent-session.ts`
- `packages/coding-agent/src/session/agent-session-events.ts`
- `packages/coding-agent/src/task/executor.ts`
- `packages/coding-agent/src/task/types.ts`
- `packages/coding-agent/DEVELOPMENT.md`
- `docs/sdk.md`
- `docs/session.md`
- `docs/rpc.md`

No community implementation is treated as authoritative for the contracts above.
