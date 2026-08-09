import { describe, expect, test } from "bun:test";
import {
  IDS,
  asDigest,
  asOperationId,
  createRunRequest,
  state,
  transitionCommit,
} from "./fixtures";
import { createSqliteTestEnvironment } from "./test-env";

function expectReceipt<T extends { status: string }>(
  result: T,
  expected: "CREATED" | "COMMITTED" | "REPLAYED",
): asserts result is T & { receipt: { stateRevision: number; journalSequence: number } } {
  expect(result.status).toBe(expected);
  expect("receipt" in result).toBe(true);
}

describe("SQLite authoritative state store: creation, load, idempotency", () => {
  test("STORE-001: create run starts at revision zero", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      const created = await env.store.createRun(createRunRequest());
      expectReceipt(created, "CREATED");
      expect(Number(created.receipt.stateRevision)).toBe(0);
      expect(Number(created.receipt.journalSequence)).toBe(0);

      const loaded = await env.store.loadRun({ runId: IDS.run });
      expect(loaded.status).toBe("FOUND");
      if (loaded.status !== "FOUND") throw new Error("expected FOUND");
      expect(loaded.snapshot.state).toEqual(state(0));
      expect(Number(loaded.snapshot.journalHeadSequence)).toBe(0);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-002: invalid initial revision is rejected without creating a run", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      const result = await env.store.createRun(
        createRunRequest(
          asOperationId("op:create:invalid"),
          asDigest("sha256:create:invalid"),
          state(1),
        ),
      );
      expect(result.status).toBe("INTEGRITY_ERROR");
      if (result.status !== "INTEGRITY_ERROR") throw new Error("expected integrity error");
      expect(result.error.code).toBe("INVALID_COMMIT_STRUCTURE");

      expect((await env.store.loadRun({ runId: IDS.run })).status).toBe("NOT_FOUND");
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-003: unknown run loads as NOT_FOUND", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      const result = await env.store.loadRun({ runId: IDS.run });
      expect(result).toEqual({ status: "NOT_FOUND", runId: IDS.run });
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-004: duplicate run creation with a new operation is rejected", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      expect((await env.store.createRun(createRunRequest())).status).toBe("CREATED");
      const duplicate = await env.store.createRun(
        createRunRequest(
          asOperationId("op:create:other"),
          asDigest("sha256:create:other"),
        ),
      );
      expect(duplicate).toEqual({ status: "RUN_ALREADY_EXISTS", runId: IDS.run });

      const journal = await env.store.readJournal({ runId: IDS.run });
      expect(journal.status).toBe("FOUND");
      if (journal.status !== "FOUND") throw new Error("expected journal");
      expect(journal.entries).toHaveLength(1);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-005: close and reopen resumes equivalent committed state", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      const commit = transitionCommit(0);
      expect((await env.store.commit(commit)).status).toBe("COMMITTED");

      const before = await env.store.loadRun({ runId: IDS.run });
      expect(before.status).toBe("FOUND");
      if (before.status !== "FOUND") throw new Error("expected FOUND before close");

      await env.store.close();
      const reopened = await env.openAnother();
      const after = await reopened.loadRun({ runId: IDS.run });
      expect(after.status).toBe("FOUND");
      if (after.status !== "FOUND") throw new Error("expected FOUND after reopen");
      expect(after.snapshot).toEqual(before.snapshot);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-006: identical create replay returns original receipt without new journal entry", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      const request = createRunRequest();
      const first = await env.store.createRun(request);
      expectReceipt(first, "CREATED");

      const replay = await env.store.createRun(request);
      expectReceipt(replay, "REPLAYED");
      expect(replay.receipt).toEqual(first.receipt);

      const journal = await env.store.readJournal({ runId: IDS.run });
      expect(journal.status).toBe("FOUND");
      if (journal.status !== "FOUND") throw new Error("expected journal");
      expect(journal.entries).toHaveLength(1);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-007: create operation ID cannot be rebound to a different digest", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      const operationId = asOperationId("op:create:same");
      await env.store.createRun(createRunRequest(operationId, asDigest("sha256:a")));

      const conflict = await env.store.createRun(
        createRunRequest(operationId, asDigest("sha256:b")),
      );
      expect(conflict).toEqual({ status: "IDEMPOTENCY_VIOLATION", operationId });

      const journal = await env.store.readJournal({ runId: IDS.run });
      expect(journal.status).toBe("FOUND");
      if (journal.status !== "FOUND") throw new Error("expected journal");
      expect(journal.entries).toHaveLength(1);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-008: committed operation replay returns original receipt after later revision advancement", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      const firstRequest = transitionCommit(0);
      const first = await env.store.commit(firstRequest);
      expectReceipt(first, "COMMITTED");

      const secondRequest = transitionCommit(
        1,
        asOperationId("op:transition:2"),
        asDigest("sha256:transition:2"),
      );
      expect((await env.store.commit(secondRequest)).status).toBe("COMMITTED");

      const replay = await env.store.commit(firstRequest);
      expectReceipt(replay, "REPLAYED");
      expect(replay.receipt).toEqual(first.receipt);

      const loaded = await env.store.loadRun({ runId: IDS.run });
      expect(loaded.status).toBe("FOUND");
      if (loaded.status !== "FOUND") throw new Error("expected FOUND");
      expect(Number(loaded.snapshot.state.revision)).toBe(2);

      const journal = await env.store.readJournal({ runId: IDS.run });
      expect(journal.status).toBe("FOUND");
      if (journal.status !== "FOUND") throw new Error("expected journal");
      expect(journal.entries).toHaveLength(3);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-009: committed operation ID cannot be rebound to a different digest", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      const operationId = asOperationId("op:transition:same");
      const first = transitionCommit(0, operationId, asDigest("sha256:a"));
      expect((await env.store.commit(first)).status).toBe("COMMITTED");

      const conflicting = transitionCommit(0, operationId, asDigest("sha256:b"));
      const result = await env.store.commit(conflicting);
      expect(result).toEqual({ status: "IDEMPOTENCY_VIOLATION", operationId });

      const loaded = await env.store.loadRun({ runId: IDS.run });
      expect(loaded.status).toBe("FOUND");
      if (loaded.status !== "FOUND") throw new Error("expected FOUND");
      expect(Number(loaded.snapshot.state.revision)).toBe(1);
    } finally {
      await env.cleanup();
    }
  });
});
