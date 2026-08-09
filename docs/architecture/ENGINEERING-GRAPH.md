# Engineering Graph v1

Status: DRAFT
Phase: 1 — Engineering Graph Domain
Authority: STACK-RFC-001

## 1. Purpose

The Engineering Graph is AI-STACK's authoritative model of software-engineering work. It represents allowed work, required evidence, policy decisions, artifact lineage, approvals, failures, and state transitions independently from any agent's prose output.

OMP / OhMyPI executes work. The Engineering Graph decides whether work is eligible to execute and whether its result is eligible to advance.

## 2. Design constraints

1. Graph state MUST be explicit and persistable.
2. Transitions MUST be deterministic for the same authoritative inputs.
3. Agent prose MUST NOT directly mutate authoritative graph state.
4. Every authoritative transition MUST produce a decision record.
5. Required evidence MUST be validated before a gate may pass.
6. An executor MUST NOT self-approve an authoritative gate for work it executed.
7. Retries MUST be bounded and policy-defined.
8. Artifact lineage MUST be preserved across derived artifacts.
9. Privileged or destructive actions MUST require an explicit permission decision.
10. Unknown or malformed state MUST fail closed.

## 3. Core model

```text
EngineeringGraph
  ├── Node[]
  ├── Edge[]
  ├── Policy[]
  ├── Artifact[]
  ├── Evidence[]
  ├── Approval[]
  ├── Failure[]
  └── TransitionRecord[]
```

The graph definition describes what transitions are possible. Graph state records what has actually happened.

## 4. Graph

A Graph is a versioned definition of an engineering process.

Required properties:

- `graph_id`: stable identifier.
- `graph_version`: immutable definition version.
- `nodes`: node definitions addressable by stable ID.
- `edges`: allowed relationships between nodes.
- `entry_nodes`: nodes from which an execution may begin.
- `terminal_nodes`: nodes after which no normal forward transition is required.

Invariants:

- A graph version is immutable after activation.
- Every edge references existing nodes in the same graph version.
- Every non-entry executable node MUST have at least one inbound edge.
- Every transition MUST reference the graph version under which it was evaluated.

## 5. Node

A Node is a typed unit of engineering work or evaluation.

Initial node kinds:

- `discovery`
- `product`
- `design`
- `architecture`
- `specification`
- `contract`
- `test_design`
- `red_verification`
- `implementation`
- `green_verification`
- `refactor`
- `review`
- `security`
- `eval`
- `qa`
- `verification`
- `release`
- `observability`
- `feedback`
- `approval`
- `recovery`

Required properties:

- stable `node_id`
- `kind`
- declared required inputs
- declared outputs
- executor requirements
- gate requirements
- retry policy reference when executable

A Node definition MUST NOT contain hidden execution side effects.

## 6. Edge

An Edge declares a possible directed transition relationship between two nodes.

Initial edge kinds:

- `forward`
- `conditional`
- `retry`
- `recovery`
- `feedback`
- `fan_out`
- `join`

An Edge does not itself authorize execution. A Transition evaluates the edge plus all applicable gates and policies.

## 7. State

State is the authoritative persisted execution state of one graph instance.

A graph instance has a stable `run_id`.

Minimum state includes:

- graph ID and version
- run ID
- active node set
- completed node executions
- produced artifacts
- accepted evidence
- approvals
- failures
- retry counters
- transition history

State MUST be reconstructable from persisted authoritative records or a deterministic snapshot plus append-only records.

## 8. Transition

A Transition is an evaluated attempt to move graph state across one declared edge.

Transition evaluation order:

1. validate graph and run identity;
2. validate current state;
3. validate edge existence;
4. resolve required artifacts;
5. resolve required evidence;
6. evaluate policies;
7. evaluate approvals;
8. evaluate gates;
9. produce exactly one transition decision;
10. persist decision before activating the destination state.

Initial decisions:

- `ALLOW`
- `DENY`
- `PAUSE`

A transition decision MUST include machine-readable reason codes.

## 9. Gate

A Gate is a deterministic predicate over authoritative inputs.

A gate may inspect:

- graph state
- artifacts and metadata
- evidence
- policy decisions
- approvals
- executor identity
- failure and retry state

Initial gate outcomes:

- `PASS`
- `FAIL`
- `INDETERMINATE`

`INDETERMINATE` MUST NOT be treated as `PASS`.

Examples:

- approved specification exists;
- required contract exists;
- valid RED evidence proves the target test failed for the expected reason;
- verification evidence exists before release;
- required human approval is current and scoped to the requested action.

## 10. Policy

A Policy defines authorization or governance rules independent from agent judgment.

Initial policy scopes:

