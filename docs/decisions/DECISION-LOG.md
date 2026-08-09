# Decision Log

This file records accepted architectural decisions and unresolved decision points. Chat messages and agent output are not authoritative by themselves.

## Accepted direction

### D-001 — OMP as execution kernel

Status: PROVISIONALLY ACCEPTED

AI-STACK targets OMP / OhMyPI as the primary agent execution runtime. Phase 1 research now defines the intended boundary as an AI-STACK-owned `ExecutorPort`, with OMP SDK as the preferred first adapter and RPC retained as the isolation/cross-language alternative.

### D-002 — Graph Engineering as architecture principle

Status: PROVISIONALLY ACCEPTED

The engineering lifecycle will be represented as an explicit graph with typed nodes, transitions, gates, policies, artifacts, evidence, approvals, and failure paths.

### D-003 — Single control plane

Status: PROVISIONALLY ACCEPTED

AI-STACK owns authoritative workflow state. External frameworks may contribute primitives but must not introduce competing orchestration authority.

### D-004 — Evidence-backed TDD gates

Status: PROVISIONALLY ACCEPTED

Implementation requires valid specification, contract, and RED evidence. Prose instructions are not sufficient enforcement.

### D-005 — GSD as reference only

Status: PROVISIONALLY ACCEPTED

GSD concepts may inform context isolation and atomic execution, but the archived framework will not be a runtime dependency.

## Decisions under acceptance test

### D-009 — Initial runtime/test substrate

Status: PROPOSED
ADR: `docs/architecture/ADR/ADR-001-INITIAL-RUNTIME-SUBSTRATE.md`

TypeScript on Bun is proposed for the v1 executable contract-test and runtime substrate because it is the lowest-impedance path to OMP's native SDK. The Engineering Graph domain remains OMP-independent. This decision becomes accepted only after Phase 2 proves executable RED tests can target the domain contracts without importing OMP types or introducing ambiguous behavior.

### D-010 — OMP integration boundary

Status: PROPOSED
Research: `docs/research/OMP-INTEGRATION.md`

The proposed boundary is `Engineering Graph -> ExecutorPort -> OmpSdkExecutorAdapter -> OMP SDK`, with RPC as a replaceable adapter boundary when process isolation or cross-language operation is required.

## Open decisions

- D-006: Graph state persistence model
- D-007: Evidence storage format
- D-008: Artifact identity and lineage concrete representation
- D-011: Policy evaluation and permissions implementation mechanism
- D-012: Graph DSL shape and relationship to Spec Kit semantics

## Phase 1 domain contracts added

Phase 1 defines normative contracts for:

- GraphDefinition
- NodeDefinition
- EdgeDefinition
- GraphRunState
- TransitionRequest / TransitionDecision
- GateDefinition / GateResult
- PolicyDefinition / PolicyResult
- ArtifactRecord
- EvidenceRecord
- ExecutorRecord
- ApprovalRecord
- FailureRecord
- RetryPolicy

Executable production behavior remains intentionally absent.

Each open decision must be resolved by RFC/ADR with alternatives, constraints, and acceptance evidence.