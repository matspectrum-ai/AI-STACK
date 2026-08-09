# ExecutionLaunchSpec Contract v1

Status: CONTRACT — PRE-IMPLEMENTATION
Phase: 11 — OMP Executor Contracts
Depends on:
- `contracts/execution.ts`
- `contracts/execution-launch.ts`

## 1. Problem

`ExecutorStartRequest` intentionally contains stable orchestration identity and provenance references, but it does not contain enough application content to execute a coding agent.

An executor requires a materialized workspace, task instruction, model policy, tool policy, structured output contract, and deadline.

Those values must not be guessed inside an adapter.

## 2. Boundary

```text
ExecutorStartRequest
       ↓
ExecutionLaunchSpecResolver
       ↓
ExecutionLaunchSpec
       ↓
Executor adapter (OMP first)
```

The resolver is application/context materialization.
The executor adapter is runtime translation/execution.

## 3. Identity binding

A resolved launch spec MUST exactly match the requesting execution on:

- `executionId`;
- `runId`;
- `graphId`;
- `graphVersion`;
- `nodeId`;
- `attempt`;
- bound artifact IDs;
- bound evidence IDs;
- bound approval IDs.

Any mismatch is `INVALID` and execution MUST NOT start.

## 4. Workspace

`workspace.cwd` MUST be an absolute, normalized execution root selected before adapter invocation.

`additionalDirectories` MUST also be absolute and explicitly authorized.

The adapter MUST NOT silently fall back to:

- process cwd;
- repository discovery cwd;
- user home;
- another execution's worktree.

Worktree creation/selection is upstream of this contract. The executor receives the already materialized workspace path.

## 5. Instruction

`instruction` is the fully materialized task instruction for this execution.

Rules:

- non-empty;
- no hidden artifact lookup is allowed inside the executor adapter;
- referenced requirements/specs/contracts may be embedded or resolved into the instruction/context before this boundary;
- the adapter may add only stable runtime protocol instructions required for structured completion/security, never application requirements that were absent from the spec.

## 6. Model

`model.selector` is explicit and non-empty.

`reasoningProfile` is one of:

- minimal
- low
- medium
- high
- max

Adapters must either map the requested profile deterministically or reject the launch. Silent downgrade/upgrade is forbidden unless a future contract explicitly allows fallback and records evidence.

## 7. Tools

v1 uses a fail-closed allowlist:

```text
mode = ALLOWLIST
toolNames = [...]
```

Rules:

- names are unique, non-empty strings;
- an empty allowlist means no tools;
- discovered/ambient tools must not leak into a restricted execution;
- adapter failure to enforce the allowlist is launch failure.

For OMP, primary-source research confirms `CreateAgentSessionOptions.toolNames` + `restrictToolNames` are available specifically for this purpose. Restricted OMP sessions also suppress ambient expansion such as inherited MCP capability.

## 8. Structured output

Every AI-STACK execution has a structured terminal output contract:

- stable `schemaRef`;
- materialized JSON Schema object.

Free-form final assistant text is not, by itself, a successful `ExecutionResult`.

The executor adapter must produce a schema-validated terminal payload through its accepted completion protocol.

OMP research confirms SDK primitives `outputSchema`, `outputSchemaMode`, and `requireYieldTool` exist, but Phase 11 must still prove their top-level executor behavior before relying on them as accepted terminal semantics.

## 9. Deadline

`deadlineEpochMs` is mandatory and finite.

The adapter MUST NOT silently extend it.

A runtime may finish earlier, abort at/after the deadline, or fail to launch when the deadline is already expired.

## 10. Resolver outcomes

`FOUND` means the complete immutable launch material is available.

`NOT_FOUND` means execution cannot start because materialization has not been produced.

`INVALID` distinguishes:

- identity mismatch;
- binding mismatch;
- invalid workspace;
- invalid instruction;
- invalid model;
- invalid tool policy;
- invalid output contract;
- invalid deadline.

## 11. Durability

This contract does not yet choose how launch specs are persisted/materialized.

However, an OMP adapter's durable execution registry MUST bind its first prepared session to the exact resolved launch-spec content so replay under the same `ExecutionId` cannot silently launch different work.

The generic canonical digest decision remains D-014; Phase 11 may compare/store the versioned structured launch spec directly without claiming a universal cryptographic digest standard.

## 12. Non-goals

This contract does not:

- choose OMP session storage;
- create worktrees;
- select the executor implementation;
- implement artifact/evidence stores;
- grant graph authority;
- define application-level graph transition after executor completion.
