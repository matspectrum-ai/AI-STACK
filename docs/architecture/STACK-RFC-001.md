# STACK-RFC-001 — AI-Native Engineering Harness v1

Status: DRAFT

## 1. Problem

AI coding frameworks commonly combine planning, prompting, orchestration, execution, review, and state management under one authority. Combining multiple such frameworks creates conflicting control planes, ambiguous state, duplicated orchestration, and unenforceable process guarantees.

AI-STACK requires one authoritative engineering control plane that can use external frameworks as primitive sources while preserving deterministic state, explicit policy, artifact traceability, and evidence-backed transitions.

## 2. Objectives

- Define an OMP-native AI engineering harness.
- Represent the software delivery lifecycle as an executable Engineering Graph.
- Make specifications, contracts, tests, evidence, policies, and approvals first-class graph state.
- Enforce TDD rather than relying on prose instructions.
- Preserve requirement-to-release artifact lineage.
- Support resumable, observable, bounded agent execution.

## 3. Non-goals

- Installing multiple full orchestration frameworks side-by-side.
- Treating prompts or SKILL.md files as authoritative enforcement.
- Replacing OMP's execution primitives without evidence that replacement is necessary.
- Implementing a generic autonomous agent platform.

## 4. Architectural hypothesis

```text
External primitive sources
  BMAD | gstack | OpenSpec | Spec Kit | Superpowers | Ralph
                         |
                         v
                AI-STACK Control Plane
                         |
                 Engineering Graph
          +--------------+--------------+
          |              |              |
       Policies       Evidence      Artifact Graph
          |              |              |
          +--------------+--------------+
                         |
                         v
                    OMP / OhMyPI
                         |
              Skills | Subagents | Tools
```

OMP is the execution kernel. AI-STACK owns authoritative workflow state and transition policy.

## 5. Initial graph lifecycle

`DISCOVERY -> PRODUCT -> DESIGN -> ARCHITECTURE -> SPECIFICATION -> CONTRACTS -> TEST_DESIGN -> RED -> IMPLEMENTATION -> GREEN -> REFACTOR -> REVIEW -> SECURITY -> EVAL -> QA -> VERIFICATION -> RELEASE -> OBSERVABILITY -> FEEDBACK`

The lifecycle is a graph, not a strictly linear pipeline. Branching, joins, retries, human intervention, and failure transitions must be explicit.

## 6. Core domain primitives

The minimum candidate domain model contains:

- Node
- Edge
- Transition
- State
- Gate
- Policy
- Artifact
- Evidence
- Executor
- Approval
- Failure

No implementation language is selected by this RFC yet.

## 7. Hard gates

The initial required invariants are:

1. No implementation without an approved specification.
2. No implementation without required contracts.
3. No implementation without valid RED evidence.
4. No authoritative gate may be self-approved by the executing agent.
5. No release without verification evidence.
6. Destructive or privileged operations require explicit authorization policy.
7. Arbitrary agent text must never be implicitly executed as shell content.

## 8. Candidate primitive sources

### Product and discovery
- BMAD Method
- gstack

### Specification and change management
- OpenSpec
- GitHub Spec Kit

### Engineering discipline
- Superpowers

### Context isolation and long-horizon execution
- Ralph
- selected GSD concepts as reference only

### Verification and QA
- OMP native review primitives
- Superpowers verification semantics
- gstack review / browser QA primitives

## 9. Current provisional decisions

- Graph Engineering: ADOPT as architecture principle.
- OMP / OhMyPI: ADOPT as primary execution kernel.
- Full external framework orchestration: REJECT.
- External primitives: evaluate as KEEP / ADAPT / REIMPLEMENT / REJECT.
- Artifact lineage, evidence model, policy authority, and transition validation: OWN.
- GSD runtime dependency: REJECT; concepts may be retained as research references.

## 10. Acceptance criteria before implementation

Runtime implementation cannot begin until:

- graph domain contracts are defined;
- transition invariants are specified;
- permission semantics are specified;
- evidence schemas are specified;
- failure and retry semantics are specified;
- fail-first acceptance tests exist for each hard gate;
- OMP integration boundary is contract-defined.

## 11. Open decisions

- Whether Spec Kit workflow semantics should inform the graph DSL or only selected primitives.
- Persistence model for graph state and evidence.
- Runtime implementation language.
- OMP SDK integration boundary.
- Policy evaluation mechanism.
- Artifact identity and lineage representation.

These remain deliberately unresolved until the corresponding contracts and evaluation evidence exist.
