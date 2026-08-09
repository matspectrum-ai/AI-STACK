import type { GraphRunState } from "../../../contracts/domain";
import type {
  CommitStateRequest,
  PersistenceIntegrityCode,
} from "../../../contracts/persistence";

export interface PersistedRunIdentity {
  readonly runId: GraphRunState["runId"];
  readonly graphId: GraphRunState["graphId"];
  readonly graphVersion: string;
  readonly state: GraphRunState;
}

export function validateInitialState(
  state: GraphRunState,
): PersistenceIntegrityCode | undefined {
  if (Number(state.revision) !== 0) return "INVALID_COMMIT_STRUCTURE";
  if (!state.runId || !state.graphId || !state.graphVersion) {
    return "INVALID_COMMIT_STRUCTURE";
  }
  return undefined;
}

export function validateCommitStructure(
  request: CommitStateRequest,
  current: PersistedRunIdentity,
): PersistenceIntegrityCode | undefined {
  const next = request.nextState;
  const expected = Number(request.expectedRevision);

  if (next.runId !== request.runId || request.runId !== current.runId) {
    return "INVALID_COMMIT_STRUCTURE";
  }

  if (
    next.graphId !== current.graphId ||
    next.graphVersion !== current.graphVersion
  ) {
    return "GRAPH_BINDING_MISMATCH";
  }

  if (Number(next.revision) !== expected + 1) {
    return "INVALID_COMMIT_STRUCTURE";
  }

  switch (request.operation.kind) {
    case "transition_committed": {
      const decision = request.operation.decision;
      if (
        decision.runId !== request.runId ||
        decision.graphId !== current.graphId ||
        decision.graphVersion !== current.graphVersion
      ) {
        return "GRAPH_BINDING_MISMATCH";
      }
      if (
        Number(decision.stateRevisionBefore) !== expected ||
        decision.stateRevisionAfter === undefined ||
        Number(decision.stateRevisionAfter) !== expected + 1 ||
        next.lastTransitionId !== decision.transitionId
      ) {
        return "INVALID_COMMIT_STRUCTURE";
      }
      return undefined;
    }

    case "failure_recorded":
      return next.failureRefs.includes(request.operation.failure.failureId)
        ? undefined
        : "INVALID_COMMIT_STRUCTURE";

    case "retry_activated": {
      const operation = request.operation;
      if (!current.state.failureRefs.includes(operation.governingFailureId)) {
        return "INVALID_COMMIT_STRUCTURE";
      }
      if (!Number.isInteger(operation.nextAttempt) || operation.nextAttempt < 1) {
        return "INVALID_COMMIT_STRUCTURE";
      }
      const previous = current.state.retryCounters[operation.retryCounterKey] ?? 0;
      if (operation.nextAttempt !== previous + 1) {
        return "INVALID_COMMIT_STRUCTURE";
      }
      if (next.retryCounters[operation.retryCounterKey] !== operation.nextAttempt) {
        return "INVALID_COMMIT_STRUCTURE";
      }
      if (!next.activeNodeIds.includes(operation.activationNodeId)) {
        return "INVALID_COMMIT_STRUCTURE";
      }
      return undefined;
    }

    case "recovery_activated":
      if (!current.state.failureRefs.includes(request.operation.governingFailureId)) {
        return "INVALID_COMMIT_STRUCTURE";
      }
      return next.activeNodeIds.includes(request.operation.recoveryNodeId)
        ? undefined
        : "INVALID_COMMIT_STRUCTURE";
  }
}
