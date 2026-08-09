import { describe, expect, test } from "bun:test";
import type { JournalSequence } from "../../contracts/persistence";
import {
  IDS,
  asDigest,
  asOperationId,
  createRunRequest,
  transitionCommit,
} from "./fixtures";
import { createSqliteTestEnvironment } from "./test-env";
import {
  deleteJournalEntry,
  overwriteIdempotencyDigest,
  overwriteIdempotencyReceipt,
  overwriteJournalGraphId,
  overwriteRunGraphId,
  overwriteRunRevision,
  overwriteSnapshotJson,
} from "./sqlite-test-inspector";

const asSequence = (value: number) => value as JournalSequence;

describe("SQLite authoritative state store: integrity and isolation", () => {
  test("STORE-029: snapshot/journal revision mismatch fails closed", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      await env.store.commit(transitionCommit(0));
      await env.store.close();

      overwriteRunRevision(env.databasePath, IDS.run, 7);
      const reopened = await env.openAnother();
      const result = await reopened.loadRun({ runId: IDS.run });
      expect(result.status).toBe("INTEGRITY_ERROR");
      if (result.status !== "INTEGRITY_ERROR") throw new Error("expected integrity error");
      expect(result.error.code).toBe("SNAPSHOT_JOURNAL_REVISION_MISMATCH");
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-030: graph binding corruption fails closed", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      await env.store.close();

      overwriteRunGraphId(env.databasePath, IDS.run, "graph:corrupt");
      const reopened = await env.openAnother();
      const result = await reopened.loadRun({ runId: IDS.run });
      expect(result.status).toBe("INTEGRITY_ERROR");
      if (result.status !== "INTEGRITY_ERROR") throw new Error("expected integrity error");
      expect(result.error.code).toBe("GRAPH_BINDING_MISMATCH");
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-031: journal sequence gap fails closed", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      await env.store.commit(transitionCommit(0));
      await env.store.commit(
        transitionCommit(1, asOperationId("op:t2"), asDigest("sha256:t2")),
      );
      await env.store.close();

      deleteJournalEntry(env.databasePath, IDS.run, asSequence(1));
      const reopened = await env.openAnother();
      const result = await reopened.readJournal({ runId: IDS.run });
      expect(result.status).toBe("INTEGRITY_ERROR");
      if (result.status !== "INTEGRITY_ERROR") throw new Error("expected integrity error");
      expect(result.error.code).toBe("JOURNAL_SEQUENCE_GAP");
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-031: journal graph metadata corruption fails closed", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      await env.store.commit(transitionCommit(0));
      await env.store.close();

      overwriteJournalGraphId(env.databasePath, IDS.run, asSequence(1), "graph:corrupt");
      const reopened = await env.openAnother();
      const result = await reopened.readJournal({ runId: IDS.run });
      expect(result.status).toBe("INTEGRITY_ERROR");
      if (result.status !== "INTEGRITY_ERROR") throw new Error("expected integrity error");
      expect(result.error.code).toBe("GRAPH_BINDING_MISMATCH");
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-032: corrupted idempotency digest binding fails closed", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      const request = createRunRequest();
      await env.store.createRun(request);
      await env.store.close();

      overwriteIdempotencyDigest(env.databasePath, request.operationId, "sha256:corrupt");
      const reopened = await env.openAnother();
      const result = await reopened.createRun(request);
      expect(result.status).toBe("INTEGRITY_ERROR");
      if (result.status !== "INTEGRITY_ERROR") throw new Error("expected integrity error");
      expect(result.error.code).toBe("IDEMPOTENCY_BINDING_MISMATCH");
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-032: corrupted idempotency receipt fails closed", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      const request = createRunRequest();
      await env.store.createRun(request);
      await env.store.close();

      overwriteIdempotencyReceipt(env.databasePath, request.operationId, 9, 9);
      const reopened = await env.openAnother();
      const result = await reopened.createRun(request);
      expect(result.status).toBe("INTEGRITY_ERROR");
      if (result.status !== "INTEGRITY_ERROR") throw new Error("expected integrity error");
      expect(result.error.code).toBe("IDEMPOTENCY_BINDING_MISMATCH");
    } finally {
      await env.cleanup();
    }
  });

  test("malformed snapshot JSON fails closed", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      await env.store.close();

      overwriteSnapshotJson(env.databasePath, IDS.run, "{not-json");
      const reopened = await env.openAnother();
      const result = await reopened.loadRun({ runId: IDS.run });
      expect(result.status).toBe("INTEGRITY_ERROR");
      if (result.status !== "INTEGRITY_ERROR") throw new Error("expected integrity error");
      expect(result.error.code).toBe("MALFORMED_PERSISTED_STATE");
    } finally {
      await env.cleanup();
    }
  });

  test("unknown snapshot schema version fails closed", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      await env.store.close();

      overwriteSnapshotJson(
        env.databasePath,
        IDS.run,
        JSON.stringify({ schemaVersion: 999, payload: {} }),
      );
      const reopened = await env.openAnother();
      const result = await reopened.loadRun({ runId: IDS.run });
      expect(result.status).toBe("INTEGRITY_ERROR");
      if (result.status !== "INTEGRITY_ERROR") throw new Error("expected integrity error");
      expect(result.error.code).toBe("MALFORMED_PERSISTED_STATE");
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-033: persistence API has no executor side effects or executor methods", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      const methodNames = Object.keys(env.store).sort();
      expect(methodNames).not.toContain("execute");
      expect(methodNames).not.toContain("runShell");
      expect(methodNames).not.toContain("dispatch");
      expect(methodNames).not.toContain("invokeTool");

      await env.store.createRun(createRunRequest());
      const journal = await env.store.readJournal({ runId: IDS.run });
      expect(journal.status).toBe("FOUND");
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-034: public results expose contracts, not SQLite handles", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      const created = await env.store.createRun(createRunRequest());
      expect(created.status).toBe("CREATED");
      expect("database" in created).toBe(false);
      expect("statement" in created).toBe(false);
      expect("connection" in created).toBe(false);

      const loaded = await env.store.loadRun({ runId: IDS.run });
      expect(loaded.status).toBe("FOUND");
      expect("database" in loaded).toBe(false);
      expect("statement" in loaded).toBe(false);
      expect("connection" in loaded).toBe(false);
    } finally {
      await env.cleanup();
    }
  });

  test("adapter close is idempotent and operations after close do not silently reopen", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.close();
      await expect(env.store.close()).resolves.toBeUndefined();
      await expect(env.store.loadRun({ runId: IDS.run })).rejects.toThrow();
    } finally {
      await env.cleanup();
    }
  });
});
