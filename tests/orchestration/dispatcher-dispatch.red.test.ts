import { describe, expect, test } from "bun:test";
import type {
  ExecutionId,
  ExecutorReference,
  WorkerId,
} from "../../contracts/execution";
import {
  asLeaseId,
  lease,
  seedPending,
  terminalResult,
} from "./execution-store-fixtures";
import { createDispatcherTestEnvironment } from "./dispatcher-test-env";

const EXECUTOR_REF = "executor:fake:1" as ExecutorReference;

describe("generic execution dispatcher: durable delivery", () => {
  test("ORCH-031: no durable intent means no executor start", async () => {
    const env = await createDispatcherTestEnvironment();
    try {
      const missing = "execution:missing" as ExecutionId;
      const result = await env.dispatcher.dispatch(missing);
      expect(result).toEqual({ status: "NOT_FOUND", executionId: missing });
      expect(env.fake.startCalls).toHaveLength(0);
      expect(env.fake.statusCalls).toHaveLength(0);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-032: dispatcher does not start when durable claim is unavailable", async () => {
    const env = await createDispatcherTestEnvironment();
    try {
      const intent = await seedPending(env.storage.store);
      const otherWorker = "worker:other" as WorkerId;
      await env.storage.store.claim({
        executionId: intent.executionId,
        lease: lease(
          asLeaseId("lease:other"),
          otherWorker,
          env.clock.current,
          "2026-08-09T07:10:00.000Z",
        ),
        now: env.clock.current,
      });

      const result = await env.dispatcher.dispatch(intent.executionId);
      expect(result.status).toBe("CLAIM_UNAVAILABLE");
      if (result.status !== "CLAIM_UNAVAILABLE") throw new Error("expected unavailable");
      expect(result.reason).toBe("CLAIM_CONFLICT");
      expect(env.fake.startCalls).toHaveLength(0);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-033/034: STARTED uses exact durable identity/bindings and becomes RUNNING", async () => {
    const env = await createDispatcherTestEnvironment();
    try {
      const intent = await seedPending(env.storage.store);
      env.fake.pushStart({
        kind: "return",
        value: { status: "STARTED", executorRef: EXECUTOR_REF },
      });

      const result = await env.dispatcher.dispatch(intent.executionId);
      expect(result.status).toBe("RUNNING");
      if (result.status !== "RUNNING") throw new Error("expected RUNNING");
      expect(result.execution.intent.executionId).toBe(intent.executionId);
      expect(result.execution.executorRef).toBe(EXECUTOR_REF);

      expect(env.fake.startCalls).toHaveLength(1);
      expect(env.fake.startCalls[0]).toEqual({
        executionId: intent.executionId,
        runId: intent.runId,
        graphId: intent.graphId,
        graphVersion: intent.graphVersion,
        nodeId: intent.nodeId,
        attempt: intent.attempt,
        boundArtifactIds: intent.boundArtifactIds,
        boundEvidenceIds: intent.boundEvidenceIds,
        boundApprovalIds: intent.boundApprovalIds,
      });

      const durable = await env.storage.store.getExecution(intent.executionId);
      expect(durable?.status).toBe("RUNNING");
      expect(durable?.executorRef).toBe(EXECUTOR_REF);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-035: ALREADY_STARTED reconciles same execution instead of duplicating", async () => {
    const env = await createDispatcherTestEnvironment();
    try {
      const intent = await seedPending(env.storage.store);
      env.fake.pushStart({
        kind: "return",
        value: { status: "ALREADY_STARTED", executorRef: EXECUTOR_REF },
      });

      const result = await env.dispatcher.dispatch(intent.executionId);
      expect(result.status).toBe("RUNNING");
      expect(env.fake.startCalls).toHaveLength(1);
      expect(env.fake.startCalls[0]?.executionId).toBe(intent.executionId);
      expect((await env.storage.store.getExecution(intent.executionId))?.intent.attempt).toBe(
        intent.attempt,
      );
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-036: ALREADY_COMPLETED persists terminal result without another start", async () => {
    const env = await createDispatcherTestEnvironment();
    try {
      const intent = await seedPending(env.storage.store);
      const completed = terminalResult(intent.executionId, "SUCCEEDED", "already");
      env.fake.pushStart({
        kind: "return",
        value: {
          status: "ALREADY_COMPLETED",
          executorRef: EXECUTOR_REF,
          result: completed,
        },
      });

      const result = await env.dispatcher.dispatch(intent.executionId);
      expect(result.status).toBe("TERMINAL");
      if (result.status !== "TERMINAL") throw new Error("expected terminal");
      expect(result.result).toEqual(completed);
      expect(env.fake.startCalls).toHaveLength(1);
      expect((await env.storage.store.getExecution(intent.executionId))?.terminalResult).toEqual(
        completed,
      );
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-037: uncertain start reconciles with getStatus using same execution ID", async () => {
    const env = await createDispatcherTestEnvironment();
    try {
      const intent = await seedPending(env.storage.store);
      env.fake.pushStart({ kind: "throw", error: new Error("transport lost") });
      env.fake.pushStatus({ status: "RUNNING", executorRef: EXECUTOR_REF });

      const result = await env.dispatcher.dispatch(intent.executionId);
      expect(result.status).toBe("RUNNING");
      expect(env.fake.startCalls.map((call) => call.executionId)).toEqual([
        intent.executionId,
      ]);
      expect(env.fake.statusCalls).toEqual([intent.executionId]);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-038: NOT_FOUND after uncertainty retries later with same identity/attempt", async () => {
    const env = await createDispatcherTestEnvironment();
    try {
      const intent = await seedPending(env.storage.store);
      env.fake.pushStart(
        { kind: "throw", error: new Error("unknown start outcome") },
        { kind: "return", value: { status: "STARTED", executorRef: EXECUTOR_REF } },
      );
      env.fake.pushStatus({ status: "NOT_FOUND" });

      const first = await env.dispatcher.dispatch(intent.executionId);
      expect(first).toEqual({ status: "RETRY_SAME_ID", executionId: intent.executionId });

      const second = await env.dispatcher.dispatch(intent.executionId);
      expect(second.status).toBe("RUNNING");
      expect(env.fake.startCalls).toHaveLength(2);
      expect(env.fake.startCalls[0]?.executionId).toBe(intent.executionId);
      expect(env.fake.startCalls[1]?.executionId).toBe(intent.executionId);
      expect(env.fake.startCalls[0]?.attempt).toBe(intent.attempt);
      expect(env.fake.startCalls[1]?.attempt).toBe(intent.attempt);
    } finally {
      await env.cleanup();
    }
  });

  test("executor REJECTED is explicit and does not manufacture terminal state", async () => {
    const env = await createDispatcherTestEnvironment();
    try {
      const intent = await seedPending(env.storage.store);
      env.fake.pushStart({
        kind: "return",
        value: { status: "REJECTED", errorCode: "NO_CAPACITY" },
      });

      const result = await env.dispatcher.dispatch(intent.executionId);
      expect(result).toEqual({
        status: "EXECUTOR_REJECTED",
        executionId: intent.executionId,
        errorCode: "NO_CAPACITY",
      });
      const stored = await env.storage.store.getExecution(intent.executionId);
      expect(stored?.terminalResult).toBeUndefined();
      expect(stored?.status).toBe("CLAIMED");
    } finally {
      await env.cleanup();
    }
  });
});
