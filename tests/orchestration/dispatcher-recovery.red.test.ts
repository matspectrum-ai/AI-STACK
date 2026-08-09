import { describe, expect, test } from "bun:test";
import type {
  ExecutorPort,
  ExecutorReference,
  WorkerId,
} from "../../contracts/execution";
import {
  asExecutorRef,
  asLeaseId,
  lease,
  seedPending,
  terminalResult,
} from "./execution-store-fixtures";
import { createDispatcherTestEnvironment } from "./dispatcher-test-env";

const EXECUTOR_REF = "executor:reconciled" as ExecutorReference;

describe("generic execution dispatcher: restart/reconciliation", () => {
  test("ORCH-039: RUNNING reconciliation restores local RUNNING state", async () => {
    const env = await createDispatcherTestEnvironment();
    try {
      const intent = await seedPending(env.storage.store);
      const currentLease = lease(
        asLeaseId("lease:same-worker"),
        env.workerId,
        env.clock.current,
        "2026-08-09T07:10:00.000Z",
      );
      await env.storage.store.claim({
        executionId: intent.executionId,
        lease: currentLease,
        now: env.clock.current,
      });
      env.fake.pushStatus({ status: "RUNNING", executorRef: EXECUTOR_REF });

      const result = await env.dispatcher.reconcile(intent.executionId);
      expect(result.status).toBe("RUNNING");
      expect(env.fake.statusCalls).toEqual([intent.executionId]);
      const stored = await env.storage.store.getExecution(intent.executionId);
      expect(stored?.status).toBe("RUNNING");
      expect(stored?.executorRef).toBe(EXECUTOR_REF);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-040: terminal reconciliation persists terminal result", async () => {
    const env = await createDispatcherTestEnvironment();
    try {
      const intent = await seedPending(env.storage.store);
      await env.storage.store.claim({
        executionId: intent.executionId,
        lease: lease(
          asLeaseId("lease:terminal-reconcile"),
          env.workerId,
          env.clock.current,
          "2026-08-09T07:10:00.000Z",
        ),
        now: env.clock.current,
      });
      const completed = terminalResult(intent.executionId, "FAILED", "reconciled");
      env.fake.pushStatus({
        status: "FAILED",
        executorRef: EXECUTOR_REF,
        result: completed,
      });

      const result = await env.dispatcher.reconcile(intent.executionId);
      expect(result.status).toBe("TERMINAL");
      if (result.status !== "TERMINAL") throw new Error("expected terminal");
      expect(result.result).toEqual(completed);
      expect((await env.storage.store.getExecution(intent.executionId))?.terminalResult).toEqual(
        completed,
      );
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-050: restart after actual start reclaims expired lease and reconciles same identity", async () => {
    const env = await createDispatcherTestEnvironment({ now: "2026-08-09T07:00:00.000Z" });
    try {
      const intent = await seedPending(env.storage.store);
      const oldWorker = "worker:dead" as WorkerId;
      await env.storage.store.claim({
        executionId: intent.executionId,
        lease: lease(
          asLeaseId("lease:dead"),
          oldWorker,
          "2026-08-09T06:50:00.000Z",
          "2026-08-09T06:55:00.000Z",
        ),
        now: "2026-08-09T06:50:00.000Z",
      });
      env.fake.pushStatus({ status: "RUNNING", executorRef: EXECUTOR_REF });

      const result = await env.dispatcher.reconcile(intent.executionId);
      expect(result.status).toBe("RUNNING");
      expect(env.fake.statusCalls).toEqual([intent.executionId]);
      const stored = await env.storage.store.getExecution(intent.executionId);
      expect(stored?.intent.executionId).toBe(intent.executionId);
      expect(stored?.intent.attempt).toBe(intent.attempt);
      expect(stored?.lease?.workerId).toBe(env.workerId);
      expect(stored?.status).toBe("RUNNING");
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-051: restart after external completion recovers result with same identity", async () => {
    const env = await createDispatcherTestEnvironment({ now: "2026-08-09T07:00:00.000Z" });
    try {
      const intent = await seedPending(env.storage.store);
      const oldWorker = "worker:dead" as WorkerId;
      await env.storage.store.claim({
        executionId: intent.executionId,
        lease: lease(
          asLeaseId("lease:dead-terminal"),
          oldWorker,
          "2026-08-09T06:50:00.000Z",
          "2026-08-09T06:55:00.000Z",
        ),
        now: "2026-08-09T06:50:00.000Z",
      });
      const completed = terminalResult(intent.executionId, "SUCCEEDED", "restart");
      env.fake.pushStatus({
        status: "SUCCEEDED",
        executorRef: EXECUTOR_REF,
        result: completed,
      });

      const result = await env.dispatcher.reconcile(intent.executionId);
      expect(result.status).toBe("TERMINAL");
      expect(env.fake.statusCalls).toEqual([intent.executionId]);
      const stored = await env.storage.store.getExecution(intent.executionId);
      expect(stored?.intent.executionId).toBe(intent.executionId);
      expect(stored?.terminalResult).toEqual(completed);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-052: durable terminal result survives application gap without redispatch", async () => {
    const env = await createDispatcherTestEnvironment();
    try {
      const intent = await seedPending(env.storage.store);
      const terminalLease = lease(
        asLeaseId("lease:already-terminal"),
        env.workerId,
        env.clock.current,
        "2026-08-09T07:10:00.000Z",
      );
      await env.storage.store.claim({
        executionId: intent.executionId,
        lease: terminalLease,
        now: env.clock.current,
      });
      await env.storage.store.markRunning({
        executionId: intent.executionId,
        leaseId: terminalLease.leaseId,
        executorRef: asExecutorRef("executor:done"),
        now: env.clock.current,
      });
      const completed = terminalResult(intent.executionId, "SUCCEEDED", "durable-gap");
      await env.storage.store.recordResult({
        executionId: intent.executionId,
        leaseId: terminalLease.leaseId,
        result: completed,
        now: env.clock.current,
      });

      const result = await env.dispatcher.dispatch(intent.executionId);
      expect(result.status).toBe("TERMINAL");
      expect(env.fake.startCalls).toHaveLength(0);
      expect(env.fake.statusCalls).toHaveLength(0);
      expect((await env.storage.store.getExecution(intent.executionId))?.terminalResult).toEqual(
        completed,
      );
    } finally {
      await env.cleanup();
    }
  });

  test("uncertain UNKNOWN status remains outcome-unknown and never blind-restarts", async () => {
    const env = await createDispatcherTestEnvironment();
    try {
      const intent = await seedPending(env.storage.store);
      env.fake.pushStart({ kind: "throw", error: new Error("connection dropped") });
      env.fake.pushStatus({ status: "UNKNOWN" });

      const result = await env.dispatcher.dispatch(intent.executionId);
      expect(result).toEqual({ status: "OUTCOME_UNKNOWN", executionId: intent.executionId });
      expect(env.fake.startCalls).toHaveLength(1);
      expect(env.fake.statusCalls).toEqual([intent.executionId]);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-055: generic ExecutorPort surface contains no graph-authority methods", () => {
    const port: ExecutorPort = {
      async start() {
        throw new Error("unused");
      },
      async getStatus() {
        return { status: "NOT_FOUND" };
      },
    };

    expect(Object.keys(port).sort()).toEqual(["getStatus", "start"]);
    expect("commit" in port).toBe(false);
    expect("approve" in port).toBe(false);
    expect("transition" in port).toBe(false);
    expect("writeJournal" in port).toBe(false);
  });
});
