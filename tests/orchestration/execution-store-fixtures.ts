import type {
  ExecutionId,
  ExecutionIntent,
  ExecutionLease,
  ExecutionResult,
  LeaseId,
  ProjectorId,
  WorkerId,
  ExecutorReference,
  ExecutionResultReference,
} from "../../contracts/execution";
import type { DurableExecutionStore } from "../../contracts/execution-store";
import type { JournalEntry } from "../../contracts/persistence";
import { createExecutionProjector } from "../../src/orchestration/projector/create-execution-projector";
import {
  IDS,
  asOperationId,
  asRevision,
  asSequence,
  graph,
  runCreatedEntry,
  transitionEntry,
} from "./projector-fixtures";

export const PROJECTOR_ID = "projector:execution-store" as ProjectorId;
export const WORKER_A = "worker:a" as WorkerId;
export const WORKER_B = "worker:b" as WorkerId;

export const TIMES = {
  t0: "2026-08-09T06:00:00.000Z",
  t1: "2026-08-09T06:00:01.000Z",
  t2: "2026-08-09T06:00:02.000Z",
  t3: "2026-08-09T06:00:03.000Z",
  t4: "2026-08-09T06:00:04.000Z",
  t5: "2026-08-09T06:00:05.000Z",
} as const;

const projector = createExecutionProjector();
const executionGraph = graph();

export const asLeaseId = (value: string) => value as LeaseId;
export const asExecutorRef = (value: string) => value as ExecutorReference;
export const asResultRef = (value: string) => value as ExecutionResultReference;

export function sourceEntry(sequence: number): JournalEntry {
  if (sequence === 0) return runCreatedEntry();
  return transitionEntry(IDS.transitionEdge, {
    sequence: asSequence(sequence),
    operationId: asOperationId(`op:${sequence}`),
    resultingStateRevision: asRevision(sequence),
  });
}

export function derivedIntents(
  entry: JournalEntry,
  createdAt = TIMES.t0,
): readonly ExecutionIntent[] {
  const result = projector.derive(entry, executionGraph, createdAt);
  if (result.status !== "PROJECTED") {
    throw new Error(`fixture projection failed: ${result.code}`);
  }
  return result.projection.intents;
}

export function projectionRequest(sequence: number) {
  const entry = sourceEntry(sequence);
  const base = {
    projectorId: PROJECTOR_ID,
    entry,
    graph: executionGraph,
    derivedIntents: derivedIntents(entry),
  };

  return sequence === 0
    ? base
    : { ...base, expectedCheckpoint: asSequence(sequence - 1) };
}

export async function projectSequence(
  store: DurableExecutionStore,
  sequence: number,
) {
  return store.projectJournalEntry(projectionRequest(sequence));
}

export async function seedPending(
  store: DurableExecutionStore,
): Promise<ExecutionIntent> {
  const first = await projectSequence(store, 0);
  if (first.status !== "PROJECTED" && first.status !== "REPLAYED") {
    throw new Error(`failed to project sequence 0: ${first.status}`);
  }
  const second = await projectSequence(store, 1);
  if (second.status !== "PROJECTED" && second.status !== "REPLAYED") {
    throw new Error(`failed to project sequence 1: ${second.status}`);
  }
  const intents = derivedIntents(sourceEntry(1));
  const intent = intents[0];
  if (!intent) throw new Error("expected dispatch intent");
  return intent;
}

export function lease(
  leaseId: LeaseId,
  workerId: WorkerId,
  claimedAt: string,
  expiresAt: string,
): ExecutionLease {
  return { leaseId, workerId, claimedAt, expiresAt };
}

export function terminalResult(
  executionId: ExecutionId,
  outcome: "SUCCEEDED" | "FAILED" = "SUCCEEDED",
  suffix = "1",
): ExecutionResult {
  return {
    executionId,
    outcome,
    resultRef: asResultRef(`result:${suffix}`),
    ...(outcome === "FAILED" ? { errorCode: `ERR_${suffix}` } : {}),
    completedAt: TIMES.t4,
  };
}
