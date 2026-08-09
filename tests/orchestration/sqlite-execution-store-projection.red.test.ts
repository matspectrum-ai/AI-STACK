import { describe, expect, test } from "bun:test";
import {
  TIMES,
  derivedIntents,
  projectSequence,
  projectionRequest,
  sourceEntry,
} from "./execution-store-fixtures";
import { createSqliteExecutionStoreTestEnvironment } from "./execution-store-test-env";

function firstIntent(sequence: number) {
  const intent = derivedIntents(sourceEntry(sequence))[0];
  if (!intent) throw new Error(`expected intent for sequence ${sequence}`);
  return intent;
}

describe("SQLite ExecutionStore: projection/checkpoint", () => {
  test("ORCH-016: first sequence projects atomically with checkpoint", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      const result = await projectSequence(env.store, 0);
      expect(result.status).toBe("PROJECTED");
      if (result.status !== "PROJECTED") throw new Error("expected PROJECTED");
      expect(Number(result.checkpoint.processedThroughSequence)).toBe(0);
      expect(result.executionIds).toEqual([]);

      const checkpoint = await env.store.getCheckpoint({
        projectorId: result.checkpoint.projectorId,
        runId: result.checkpoint.runId,
      });
      expect(checkpoint.status).toBe("FOUND");
      if (checkpoint.status !== "FOUND") throw new Error("expected checkpoint");
      expect(Number(checkpoint.checkpoint.processedThroughSequence)).toBe(0);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-017: next sequence must be contiguous", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      await projectSequence(env.store, 0);
      const request = projectionRequest(2);
      const result = await env.store.projectJournalEntry(request);
      expect(result.status).toBe("CHECKPOINT_CONFLICT");

      const checkpoint = await env.store.getCheckpoint({
        projectorId: request.projectorId,
        runId: request.entry.runId,
      });
      expect(checkpoint.status).toBe("FOUND");
      if (checkpoint.status !== "FOUND") throw new Error("expected checkpoint");
      expect(Number(checkpoint.checkpoint.processedThroughSequence)).toBe(0);
      expect(await env.store.getExecution(firstIntent(2).executionId)).toBeUndefined();
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-018: identical replay is idempotent", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      await projectSequence(env.store, 0);
      const request = projectionRequest(1);
      const first = await env.store.projectJournalEntry(request);
      expect(first.status).toBe("PROJECTED");

      const replay = await env.store.projectJournalEntry(request);
      expect(replay.status).toBe("REPLAYED");
      if (replay.status !== "REPLAYED") throw new Error("expected REPLAYED");
      expect(replay.executionIds).toEqual([firstIntent(1).executionId]);

      const pending = await env.store.listPending({ limit: 10 });
      expect(pending).toHaveLength(1);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-019: conflicting immutable intent replay is rejected", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      await projectSequence(env.store, 0);
      const request = projectionRequest(1);
      await env.store.projectJournalEntry(request);
      const intent = firstIntent(1);

      const conflicting = {
        ...request,
        derivedIntents: [{ ...intent, createdAt: TIMES.t1 }],
      };
      const result = await env.store.projectJournalEntry(conflicting);
      expect(result).toEqual({
        status: "INTEGRITY_ERROR",
        code: "EXECUTION_INTENT_CONFLICT",
      });

      const stored = await env.store.getExecution(intent.executionId);
      expect(stored?.intent.createdAt).toBe(TIMES.t0);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-020/021: projection transaction rolls back intent and checkpoint together", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      await projectSequence(env.store, 0);
      await projectSequence(env.store, 1);

      const existing = firstIntent(1);
      const unique = firstIntent(2);
      const conflicting = {
        ...unique,
        executionId: existing.executionId,
      };
      const request = {
        ...projectionRequest(2),
        derivedIntents: [unique, conflicting],
      };

      const result = await env.store.projectJournalEntry(request);
      expect(result).toEqual({
        status: "INTEGRITY_ERROR",
        code: "EXECUTION_INTENT_CONFLICT",
      });

      expect(await env.store.getExecution(unique.executionId)).toBeUndefined();
      const checkpoint = await env.store.getCheckpoint({
        projectorId: request.projectorId,
        runId: request.entry.runId,
      });
      expect(checkpoint.status).toBe("FOUND");
      if (checkpoint.status !== "FOUND") throw new Error("expected checkpoint");
      expect(Number(checkpoint.checkpoint.processedThroughSequence)).toBe(1);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-022: unprojected journal work remains recoverable after restart", async () => {
    const env = await createSqliteExecutionStoreTestEnvironment();
    try {
      await projectSequence(env.store, 0);
      await env.store.close();

      const reopened = await env.openAnother();
      const result = await projectSequence(reopened, 1);
      expect(result.status).toBe("PROJECTED");
      expect(await reopened.getExecution(firstIntent(1).executionId)).toBeDefined();
    } finally {
      await env.cleanup();
    }
  });
});
