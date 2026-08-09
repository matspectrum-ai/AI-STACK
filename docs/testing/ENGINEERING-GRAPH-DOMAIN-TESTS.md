# Engineering Graph Domain Tests

Status: FAIL-FIRST SPECIFICATION
Phase: 1 — Engineering Graph Domain
Depends on:
- `docs/architecture/ENGINEERING-GRAPH.md`
- `docs/contracts/ENGINEERING-GRAPH-CONTRACTS.md`

These are behavior contracts to be converted into executable tests before runtime implementation.

## Transition safety

### DOMAIN-001 — Missing specification denies implementation

Given an implementation transition is requested
And the required approved specification artifact is absent
When the transition is evaluated
Then the decision MUST be `DENY`
And reason code MUST include `MISSING_REQUIRED_SPECIFICATION`
And destination state MUST remain inactive.

### DOMAIN-002 — Missing contract denies implementation

Given an implementation transition is requested
And an approved specification exists
And a required contract artifact is absent
When the transition is evaluated
Then the decision MUST be `DENY`
And reason code MUST include `MISSING_REQUIRED_CONTRACT`.

### DOMAIN-003 — Missing RED evidence denies implementation

Given specification and contract requirements are satisfied
And no `VALID` RED evidence exists for the required test subject
When the implementation transition is evaluated
Then the decision MUST be `DENY`
And reason code MUST include `MISSING_VALID_RED_EVIDENCE`.

### DOMAIN-004 — Passing test cannot prove RED

Given an evidence record is offered as RED evidence
And the referenced machine-verifiable execution outcome indicates success
When the evidence is validated
Then verification status MUST become `INVALID`
And the implementation gate MUST NOT pass
And reason code MUST include `INVALID_RED_EVIDENCE`.

### DOMAIN-005 — Release without verification evidence is denied

Given a release transition is requested
And required verification evidence is absent, invalid, or expired
When the transition is evaluated
Then the decision MUST be `DENY`
And reason code MUST include `MISSING_VERIFICATION_EVIDENCE`.

## Authority and approval

### DOMAIN-006 — Agent cannot self-approve

Given executor `A` produced the execution result under review
And an authoritative approval requires independent approval
When executor `A` attempts to approve that result
Then the approval MUST be rejected
And reason code MUST include `SELF_APPROVAL_FORBIDDEN`.

### DOMAIN-007 — Approval is scope-bound

Given an approval authorizes action `release` for subject `release-X`
When the same approval is presented for subject `release-Y`
Then it MUST NOT satisfy the approval requirement.

### DOMAIN-008 — Expired approval fails closed

Given an approval has an expiration time
And current authoritative time is after expiration
When a gate evaluates the approval
Then the approval MUST NOT satisfy the gate
And reason code MUST include `APPROVAL_EXPIRED`.

## Shell and tool authority

### DOMAIN-009 — Agent prose is never implicit shell authority

Given an agent output contains shell command text
When the output is received as unstructured model output
Then no shell command MUST execute
And no graph state MUST change because of that text.

### DOMAIN-010 — Explicit tool invocation still requires policy

Given an executor requests an explicit tool invocation
And the tool capability exists
But governing execution policy denies the action
When the request is evaluated
Then execution MUST NOT occur
And reason code MUST include `POLICY_DENIED`.

### DOMAIN-011 — Privileged action pauses when approval required

Given policy outcome is `REQUIRE_APPROVAL`
And a matching current approval does not exist
When execution is requested
Then execution MUST NOT occur
And the graph decision MUST be `PAUSE` or `DENY` according to the declared policy
And reason code MUST include `APPROVAL_REQUIRED`.

## State integrity

### DOMAIN-012 — Stale state revision is rejected

Given authoritative run state is revision `N+1`
And a transition request was formed against revision `N`
When the transition attempts to commit
Then it MUST NOT overwrite current state
And reason code MUST include `STALE_STATE_REVISION`.

### DOMAIN-013 — Resume is deterministic

Given a persisted graph run with a known authoritative history
When the run is reconstructed twice from the same persisted data
Then both reconstructions MUST produce equivalent authoritative state.

### DOMAIN-014 — Malformed authoritative state fails closed

Given persisted authoritative state cannot be validated
When resume is requested
Then no executable node MUST be activated
And reason code MUST include `MALFORMED_AUTHORITATIVE_STATE`.

### DOMAIN-015 — Denied transition does not activate destination

Given a transition decision is `DENY`
When the decision is persisted
Then destination node activation state MUST remain unchanged.

### DOMAIN-016 — Paused transition is not success

Given a transition decision is `PAUSE`
When downstream eligibility is evaluated
Then the destination MUST NOT be treated as successfully activated.

## Artifact lineage

