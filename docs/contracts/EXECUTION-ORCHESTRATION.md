# Durable Execution Orchestration Contracts v1

Status: DRAFT CONTRACT
Depends on: `RFC-003 — Durable Execution Orchestration`

## 1. Purpose

Define strict boundaries between committed Engineering Graph authority, durable execution orchestration, and executor adapters.

## 2. Node execution disposition

Every `NodeDefinition` MUST declare:

```text
executionMode: control | dispatch
```

- `control`: the node does not create an external execution intent by activation alone.
- `dispatch`: activation creates a durable execution intent before any executor call.

This field belongs to the immutable graph definition and MUST NOT be inferred from node kind, prose, or runtime model output.

Changing `executionMode` requires a new graph version after activation.

## 3. Execution identity

`ExecutionId` is opaque to authorization/business logic but MUST be stable for one authoritative execution attempt.

The v1 derivation contract is:

```text
execution_id = deterministic(run_id, graph_version, source_journal_sequence, node_id, attempt)
```

The concrete string encoding/hash is an implementation detail, but the same inputs MUST always produce the same ID and different attempts MUST produce different IDs.

## 4. ExecutionIntent

```text
ExecutionIntent
  executionId
  runId
  graphId
  graphVersion
  nodeId
  sourceJournalSequence
  sourceOperationId
  attempt
  status
  boundArtifactIds[]
  boundEvidenceIds[]
  boundApprovalIds[]
  executorPolicyId?
  createdAt
```

Initial status at projection is `PENDING`.

Contracts:

- `attempt` MUST be a positive integer;
- source journal identity MUST be immutable;
- one source activation + attempt maps to one execution ID;
- intent input bindings are immutable after creation;
- an existing execution ID with different immutable intent content is an integrity conflict, not an update.

## 5. Projection source mapping

### transition_committed

Projection resolves the referenced immutable graph version and edge.

If destination node is `executionMode=dispatch`, create one intent with:

- attempt `1` for normal activation;
- bound artifact/evidence/approval IDs copied from the committed `TransitionDecision`;
- executor policy from destination node when declared.

If destination node is `executionMode=control`, no intent is created.

### retry_activated

If activation node is `dispatch`, create one intent with `attempt=nextAttempt`.

Bindings for a retry are resolved from the authoritative orchestration/application context defined by later contracts; v1 projection MUST NOT invent bindings from prose.

### recovery_activated

If recovery node is `dispatch`, create one intent. Initial recovery attempt defaults to `1` unless an explicit future recovery-attempt contract supersedes it.

### run_created / failure_recorded

No execution intent is created.

## 6. ProjectionCheckpoint

```text
ProjectionCheckpoint
  projectorId
  runId
  processedThroughSequence
```

Rules:

- sequence is inclusive;
- no checkpoint means nothing has been processed;
- checkpoint MUST advance contiguously;
- entry N+1 MUST NOT be checkpointed if N has not been successfully considered;
- checkpoint update and any intent insertions derived from that entry MUST commit atomically in the `ExecutionStore`.

## 7. ExecutionStore port

Conceptual methods:

```text
project(entry, graphDefinition, derivedIntents, expectedCheckpoint)
getCheckpoint(projectorId, runId)
getExecution(executionId)
listPending(limit)
claim(executionId, claimRequest)
markRunning(executionId, leaseToken, executorRef)
recordResult(executionId, leaseToken, result)
releaseOrExpire(...)
```

The exact TypeScript surface is normative in `contracts/execution.ts`.

Expected semantic failures use discriminated result types, not arbitrary exceptions.

## 8. Atomic projection contract

For one journal sequence, the execution store MUST atomically:

1. verify expected checkpoint;
2. validate source sequence is exactly the next sequence;
3. insert all newly derived intents idempotently;
4. reject conflicting duplicate execution IDs;
5. advance checkpoint to source sequence.

A crash cannot leave an intent committed without the corresponding checkpoint decision or a checkpoint advanced without its intents.

Replaying an already checkpointed source is a no-op/replay outcome, not duplicate execution creation.

## 9. Claim contract

`claim` requires:

- execution ID;
- worker ID;
- claim/lease ID;
- current time;
- lease expiration time.

A claim succeeds only when:

- intent is `PENDING`; or
- prior claim lease has expired and status is reclaimable.

An unexpired `CLAIMED`/`RUNNING` lease MUST reject competing claims.

Claim acquisition and persisted lease metadata MUST be atomic.

## 10. Lease contract

A lease contains:

```text
leaseId
workerId
claimedAt
expiresAt
```

Rules:

