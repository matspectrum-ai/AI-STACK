import { describe, expect, test } from "bun:test";
import {
  TIMES,
  WORKER_A,
  WORKER_B,
  asExecutorRef,
  asLeaseId,
  lease,
  seedPending,
} from "./execution-store-fixtures";
import { createSqliteExecutionStoreTestEnvironment } from "./execution-store-test-env";

const LEASE_A = asLeaseId("lease:a");
const LEASE_B = asLeaseId("lease:b");

describe("SQLite ExecutionStore: pending/claim/lease", () => {
  test("ORCH-023: new durable intent is pending", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedPending(env.store);
      const stored = await env.store.getExecution(intent.executionId);
      expect(stored?.status).toBe("PENDING");
      expect(stored?.lease).toBeUndefined();
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-024: pending intent can be claimed durably", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedPending(env.store);
      const expectedLease = lease(LEASE_A, WORKER_A, TIMES.t0, TIMES.t3);
      const result = await env.store.claim({
        executionId: intent.executionId,
        lease: expectedLease,
        now: TIMES.t0,
      });
      expect(result.status).toBe("CLAIMED");
      if (result.status !== "CLAIMED") throw new Error("expected CLAIMED");
      expect(result.execution.status).toBe("CLAIMED");
      expect(result.execution.lease).toEqual(expectedLease);

      const loaded = await env.store.getExecution(intent.executionId);
      expect(loaded?.status).toBe("CLAIMED");
      expect(loaded?.lease).toEqual(expectedLease);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-025: invalid lease time is rejected without mutation", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedPending(env.store);
      const result = await env.store.claim({
        executionId: intent.executionId,
        lease: lease(LEASE_A, WORKER_A, TIMES.t2, TIMES.t2),
        now: TIMES.t2,
      });
      expect(result).toEqual({
        status: "INTEGRITY_ERROR",
        code: "INVALID_EXECUTION_TRANSITION",
      });
      expect((await env.store.getExecution(intent.executionId))?.status).toBe("PENDING");
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-026: unexpired claim cannot be stolen", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedPending(env.store);
      const firstLease = lease(LEASE_A, WORKER_A, TIMES.t0, TIMES.t4);
      await env.store.claim({ executionId: intent.executionId, lease: firstLease, now: TIMES.t0 });

      const result = await env.store.claim({
        executionId: intent.executionId,
        lease: lease(LEASE_B, WORKER_B, TIMES.t1, TIMES.t5),
        now: TIMES.t1,
      });
      expect(result.status).toBe("CLAIM_CONFLICT");
      if (result.status !== "CLAIM_CONFLICT") throw new Error("expected conflict");
      expect(result.currentLease).toEqual(firstLease);
      expect((await env.store.getExecution(intent.executionId))?.lease).toEqual(firstLease);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-027: expired claim can be reclaimed with same execution ID", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedPending(env.store);
      await env.store.claim({
        executionId: intent.executionId,
        lease: lease(LEASE_A, WORKER_A, TIMES.t0, TIMES.t2),
        now: TIMES.t0,
      });

      const replacement = lease(LEASE_B, WORKER_B, TIMES.t3, TIMES.t5);
      const result = await env.store.claim({
        executionId: intent.executionId,
        lease: replacement,
        now: TIMES.t3,
      });
      expect(result.status).toBe("CLAIMED");
      if (result.status !== "CLAIMED") throw new Error("expected reclaimed claim");
      expect(result.execution.intent.executionId).toBe(intent.executionId);
      expect(result.execution.lease).toEqual(replacement);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-028: stale lease cannot mark running", async () => {
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

      const result = await env.store.markRunning({
        executionId: intent.executionId,
        leaseId: LEASE_A,
        executorRef: asExecutorRef("executor:stale"),
        now: TIMES.t2,
      });
      expect(result.status).toBe("STALE_LEASE");
      expect((await env.store.getExecution(intent.executionId))?.status).toBe("CLAIMED");
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-029: expired lease cannot mark running", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedPending(env.store);
      await env.store.claim({
        executionId: intent.executionId,
        lease: lease(LEASE_A, WORKER_A, TIMES.t0, TIMES.t1),
        now: TIMES.t0,
      });

      const result = await env.store.markRunning({
        executionId: intent.executionId,
        leaseId: LEASE_A,
        executorRef: asExecutorRef("executor:late"),
        now: TIMES.t2,
      });
      expect(result.status).toBe("LEASE_EXPIRED");
      expect((await env.store.getExecution(intent.executionId))?.status).toBe("CLAIMED");
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-030: mark running binds executor reference durably", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedPending(env.store);
      await env.store.claim({
        executionId: intent.executionId,
        lease: lease(LEASE_A, WORKER_A, TIMES.t0, TIMES.t5),
        now: TIMES.t0,
      });
      const executorRef = asExecutorRef("executor:1");
      const result = await env.store.markRunning({
        executionId: intent.executionId,
        leaseId: LEASE_A,
        executorRef,
        now: TIMES.t1,
      });
      expect(result.status).toBe("RUNNING");
      if (result.status !== "RUNNING") throw new Error("expected RUNNING");
      expect(result.execution.executorRef).toBe(executorRef);
      expect((await env.store.getExecution(intent.executionId))?.executorRef).toBe(executorRef);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-057: two connections racing for one pending execution produce one winner", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedPending(env.store);
      const second = await env.openAnother();
      const [a, b] = await Promise.all([
        env.store.claim({
          executionId: intent.executionId,
          lease: lease(LEASE_A, WORKER_A, TIMES.t0, TIMES.t4),
          now: TIMES.t0,
        }),
        second.claim({
          executionId: intent.executionId,
          lease: lease(LEASE_B, WORKER_B, TIMES.t0, TIMES.t4),
          now: TIMES.t0,
        }),
      ]);
      const statuses = [a.status, b.status];
      expect(statuses.filter((status) => status === "CLAIMED")).toHaveLength(1);
      expect(statuses.filter((status) => status === "CLAIM_CONFLICT")).toHaveLength(1);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-058: expired claimed and running work is discoverable for recovery", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const intent = await seedPending(env.store);
      await env.store.claim({
        executionId: intent.executionId,
        lease: lease(LEASE_A, WORKER_A, TIMES.t0, TIMES.t2),
        now: TIMES.t0,
      });
      await env.store.markRunning({
        executionId: intent.executionId,
        leaseId: LEASE_A,
        executorRef: asExecutorRef("executor:recover"),
        now: TIMES.t1,
      });

      expect(await env.store.listRecoverable({ now: TIMES.t1, limit: 10 })).toEqual([]);
      const expired = await env.store.listRecoverable({ now: TIMES.t3, limit: 10 });
      expect(expired.map((execution) => execution.intent.executionId)).toEqual([
        intent.executionId,
      ]);

      const replacement = lease(LEASE_B, WORKER_B, TIMES.t3, TIMES.t5);
      const reclaimed = await env.store.claim({
        executionId: intent.executionId,
        lease: replacement,
        now: TIMES.t3,
      });
      expect(reclaimed.status).toBe("CLAIMED");
      if (reclaimed.status !== "CLAIMED") throw new Error("expected reclaimed");
      expect(reclaimed.execution.status).toBe("CLAIMED");
      expect(reclaimed.execution.intent.executionId).toBe(intent.executionId);
    } finally {
      await env.cleanup();
    }
  });
});
