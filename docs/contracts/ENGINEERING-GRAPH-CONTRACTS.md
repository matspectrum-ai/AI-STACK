# Engineering Graph Contracts v1

Status: DRAFT
Depends on: `docs/architecture/ENGINEERING-GRAPH.md`

This document defines normative domain contracts. Keywords MUST, MUST NOT, SHOULD, and MAY are used normatively.

## 1. Identifier contracts

All authoritative entities MUST have stable identifiers unique within their namespace.

Required namespaces:

- graph
- run
- node
- node_execution
- edge
- transition
- gate
- policy
- artifact
- evidence
- executor
- approval
- failure

Identifiers MUST be opaque to domain logic. No authorization or ordering decision may depend on parsing an identifier.

## 2. GraphDefinition

```text
GraphDefinition
  graph_id
  graph_version
  nodes[]
  edges[]
  entry_nodes[]
  terminal_nodes[]
```

Contract:

- `graph_id` MUST be non-empty.
- `graph_version` MUST be immutable after activation.
- every node ID MUST be unique within the version.
- every edge ID MUST be unique within the version.
- edge endpoints MUST reference nodes in the same version.
- activated definitions MUST NOT be mutated in place.

## 3. NodeDefinition

```text
NodeDefinition
  node_id
  kind
  required_artifact_kinds[]
  required_gate_ids[]
  executor_policy_id?
  retry_policy_id?
  output_contracts[]
```

Contract:

- `kind` MUST be from the graph's supported node-kind vocabulary.
- required inputs MUST be declared before execution eligibility is evaluated.
- outputs that affect authoritative transitions MUST have explicit contracts.
- an executable node MUST have an executor policy or inherit one from graph policy.

## 4. EdgeDefinition

```text
EdgeDefinition
  edge_id
  from_node_id
  to_node_id
  kind
  gate_ids[]
  policy_ids[]
```

Contract:

- `from_node_id` and `to_node_id` MUST exist.
- the edge MUST NOT imply authorization by existence alone.
- all listed gates and policies MUST be evaluated before an `ALLOW` decision.

## 5. GraphRunState

```text
GraphRunState
  run_id
  graph_id
  graph_version
  active_node_ids[]
  completed_execution_ids[]
  artifact_refs[]
  evidence_refs[]
  approval_refs[]
  failure_refs[]
  retry_counters
  last_transition_id?
```

Contract:

- state MUST be attributable to exactly one graph version.
- state changes MUST occur only through recorded authoritative operations.
- a resume MUST restore the same authoritative state for the same persisted history.
- malformed or unverifiable persisted state MUST fail closed.

## 6. TransitionRequest

```text
TransitionRequest
  run_id
  edge_id
  requested_by_executor_id
  expected_state_revision
```

Contract:

- stale `expected_state_revision` MUST NOT silently overwrite newer state.
- a transition request MUST identify one declared edge.
- a request is not a decision.

## 7. TransitionDecision

```text
TransitionDecision
  transition_id
  run_id
  edge_id
  decision: ALLOW | DENY | PAUSE
  reason_codes[]
  evaluated_gate_results[]
  evaluated_policy_results[]
  bound_approval_ids[]
  bound_evidence_ids[]
  state_revision_before
  state_revision_after?
```

Contract:

- exactly one decision MUST be emitted per evaluated request.
- `ALLOW` requires every mandatory gate and policy to permit the transition.
- `DENY` MUST NOT mutate destination-node activation state.
- `PAUSE` MUST NOT be treated as `ALLOW`.
- successful state mutation MUST be durably associated with the decision.

## 8. GateDefinition and GateResult

```text
GateDefinition
  gate_id
  gate_type
  required_inputs[]

GateResult
  gate_id
  outcome: PASS | FAIL | INDETERMINATE
  reason_codes[]
  evaluated_input_refs[]
```

Contract:

- a gate MUST be deterministic over the authoritative inputs supplied to it.
- missing mandatory inputs MUST yield `FAIL` or `INDETERMINATE`, never `PASS`.
- `INDETERMINATE` MUST block transitions requiring a passing gate.
- gate evaluation MUST be side-effect free except for observability records.

## 9. PolicyDefinition and PolicyResult

```text
PolicyDefinition
  policy_id
  policy_version
  scope
  rule_reference

PolicyResult
  policy_id
  policy_version
  outcome: ALLOW | DENY | REQUIRE_APPROVAL | INDETERMINATE
  reason_codes[]
```

Contract:

- policies MUST be versioned.
- a required unavailable policy input MUST fail closed.
- `REQUIRE_APPROVAL` MUST name or resolve the required approval scope before execution.
- agent prose MUST NOT override a policy result.

## 10. ArtifactRecord

```text
ArtifactRecord
  artifact_id
  artifact_kind
  artifact_version
  content_ref
  content_digest
  producer_execution_id
  parent_artifact_ids[]
```

Contract:

