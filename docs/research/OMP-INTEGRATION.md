# OMP Integration Research

Status: CURRENT RESEARCH
Reviewed: 2026-08-09

## Purpose

Identify the narrowest integration boundary between AI-STACK's authoritative Engineering Graph and OMP / OhMyPI.

## Primary sources

- OMP SDK documentation: https://github.com/can1357/oh-my-pi/blob/main/docs/sdk.md
- OMP RPC protocol: https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md
- OMP repository: https://github.com/can1357/oh-my-pi
- Coding-agent development reference: https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/DEVELOPMENT.md

## Findings

### SDK

OMP exposes an in-process SDK from `@oh-my-pi/pi-coding-agent` for Node/TypeScript hosts. The documented surface includes session creation/control, model registry, auth storage, event streaming, tool wiring, and discovery helpers.

This is the lowest-friction integration path for an initial AI-STACK adapter because it preserves native TypeScript types and avoids a second process boundary.

### RPC

OMP also exposes RPC mode over stdio using newline-delimited JSON. RPC is the appropriate boundary when AI-STACK requires process isolation or a non-Node implementation.

The existence of RPC means selecting TypeScript for v1 does not require coupling the domain model permanently to TypeScript or to in-process OMP execution.

### ACP

OMP also supports ACP for editor integration. ACP is not selected as the control-plane boundary because AI-STACK is not primarily an editor host and requires control-plane-specific state, evidence, and policy semantics.

### Sessions and events

OMP has explicit session state and strongly typed event/hook surfaces. AI-STACK MUST treat these as execution/runtime observations, not as replacements for authoritative Engineering Graph state.

### Subagents and isolation

OMP includes task/subagent execution and worktree/isolation mechanisms. AI-STACK SHOULD consume these as execution capabilities through an adapter rather than reimplement them in the graph kernel.

## Boundary conclusion

AI-STACK v1 should use:

```text
Engineering Graph domain
        |
        v
ExecutorPort (AI-STACK-owned contract)
        |
        v
OmpSdkExecutorAdapter
        |
        v
@oh-my-pi/pi-coding-agent SDK
```

The domain MUST NOT import OMP types directly.

A future adapter may replace the in-process SDK boundary with:

```text
ExecutorPort -> OmpRpcExecutorAdapter -> omp --mode rpc
```

without changing graph-domain contracts.

## Consequences

- TypeScript/Bun is the preferred initial test and adapter substrate.
- OMP remains an execution kernel, not graph-state authority.
- AI-STACK owns adapter contracts.
- RPC remains the isolation/cross-language escape hatch.
- OMP events may produce candidate EvidenceRecords, but they require AI-STACK validation before becoming authoritative evidence.

## Unknowns requiring implementation-phase validation

- exact SDK event subset required by `ExecutorPort`;
- cancellation/timeout mapping;
- worktree lifecycle mapping;
- structured output schema binding;
- OMP version compatibility policy;
- which OMP tool permission events can be mapped into AI-STACK policy decisions without duplicating authority.