- `expiresAt > claimedAt`;
- lease IDs are stable for one claim;
- state-changing claim/result methods require the current lease ID;
- stale lease tokens MUST be rejected;
- time is an explicit input/clock dependency.

## 11. Dispatch ordering

The only valid order is:

```text
ExecutionIntent durable
   -> Claim durable
   -> ExecutorPort.start
```

Calling an executor before durable intent/claim is a contract violation.

## 12. ExecutorPort

Generic executor boundary:

```text
start(request): ExecutorStartResult
getStatus(executionId): ExecutorStatusResult
```

`start` request includes stable execution identity and immutable declared inputs.

Minimum start outcomes:

- `STARTED`
- `ALREADY_STARTED`
- `ALREADY_COMPLETED`
- `REJECTED`

Infrastructure failure MAY reject/throw when no trustworthy semantic result exists. The caller MUST reconcile using the same execution ID before generating any new attempt.

## 13. Executor status

Minimum reconciliation states:

- `NOT_FOUND`
- `RUNNING`
- `SUCCEEDED`
- `FAILED`
- `UNKNOWN`

For terminal results, executor status includes a stable result reference/payload contract rather than granting graph authority.

## 14. Executor idempotency requirement

For one `ExecutionId`:

- repeated `start` MUST NOT create independent duplicate work if the executor reports `ALREADY_STARTED`/`ALREADY_COMPLETED`; or
- `getStatus` MUST provide sufficient reconciliation before retry.

AI-STACK MUST reuse the same execution ID for uncertainty/replay of the same attempt.

## 15. Result persistence

`ExecutionResult` minimum fields:

```text
executionId
outcome: SUCCEEDED | FAILED
resultRef?
errorCode?
completedAt
```

Rules:

- result is persisted in `ExecutionStore` before graph progression;
- a terminal result is immutable for one execution ID;
- conflicting second terminal result is an integrity violation;
- terminal result alone does not mutate Engineering Graph state.

## 16. Status transitions

Allowed v1 orchestration transitions:

```text
PENDING -> CLAIMED
CLAIMED -> RUNNING
RUNNING -> SUCCEEDED
RUNNING -> FAILED
CLAIMED -> SUCCEEDED | FAILED   # allowed when executor already completed before RUNNING persistence
CLAIMED -> PENDING              # only via expired-lease reclaim/release semantics
```

Forbidden examples:

- `PENDING -> SUCCEEDED` without a conforming executor/reconciliation path;
- terminal -> non-terminal;
- `SUCCEEDED -> FAILED`;
- mutation under stale lease.

## 17. GraphDefinitionRegistry

Projection requires a read-only port:

```text
get(graphId, graphVersion): FOUND | NOT_FOUND | INTEGRITY_ERROR
```

Returned graph definition MUST exactly match requested ID/version and pass graph-definition validation before projection uses it.

The registry is read-only from the projector's perspective.

## 18. Projector contract

The projector MUST be deterministic over:

- one authoritative journal entry;
- exact immutable graph definition;
- explicit time/ID derivation inputs where applicable.

It MUST NOT:

- call an executor;
- mutate graph authority;
- skip journal entries;
- invent an executor choice from prose;
- infer success/failure from model narrative.

## 19. Dispatcher contract

The dispatcher:

1. obtains durable pending intents;
2. claims one intent;
3. invokes the selected `ExecutorPort` using stable execution ID;
4. reconciles unknown/duplicate-start states;
5. persists running/terminal execution state;
6. never writes graph authority directly.

Executor selection is deterministic configuration/policy input and remains separate from model prose.

## 20. Failure classes

Initial orchestration failure classes:

- `PROJECTION_INTEGRITY_FAILURE`
- `CHECKPOINT_CONFLICT`
- `CLAIM_CONFLICT`
- `LEASE_EXPIRED`
- `STALE_LEASE`
- `EXECUTOR_REJECTED`
- `EXECUTOR_OUTCOME_UNKNOWN`
- `RESULT_CONFLICT`
- `GRAPH_DEFINITION_MISSING`
- `GRAPH_DEFINITION_INVALID`

These are orchestration concepts, distinct from task-level `FailureRecord` classes in graph authority.

## 21. Authority boundary

`ExecutionStore` state is durable but derivative.

Authority priority:

1. immutable graph definition + authoritative graph journal;
2. execution projection derived from that authority;
3. executor runtime observations;
4. validated artifacts/evidence produced from results.

No execution-store status can override a contradictory authoritative graph record by itself.

## 22. Implementation block

No production projector, execution-store adapter, dispatcher, or OMP executor adapter may be written until:

1. strict TypeScript contracts exist;
2. fail-first executable tests for the relevant component exist;
3. RED is observed for the correct missing behavior;
4. implementation scope is limited to the tested component.