### DOMAIN-017 — Artifact versions are immutable

Given artifact version `A@1` has a recorded content digest
When different content is produced
Then `A@1` MUST NOT be mutated in place
And a new version or artifact record MUST be created.

### DOMAIN-018 — Producer execution must exist

Given an artifact references a producer execution ID that does not exist
When artifact validation runs
Then the artifact MUST be rejected.

### DOMAIN-019 — Lineage cycle is rejected

Given artifact `A` derives from `B`
And a proposed lineage update would make `B` derive directly or transitively from `A`
When the update is validated
Then the update MUST be rejected.

### DOMAIN-020 — Requirement-to-code lineage is traversable

Given a successful implementation path
When lineage is queried from source-change artifact backward
Then the graph MUST be able to identify the governing test, contract, specification, and originating requirement/product artifact when those artifacts are declared required by the graph definition.

## Evidence integrity

### DOMAIN-021 — Unverified evidence cannot pass a gate

Given evidence status is `UNVERIFIED`
When a gate requires valid evidence
Then the gate MUST NOT return `PASS` because of that evidence.

### DOMAIN-022 — Invalid evidence cannot pass a gate

Given evidence status is `INVALID`
When a gate requires that evidence type
Then the gate MUST fail or remain indeterminate according to contract
And MUST NOT return `PASS`.

### DOMAIN-023 — Expired evidence cannot pass a freshness-constrained gate

Given policy declares evidence freshness requirements
And evidence is outside the allowed validity window
When the gate is evaluated
Then the evidence MUST be treated as `EXPIRED`
And MUST NOT satisfy the gate.

### DOMAIN-024 — Evidence payload mutation invalidates digest binding

Given an evidence record binds digest `D` to payload `P`
And payload bytes change
When integrity is checked
Then the previous evidence binding MUST NOT remain valid.

## Retry and failure semantics

### DOMAIN-025 — Retry requires retryable failure

Given a node failure is classified `NON_RETRYABLE`
When automatic retry is evaluated
Then automatic retry MUST be denied
And reason code MUST include `NON_RETRYABLE_FAILURE`.

### DOMAIN-026 — Retry budget is finite

Given retry policy `max_attempts = M`
And `M` attempts have already been consumed
When another automatic retry is requested
Then it MUST be denied
And reason code MUST include `RETRY_BUDGET_EXHAUSTED`.

### DOMAIN-027 — Retry accounting is persisted before activation

Given a retry is allowed
When retry execution is activated
Then the incremented retry counter MUST already be part of authoritative persisted state.

### DOMAIN-028 — Retry exhaustion uses explicit graph edge

Given retry budget is exhausted
When failure handling proceeds
Then the next state MUST be selected only from an explicit exhaustion/recovery edge declared by the graph definition.

## Graph definition validation

### DOMAIN-029 — Edge endpoints must exist

Given an edge references a missing source or destination node
When graph definition validation runs
Then graph activation MUST be rejected.

### DOMAIN-030 — Activated graph version is immutable

Given graph version `G@1` is activated
When mutation of its node or edge definition is attempted
Then the mutation MUST be rejected
And a new graph version MUST be required.

### DOMAIN-031 — Edge existence is not authorization

Given a valid edge exists between two nodes
And a mandatory gate fails
When a transition over that edge is evaluated
Then the decision MUST be `DENY`.

### DOMAIN-032 — Indeterminate gate blocks transition

Given a mandatory gate returns `INDETERMINATE`
When the transition is evaluated
Then the transition MUST NOT be `ALLOW`.

### DOMAIN-033 — Indeterminate policy fails closed

Given a mandatory policy returns `INDETERMINATE`
When the transition is evaluated
Then the transition MUST NOT be `ALLOW`
And reason code MUST include `POLICY_INDETERMINATE`.

## Determinism

### DOMAIN-034 — Same authoritative inputs yield same gate result

Given identical gate definition, policy versions, authoritative state, artifacts, evidence, approvals, and relevant clock input
When the same deterministic gate is evaluated repeatedly
Then its outcome and reason codes MUST be equivalent.

### DOMAIN-035 — Agent narrative cannot mutate state

Given an agent says "approved", "tests passed", "done", or equivalent prose
And no corresponding authoritative records exist
When graph state is evaluated
Then no approval, evidence, completion, or transition state MUST be created from the narrative alone.

## Completion criterion for Phase 1

Phase 1 contracts are ready for implementation planning only when:

1. every normative domain invariant maps to at least one test case;
2. no test requires guessing an undefined domain concept;
3. unresolved questions are explicitly classified as implementation decisions or follow-up contracts;
4. the tests can be encoded against strict interfaces without changing their intended behavior;
5. no runtime production code has been introduced before executable RED tests.