- execution permission
- destructive operations
- shell/tool invocation
- retry limits
- model/executor eligibility
- approval requirements
- evidence freshness
- environment boundaries

A policy result MUST be attributable to a policy ID and policy version.

Policies fail closed when required information is unavailable.

## 11. Artifact

An Artifact is a versioned engineering output that can be consumed by later nodes.

Initial artifact kinds include:

- brief
- PRD
- design
- RFC
- ADR
- specification
- contract
- test plan
- test definition
- source change
- review report
- security report
- eval report
- QA report
- release manifest

Minimum identity:

- `artifact_id`
- `artifact_kind`
- `artifact_version`
- immutable content reference or digest
- producer node execution
- parent artifact references when derived

Artifact lineage MUST be acyclic for derivation relationships.

## 12. Evidence

Evidence is a machine-verifiable observation used to support a gate or decision.

Evidence is not synonymous with an artifact. An artifact may state an intention; evidence proves an observation occurred.

Examples:

- test command exit status
- structured test report
- diff digest
- review result
- approval signature/record
- tool execution result
- deployment verification

Minimum fields:

- `evidence_id`
- `evidence_type`
- producer identity
- timestamp
- subject reference
- immutable payload reference or digest
- verification status

Evidence states:

- `UNVERIFIED`
- `VALID`
- `INVALID`
- `EXPIRED`

Only `VALID` evidence may satisfy an authoritative gate.

## 13. Executor

An Executor is an identified actor capable of performing node work.

Initial executor kinds:

- `agent`
- `human`
- `deterministic_tool`
- `ci_job`

Executor identity is distinct from approval authority.

An executor result is advisory until its declared output contracts and evidence requirements are validated.

OMP is the primary agent execution kernel, but OMP-specific details are outside this domain specification and require a separate integration contract.

## 14. Approval

An Approval is an explicit authorization scoped to a subject and action.

Minimum approval dimensions:

- approver identity
- subject
- allowed action
- scope
- timestamp
- expiration when applicable
- policy requiring the approval

An executor MUST NOT satisfy an authoritative approval requirement for its own execution result unless a future policy explicitly defines an independently trustworthy mechanism. v1 forbids this.

## 15. Failure

A Failure is a first-class record of unsuccessful execution or validation.

Initial failure classes:

- `EXECUTION_FAILURE`
- `CONTRACT_VIOLATION`
- `GATE_FAILURE`
- `POLICY_DENIAL`
- `EVIDENCE_INVALID`
- `TIMEOUT`
- `RESOURCE_FAILURE`
- `INTERNAL_ERROR`

A failure record MUST include:

- failure ID
- class
- node execution or transition subject
- machine-readable reason code
- retryability classification
- observed evidence
- timestamp

Failure does not imply retry eligibility.

## 16. Retry and recovery semantics

Retries are explicit graph behavior, not implicit agent loops.

Each retryable node MUST declare:

- maximum attempts
- retryable failure classes/reason codes
- backoff semantics if applicable
- whether executor/context reuse is permitted
- exhaustion transition

When retry budget is exhausted, the graph MUST follow an explicit recovery, escalation, or terminal failure edge.

## 17. Initial lifecycle constraints

The following are hard v1 invariants:

```text
SPECIFICATION --approved--> CONTRACT
CONTRACT --defined--> TEST_DESIGN
TEST_DESIGN --test-created--> RED_VERIFICATION
RED_VERIFICATION --valid-red-evidence--> IMPLEMENTATION
IMPLEMENTATION --completed--> GREEN_VERIFICATION
GREEN_VERIFICATION --valid-green-evidence--> REFACTOR
...
VERIFICATION --valid-release-evidence--> RELEASE
```

No direct `SPECIFICATION -> IMPLEMENTATION` transition exists in v1.

No direct `CONTRACT -> IMPLEMENTATION` transition exists in v1.

No release transition may bypass verification.

## 18. Determinism boundary

The system distinguishes two classes of work:

### Non-deterministic/advisory

- agent reasoning
- planning proposals
- generated prose
- code generation
- review suggestions

### Authoritative/deterministic

- graph state mutation
- gate evaluation
- policy evaluation
- evidence validation status
- approval binding
- retry accounting
- transition decision recording

The control plane MUST never infer authoritative state solely from unstructured agent prose.

## 19. Open questions for Phase 1

The following remain intentionally unresolved until their contracts are reviewed:

- concrete ID format;
- persistence technology;
- evidence payload storage technology;
- graph DSL serialization format;
- runtime implementation language;
- OMP transport/integration mechanism;
- cryptographic requirements for artifact/evidence digests;
- exact human approval UX.

These are implementation or secondary contract decisions and MUST NOT be guessed into the domain model.