- a referenced artifact version MUST be immutable.
- derivation lineage MUST be explicit.
- an artifact MUST NOT claim an unknown producer execution.
- lineage cycles MUST be rejected.
- content mutation requires a new artifact version or new artifact record.

## 11. EvidenceRecord

```text
EvidenceRecord
  evidence_id
  evidence_type
  producer_executor_id
  subject_ref
  observed_at
  payload_ref
  payload_digest
  verification_status: UNVERIFIED | VALID | INVALID | EXPIRED
  verifier_ref?
```

Contract:

- evidence MUST identify what it proves through `subject_ref` and `evidence_type`.
- evidence used by a gate MUST be `VALID`.
- evidence claiming a failed test MUST contain or reference machine-verifiable execution outcome sufficient to distinguish failure from success.
- changing evidence payload invalidates the previous digest binding.
- expiration policy, when applicable, MUST be evaluated before gate use.

## 12. ExecutorRecord

```text
ExecutorRecord
  executor_id
  executor_kind: agent | human | deterministic_tool | ci_job
  capabilities[]
  authority_scopes[]
```

Contract:

- capabilities describe what an executor may attempt; they do not grant graph-transition authority.
- authority scopes MUST be explicit.
- an agent executor MUST NOT gain shell, destructive, release, or approval authority from generated prose.

## 13. ApprovalRecord

```text
ApprovalRecord
  approval_id
  approver_executor_id
  subject_ref
  action
  scope
  granted_at
  expires_at?
  required_by_policy_id
```

Contract:

- an approval MUST be bound to a specific subject/action/scope.
- expired approvals MUST NOT satisfy gates.
- v1 MUST reject an approval where the approver is the same executor responsible for the execution result being authoritatively approved.
- approval reuse outside its declared scope MUST be rejected.

## 14. FailureRecord

```text
FailureRecord
  failure_id
  failure_class
  subject_ref
  reason_code
  retryability: RETRYABLE | NON_RETRYABLE | POLICY_DEPENDENT
  evidence_ids[]
  observed_at
```

Contract:

- failures MUST be first-class persisted records.
- retryability MUST NOT be inferred only from free-form error text.
- a non-retryable failure MUST NOT consume an automatic retry attempt.
- retry exhaustion MUST route through an explicit edge.

## 15. RetryPolicy

```text
RetryPolicy
  retry_policy_id
  max_attempts
  allowed_failure_classes[]
  allowed_reason_codes[]?
  context_strategy: reuse | fresh | policy_defined
  exhaustion_edge_id
```

Contract:

- `max_attempts` MUST be finite and greater than or equal to 1.
- retries beyond `max_attempts` MUST be denied.
- only declared retryable failures may trigger automatic retry.
- retry count MUST be persisted before a retry execution is activated.

## 16. Initial reason-code vocabulary

The following minimum machine-readable reason codes are reserved for v1 acceptance behavior:

- `MISSING_REQUIRED_SPECIFICATION`
- `MISSING_REQUIRED_CONTRACT`
- `MISSING_VALID_RED_EVIDENCE`
- `INVALID_RED_EVIDENCE`
- `MISSING_VERIFICATION_EVIDENCE`
- `SELF_APPROVAL_FORBIDDEN`
- `APPROVAL_REQUIRED`
- `APPROVAL_EXPIRED`
- `POLICY_DENIED`
- `POLICY_INDETERMINATE`
- `GATE_FAILED`
- `GATE_INDETERMINATE`
- `EDGE_NOT_ALLOWED`
- `STALE_STATE_REVISION`
- `RETRY_BUDGET_EXHAUSTED`
- `NON_RETRYABLE_FAILURE`
- `MALFORMED_AUTHORITATIVE_STATE`
- `UNAUTHORIZED_EXECUTOR`
- `IMPLICIT_SHELL_EXECUTION_FORBIDDEN`

New reason codes require specification before implementation.

## 17. Security boundary contract

Unstructured model output is data, never authority.

Therefore:

- shell text emitted by an agent MUST NOT execute unless passed through an explicit tool invocation contract;
- tool invocation MUST be evaluated against executor capability and policy;
- destructive/privileged tools MUST require the configured authorization path;
- graph state MUST NOT be mutated by parsing narrative statements such as "tests passed", "approved", or "done";
- authoritative claims require accepted artifact/evidence/approval records.

## 18. Concurrency contract

v1 MUST protect authoritative state from lost updates.

A transition request MUST carry an expected state revision or equivalent concurrency token. If authoritative state changed since the request was formed, the request MUST be rejected or reevaluated against the new state; it MUST NOT be committed using stale assumptions.

## 19. Compatibility boundary

These contracts intentionally do not prescribe:

- implementation language;
- database;
- serialization format;
- event bus;
- OMP transport;
- UI;
- deployment topology.

Any implementation technology is acceptable only if it satisfies these contracts and the fail-first acceptance suite.