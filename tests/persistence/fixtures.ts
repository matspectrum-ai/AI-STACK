import type {
  ContentDigest,
  FailureRecord,
  GraphRunState,
  StateRevision,
  TransitionDecision,
  TransitionId,
} from "../../contracts/domain";
import type {
  CommitStateRequest,
  CreateRunRequest,
  OperationId,
} from "../../contracts/persistence";
import type { PersistenceClock } from "../../contracts/sqlite-persistence";

export const asOperationId = (value: string) => value as OperationId;
export const asDigest = (value: string) => value as ContentDigest;
export const asRevision = (value: number) => value as StateRevision;
export const asTransitionId = (value: string) => value as TransitionId;

export const IDS = {
  run: "run:persistence" as GraphRunState["runId"],
  graph: "graph:persistence" as GraphRunState["graphId"],
  active: "node:active" as GraphRunState["activeNodeIds"][number],
  implementation: "node:implementation" as GraphRunState["activeNodeIds"][number],
  recovery: "node:recovery" as GraphRunState["activeNodeIds"][number],
  edge: "edge:transition" as TransitionDecision["edgeId"],
  recoveryEdge: "edge:recovery" as TransitionDecision["edgeId"],
  executor: "executor:test" as TransitionDecision["evaluatedGateResults"][number]["gateId"] extends never
    ? never
    : any,
  failure: "failure:test" as FailureRecord["failureId"],
  retryPolicy: "retry:policy" as any,
} as const;

export class DeterministicClock implements PersistenceClock {
  readonly #timestamps: string[];
  #index = 0;

  constructor(
    timestamps: readonly string[] = [
      "2026-08-09T05:30:00.000Z",
      "2026-08-09T05:30:01.000Z",
      "2026-08-09T05:30:02.000Z",
      "2026-08-09T05:30:03.000Z",
      "2026-08-09T05:30:04.000Z",
      "2026-08-09T05:30:05.000Z",
      "2026-08-09T05:30:06.000Z",
      "2026-08-09T05:30:07.000Z",
    ],
  ) {
    this.#timestamps = [...timestamps];
  }

  now(): string {
    const value = this.#timestamps[Math.min(this.#index, this.#timestamps.length - 1)];
    this.#index += 1;
    if (!value) throw new Error("deterministic clock requires at least one timestamp");
    return value;
  }
}

export function state(
  revision = 0,
  overrides: Partial<GraphRunState> = {},
): GraphRunState {
  return {
    runId: IDS.run,
    graphId: IDS.graph,
    graphVersion: "1",
    revision: asRevision(revision),
    activeNodeIds: [IDS.active],
    completedExecutionIds: [],
    artifactRefs: [],
    evidenceRefs: [],
    approvalRefs: [],
    failureRefs: [],
    retryCounters: {},
    ...overrides,
  };
}

export function createRunRequest(
  operationId = asOperationId("op:create"),
  digest = asDigest("sha256:create"),
  initialState = state(0),
): CreateRunRequest {
  return { operationId, operationDigest: digest, initialState };
}

export function transitionDecision(
  before: number,
  transitionId = asTransitionId(`transition:${before + 1}`),
): TransitionDecision {
  return {
    transitionId,
    runId: IDS.run,
    graphId: IDS.graph,
    graphVersion: "1",
    edgeId: IDS.edge,
    decision: "ALLOW",
    reasonCodes: [],
    evaluatedGateResults: [],
    evaluatedPolicyResults: [],
    boundArtifactIds: [],
    boundApprovalIds: [],
    boundEvidenceIds: [],
    evaluatedStateRevision: asRevision(before),
    stateRevisionBefore: asRevision(before),
    stateRevisionAfter: asRevision(before + 1),
  };
}

export function transitionCommit(
  expectedRevision: number,
  operationId = asOperationId(`op:transition:${expectedRevision + 1}`),
  digest = asDigest(`sha256:transition:${expectedRevision + 1}`),
  overrides: Partial<CommitStateRequest> = {},
): CommitStateRequest {
  const decision = transitionDecision(expectedRevision);
  const nextState = state(expectedRevision + 1, {
    activeNodeIds: [IDS.implementation],
    lastTransitionId: decision.transitionId,
  });

  return {
    operationId,
    operationDigest: digest,
    runId: IDS.run,
    expectedRevision: asRevision(expectedRevision),
    operation: { kind: "transition_committed", decision },
    nextState,
    ...overrides,
  };
}

export function failureRecord(): FailureRecord {
  return {
    failureId: IDS.failure,
    failureClass: "EXECUTION_FAILURE",
    subjectRef: IDS.implementation,
    reasonCode: "GATE_FAILED",
    retryability: "RETRYABLE",
    evidenceIds: [],
    observedAt: "2026-08-09T05:30:00.000Z",
  };
}

export function failureCommit(expectedRevision: number): CommitStateRequest {
  const failure = failureRecord();
  return {
    operationId: asOperationId(`op:failure:${expectedRevision + 1}`),
    operationDigest: asDigest(`sha256:failure:${expectedRevision + 1}`),
    runId: IDS.run,
    expectedRevision: asRevision(expectedRevision),
    operation: { kind: "failure_recorded", failure },
    nextState: state(expectedRevision + 1, {
      activeNodeIds: [IDS.implementation],
      failureRefs: [failure.failureId],
    }),
  };
}

export function retryCommit(
  expectedRevision: number,
  nextAttempt: number,
): CommitStateRequest {
  return {
    operationId: asOperationId(`op:retry:${expectedRevision + 1}`),
    operationDigest: asDigest(`sha256:retry:${expectedRevision + 1}`),
    runId: IDS.run,
    expectedRevision: asRevision(expectedRevision),
    operation: {
      kind: "retry_activated",
      governingFailureId: IDS.failure,
      retryPolicyId: IDS.retryPolicy,
      retryCounterKey: "implementation",
      nextAttempt,
      activationNodeId: IDS.implementation,
    },
    nextState: state(expectedRevision + 1, {
      activeNodeIds: [IDS.implementation],
      failureRefs: [IDS.failure],
      retryCounters: { implementation: nextAttempt },
    }),
  };
}

export function recoveryCommit(expectedRevision: number): CommitStateRequest {
  return {
    operationId: asOperationId(`op:recovery:${expectedRevision + 1}`),
    operationDigest: asDigest(`sha256:recovery:${expectedRevision + 1}`),
    runId: IDS.run,
    expectedRevision: asRevision(expectedRevision),
    operation: {
      kind: "recovery_activated",
      governingFailureId: IDS.failure,
      recoveryEdgeId: IDS.recoveryEdge,
      recoveryNodeId: IDS.recovery,
    },
    nextState: state(expectedRevision + 1, {
      activeNodeIds: [IDS.recovery],
      failureRefs: [IDS.failure],
    }),
  };
}
