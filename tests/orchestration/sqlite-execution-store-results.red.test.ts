import { describe, expect, test } from "bun:test";
import type { ExecutionId } from "../../contracts/execution";
import {
  TIMES,
  WORKER_A,
  WORKER_B,
  asExecutorRef,
  asLeaseId,
  lease,
  seedPending,
  terminalResult,
} from "./execution-store-fixtures";
import { createSqliteExecutionStoreTestEnvironment } from "./execution-store-test-env";

const LEASE_A = asLeaseId("lease:result:a");
const LEASE_B = asLeaseId("lease:result:b");

async function seedRunning(store: Parameters<typeof seedPending>[0]) {
  const intent = await seedPending(store);
  await store.claim({
    executionId: intent.executionId,
    lease: lease(LEASE_A, WORKER_A, TIMES.t0, TIMES.t5),
    now: TIMES.t0,
  });
  await store.markRunning({
    executionId: intent.executionId,
    leaseId: LEASE_A,
    executorRef: asExecutorRef("executor:result"),
    now: TIMES.t1,
  });
  return intent;
}

describe("SQLite ExecutionStore: terminal results and restart", () => {
  test("ORCH-041: successful result becomes immutable terminal state", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedRunning(env.store);
      const resultValue = terminalResult(intent.executionId, "SUCCEEDED", "success");
      const result = await env.store.recordResult({
        executionId: intent.executionId,
        leaseId: LEASE_A,
        result: resultValue,
        now: TIMES.t2,
      });
      expect(result.status).toBe("RECORDED");
      if (result.status !== "RECORDED") throw new Error("expected RECORDED");
      expect(result.execution.status).toBe("SUCCEEDED");
      expect(result.execution.terminalResult).toEqual(resultValue);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-042: failed result becomes immutable FAILED state", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedRunning(env.store);
      const resultValue = terminalResult(intent.executionId, "FAILED", "failed");
      const result = await env.store.recordResult({
        executionId: intent.executionId,
        leaseId: LEASE_A,
        result: resultValue,
        now: TIMES.t2,
      });
      expect(result.status).toBe("RECORDED");
      if (result.status !== "RECORDED") throw new Error("expected RECORDED");
      expect(result.execution.status).toBe("FAILED");
      expect(result.execution.terminalResult).toEqual(resultValue);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-043: result execution ID must match request", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedRunning(env.store);
      const other = "execution:other" as ExecutionId;
      const result = await env.store.recordResult({
        executionId: intent.executionId,
        leaseId: LEASE_A,
        result: terminalResult(other, "SUCCEEDED", "mismatch"),
        now: TIMES.t2,
      });
      expect(result).toEqual({
        status: "INTEGRITY_ERROR",
        code: "INVALID_EXECUTION_TRANSITION",
      });
      expect((await env.store.getExecution(intent.executionId))?.status).toBe("RUNNING");
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-044: identical terminal replay is idempotent even after lease expiry", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedPending(env.store);
      const shortLease = lease(LEASE_A, WORKER_A, TIMES.t0, TIMES.t3);
      await env.store.claim({ executionId: intent.executionId, lease: shortLease, now: TIMES.t0 });
      await env.store.markRunning({
        executionId: intent.executionId,
        leaseId: LEASE_A,
        executorRef: asExecutorRef("executor:replay"),
        now: TIMES.t1,
      });
      const resultValue = terminalResult(intent.executionId, "SUCCEEDED", "replay");
      expect((await env.store.recordResult({
        executionId: intent.executionId,
        leaseId: LEASE_A,
        result: resultValue,
        now: TIMES.t2,
      })).status).toBe("RECORDED");

      const replay = await env.store.recordResult({
        executionId: intent.executionId,
        leaseId: LEASE_A,
        result: resultValue,
        now: TIMES.t4,
      });
      expect(replay.status).toBe("REPLAYED");
      if (replay.status !== "REPLAYED") throw new Error("expected REPLAYED");
      expect(replay.execution.terminalResult).toEqual(resultValue);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-045: conflicting terminal replay is rejected", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedRunning(env.store);
      const first = terminalResult(intent.executionId, "SUCCEEDED", "one");
      await env.store.recordResult({
        executionId: intent.executionId,
        leaseId: LEASE_A,
        result: first,
        now: TIMES.t2,
      });
      const conflict = await env.store.recordResult({
        executionId: intent.executionId,
        leaseId: LEASE_A,
        result: terminalResult(intent.executionId, "FAILED", "two"),
        now: TIMES.t3,
      });
      expect(conflict.status).toBe("RESULT_CONFLICT");
      expect((await env.store.getExecution(intent.executionId))?.terminalResult).toEqual(first);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-046: stale lease cannot record first terminal result", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedPending(env.store);
      await env.store.claim({
        executionId: intent.executionId,
        lease: lease(LEASE_A, WORKER_A, TIMES.t0, TIMES.t1),
        now: TIMES.t0,
      });
      await env.store.claim({
        executionId: intent.executionId,
        lease: lease(LEASE_B, WORKER_B, TIMES.t2, TIMES.t5),
        now: TIMES.t2,
      });
      await env.store.markRunning({
        executionId: intent.executionId,
        leaseId: LEASE_B,
        executorRef: asExecutorRef("executor:new"),
        now: TIMES.t2,
      });

      const result = await env.store.recordResult({
        executionId: intent.executionId,
        leaseId: LEASE_A,
        result: terminalResult(intent.executionId, "SUCCEEDED", "stale"),
        now: TIMES.t3,
      });
      expect(result.status).toBe("STALE_LEASE");
      expect((await env.store.getExecution(intent.executionId))?.status).toBe("RUNNING");
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-048: restart after projection exposes same pending intent", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedPending(env.store);
      await env.store.close();
      const reopened = await env.openAnother();
      const pending = await reopened.listPending({ limit: 10 });
      expect(pending.map((item) => item.intent.executionId)).toEqual([intent.executionId]);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-049: restart honors live lease then allows expiry reclaim", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedPending(env.store);
      const firstLease = lease(LEASE_A, WORKER_A, TIMES.t0, TIMES.t3);
      await env.store.claim({ executionId: intent.executionId, lease: firstLease, now: TIMES.t0 });
      await env.store.close();

      const reopened = await env.openAnother();
      const early = await reopened.claim({
        executionId: intent.executionId,
        lease: lease(LEASE_B, WORKER_B, TIMES.t1, TIMES.t5),
        now: TIMES.t1,
      });
      expect(early.status).toBe("CLAIM_CONFLICT");

      const late = await reopened.claim({
        executionId: intent.executionId,
        lease: lease(LEASE_B, WORKER_B, TIMES.t4, TIMES.t5),
        now: TIMES.t4,
      });
      expect(late.status).toBe("CLAIMED");
      if (late.status !== "CLAIMED") throw new Error("expected reclaimed claim");
      expect(late.execution.intent.executionId).toBe(intent.executionId);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-059: terminal result survives close/reopen", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedRunning(env.store);
      const resultValue = terminalResult(intent.executionId, "SUCCEEDED", "durable");
      await env.store.recordResult({
        executionId: intent.executionId,
        leaseId: LEASE_A,
        result: resultValue,
        now: TIMES.t2,
      });
      await env.store.close();

      const reopened = await env.openAnother();
      const loaded = await reopened.getExecution(intent.executionId);
      expect(loaded?.status).toBe("SUCCEEDED");
      expect(loaded?.terminalResult).toEqual(resultValue);
    } finally {
      await env.cleanup();
    }
  });
});
