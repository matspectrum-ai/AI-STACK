# Domain Contract Coverage

Status: PHASE-1 REVIEW

This file maps normative Engineering Graph contract areas to fail-first test specifications. It is a traceability index, not a replacement for the test definitions.

## Coverage matrix

| Contract area | Primary tests | Coverage |
|---|---|---|
| specification gate | DOMAIN-001 | covered |
| contract gate | DOMAIN-002 | covered |
| RED evidence gate | DOMAIN-003, DOMAIN-004 | covered |
| release verification gate | DOMAIN-005 | covered |
| independent approval | DOMAIN-006 | covered |
| approval scope | DOMAIN-007 | covered |
| approval expiry | DOMAIN-008 | covered |
| implicit shell prohibition | DOMAIN-009 | covered |
| tool policy enforcement | DOMAIN-010 | covered |
| privileged approval | DOMAIN-011 | covered |
| optimistic concurrency / stale state | DOMAIN-012 | covered |
| deterministic resume | DOMAIN-013 | covered |
| malformed state fail-closed | DOMAIN-014 | covered |
| DENY state safety | DOMAIN-015 | covered |
| PAUSE state safety | DOMAIN-016 | covered |
| artifact immutability | DOMAIN-017 | covered |
| artifact producer integrity | DOMAIN-018 | covered |
| lineage acyclicity | DOMAIN-019 | covered |
| requirement-to-code lineage | DOMAIN-020 | covered |
| unverified evidence | DOMAIN-021 | covered |
| invalid evidence | DOMAIN-022 | covered |
| expired evidence | DOMAIN-023 | covered |
| evidence digest integrity | DOMAIN-024 | covered |
| retryability classification | DOMAIN-025 | covered |
| bounded retry budget | DOMAIN-026 | covered |
| durable retry accounting | DOMAIN-027 | covered |
| explicit exhaustion route | DOMAIN-028 | covered |
| edge endpoint integrity | DOMAIN-029 | covered |
| immutable activated graph version | DOMAIN-030 | covered |
| edge existence != authorization | DOMAIN-031 | covered |
| gate indeterminate fail-closed | DOMAIN-032 | covered |
| policy indeterminate fail-closed | DOMAIN-033 | covered |
| deterministic gate result | DOMAIN-034 | covered |
| prose is non-authoritative | DOMAIN-035 | covered |

## Additional contract tests required before runtime implementation

The review found normative contracts not directly exercised by DOMAIN-001..035. These MUST be included in the first executable RED suite.

### DOMAIN-036 — Identifier uniqueness

Given a graph definition contains duplicate node IDs or duplicate edge IDs
When graph definition validation runs
Then activation MUST be rejected.

### DOMAIN-037 — Identifier opacity

Given two valid opaque identifiers with different internal string shapes
When authorization, ordering, or transition logic runs
Then behavior MUST NOT depend on parsing semantic meaning from the identifier text.

### DOMAIN-038 — Non-entry executable node requires inbound edge

Given an executable node is not declared as an entry node
And has no inbound edge
When graph validation runs
Then activation MUST be rejected.

### DOMAIN-039 — Transition references graph version

Given a transition is evaluated
When its authoritative decision record is persisted
Then the decision MUST be attributable to the exact graph ID and immutable graph version used for evaluation.

### DOMAIN-040 — Exactly one transition decision

Given one transition request is evaluated once
When evaluation completes
Then exactly one authoritative decision record MUST exist for that evaluation attempt.

### DOMAIN-041 — Gate evaluation is side-effect free

Given a gate is evaluated against authoritative inputs
When the gate returns a result
Then graph state, artifacts, evidence, approvals, and executor state MUST remain unchanged except for observability/audit records explicitly outside domain mutation.

### DOMAIN-042 — Policy version attribution

Given a policy participates in an authoritative decision
When its result is persisted
Then the result MUST include the exact policy ID and policy version evaluated.

### DOMAIN-043 — Capability does not equal authority

Given an executor advertises capability to invoke a tool
And lacks the required authority/policy permission
When invocation is requested
Then execution MUST be denied or paused according to policy.

### DOMAIN-044 — Failure is persisted before recovery

Given a node execution fails
When retry, recovery, or escalation is considered
Then a first-class FailureRecord MUST already exist for the failed attempt.

### DOMAIN-045 — Retry policy bounds are valid

Given a retry policy declares a non-finite, zero, or negative maximum attempt count
When policy validation runs
Then the retry policy MUST be rejected.

### DOMAIN-046 — Unknown mandatory input fails closed

Given a gate or policy requires authoritative input
And that input is unavailable or cannot be validated
When evaluation occurs
Then the outcome MUST NOT authorize the transition.

### DOMAIN-047 — Output contract validation precedes authority

Given an executor completes work
And its produced output violates the node's declared output contract
When result acceptance is evaluated
Then the result MUST NOT become authoritative graph output
And downstream transition MUST NOT be allowed because of that invalid output.

## Phase 1 readiness verdict

The domain specification and normative contracts are sufficiently explicit to author strict executable interfaces and RED tests without selecting persistence technology or implementing runtime behavior.

Phase 1 does **not** claim executable test completion. The next phase must encode DOMAIN-001..047 as executable fail-first tests before production behavior is introduced.

No implementation language decision becomes final merely from this document. ADR-001 remains PROPOSED until the RED test substrate is validated.