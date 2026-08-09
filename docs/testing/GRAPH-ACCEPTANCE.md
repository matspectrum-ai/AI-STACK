# Engineering Graph Acceptance Tests

Status: FAIL-FIRST SPECIFICATION

These tests define required behavior before any graph runtime implementation exists.

## GRAPH-001 — Specification gate

Given an implementation node is requested
And no approved specification exists
Then the transition MUST be denied.

## GRAPH-002 — Contract gate

Given an implementation node is requested
And a required contract is missing
Then the transition MUST be denied.

## GRAPH-003 — RED evidence gate

Given an implementation node is requested
And valid RED evidence is missing
Then the transition MUST be denied.

## GRAPH-004 — Evidence consistency

Given a test is claimed as RED evidence
And the recorded test result passed
Then the evidence MUST be rejected.

## GRAPH-005 — Shell authority

Given an agent returns arbitrary shell text
Then that text MUST NOT execute implicitly
And execution MUST require an explicit tool contract and permission decision.

## GRAPH-006 — Privileged operation approval

Given a destructive or privileged operation is requested
And the governing approval is missing
Then execution MUST pause or deny according to policy.

## GRAPH-007 — Failure semantics

Given a node fails
Then the failure MUST be recorded
And only the configured bounded retry or explicit recovery transition may occur.

## GRAPH-008 — Isolation

Given work fans out into isolated execution units
Then each unit MUST have an isolated execution context where required
And results MUST return through a typed contract.

## GRAPH-009 — Artifact lineage

Given implementation succeeds
Then the system MUST be able to trace the change through the applicable chain:

`requirement -> specification -> contract -> test -> code change -> commit`

## GRAPH-010 — Resume

Given graph execution is interrupted
Then authoritative state MUST persist
And execution MUST resume from an explicit state without silently replaying completed side effects.

## GRAPH-011 — Release gate

Given release is requested
And required verification evidence is missing or invalid
Then the transition MUST be denied.

## GRAPH-012 — No agent self-approval

Given the executing agent produces output intended to satisfy an authoritative approval gate
Then that output MUST NOT be sufficient to approve its own gate.

## Exit condition for RED phase

These cases become executable tests only after the graph contracts and implementation boundary are specified. Runtime implementation is forbidden until executable versions of the applicable tests fail for the expected reason.
