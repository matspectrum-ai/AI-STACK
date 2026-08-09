import { describe, expect, test } from "bun:test";
import type { GraphRunState } from "../../contracts/domain";
import type { JournalSequence } from "../../contracts/persistence";
import {
  IDS,
  asDigest,
  asOperationId,
  asRevision,
  createRunRequest,
  failureCommit,
  recoveryCommit,
  retryCommit,
  state,
  transitionCommit,
  transitionDecision,
} from "./fixtures";
import { createSqliteTestEnvironment } from "./test-env";
import { readRawCounts } from "./sqlite-test-inspector";

const asSequence = (value: number) => value as JournalSequence;

describe("SQLite authoritative state store: commit, concurrency, ordering", () => {
  test("STORE-010: successful commit increments revision and journal sequence exactly once", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      const result = await env.store.commit(transitionCommit(0));
      expect(result.status).toBe("COMMITTED");
      if (result.status !== "COMMITTED") throw new Error("expected COMMITTED");
      expect(Number(result.receipt.stateRevision)).toBe(1);
      expect(Number(result.receipt.journalSequence)).toBe(1);

      const loaded = await env.store.loadRun({ runId: IDS.run });
      expect(loaded.status).toBe("FOUND");
      if (loaded.status !== "FOUND") throw new Error("expected FOUND");
      expect(Number(loaded.snapshot.state.revision)).toBe(1);
      expect(Number(loaded.snapshot.journalHeadSequence)).toBe(1);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-011: stale revision conflicts without authoritative mutation", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      await env.store.commit(transitionCommit(0));
      const before = readRawCounts(env.databasePath);

      const stale = transitionCommit(
        0,
        asOperationId("op:stale"),
        asDigest("sha256:stale"),
      );
      const result = await env.store.commit(stale);
      expect(result.status).toBe("CONFLICT");
      if (result.status !== "CONFLICT") throw new Error("expected CONFLICT");
      expect(Number(result.currentRevision)).toBe(1);
      expect(readRawCounts(env.databasePath)).toEqual(before);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-012: two store instances racing on one expected revision yield exactly one winner", async () => {
    const env = await createSqliteTestEnvironment({ busyTimeoutMs: 1_000 });
    try {
      await env.store.createRun(createRunRequest());
      const second = await env.openAnother();
      const requestA = transitionCommit(
        0,
        asOperationId("op:race:a"),
        asDigest("sha256:race:a"),
      );
      const requestB = transitionCommit(
        0,
        asOperationId("op:race:b"),
        asDigest("sha256:race:b"),
      );

      const [a, b] = await Promise.all([
        env.store.commit(requestA),
        second.commit(requestB),
      ]);
      const statuses = [a.status, b.status];
      expect(statuses.filter((status) => status === "COMMITTED")).toHaveLength(1);
      expect(statuses.filter((status) => status === "CONFLICT")).toHaveLength(1);

      const loaded = await env.store.loadRun({ runId: IDS.run });
      expect(loaded.status).toBe("FOUND");
      if (loaded.status !== "FOUND") throw new Error("expected FOUND");
      expect(Number(loaded.snapshot.state.revision)).toBe(1);
      expect(Number(loaded.snapshot.journalHeadSequence)).toBe(1);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-013: next state must advance exactly one revision", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      const invalid = transitionCommit(
        0,
        asOperationId("op:bad-revision"),
        asDigest("sha256:bad-revision"),
        { nextState: state(2) },
      );
      const result = await env.store.commit(invalid);
      expect(result.status).toBe("INTEGRITY_ERROR");
      if (result.status !== "INTEGRITY_ERROR") throw new Error("expected integrity error");
      expect(result.error.code).toBe("INVALID_COMMIT_STRUCTURE");

      const loaded = await env.store.loadRun({ runId: IDS.run });
      expect(loaded.status).toBe("FOUND");
      if (loaded.status !== "FOUND") throw new Error("expected FOUND");
      expect(Number(loaded.snapshot.state.revision)).toBe(0);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-014: journal and snapshot revisions match after commit", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      await env.store.commit(transitionCommit(0));

      const loaded = await env.store.loadRun({ runId: IDS.run });
      const journal = await env.store.readJournal({ runId: IDS.run });
      expect(loaded.status).toBe("FOUND");
      expect(journal.status).toBe("FOUND");
      if (loaded.status !== "FOUND" || journal.status !== "FOUND") {
        throw new Error("expected committed state and journal");
      }
      const head = journal.entries.at(-1);
      expect(head?.resultingStateRevision).toBe(loaded.snapshot.state.revision);
      expect(head?.sequence).toBe(loaded.snapshot.journalHeadSequence);
      expect(head?.graphId).toBe(loaded.snapshot.state.graphId);
      expect(head?.graphVersion).toBe(loaded.snapshot.state.graphVersion);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-015: invalid structural commit leaves no journal/snapshot/idempotency partial state", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      const before = readRawCounts(env.databasePath);
      const request = transitionCommit(
        0,
        asOperationId("op:invalid-structure"),
        asDigest("sha256:invalid-structure"),
        { nextState: state(2) },
      );
      const result = await env.store.commit(request);
      expect(result.status).toBe("INTEGRITY_ERROR");
      expect(readRawCounts(env.databasePath)).toEqual(before);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-016: journal sequence is monotonic, gap-free, and ordered", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      await env.store.commit(transitionCommit(0));
      await env.store.commit(
        transitionCommit(1, asOperationId("op:t2"), asDigest("sha256:t2")),
      );

      const journal = await env.store.readJournal({ runId: IDS.run });
      expect(journal.status).toBe("FOUND");
      if (journal.status !== "FOUND") throw new Error("expected journal");
      expect(journal.entries.map((entry) => Number(entry.sequence))).toEqual([0, 1, 2]);
      expect(Number(journal.headSequence)).toBe(2);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-017: readJournal afterSequence is exclusive", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      await env.store.commit(transitionCommit(0));
      await env.store.commit(
        transitionCommit(1, asOperationId("op:t2"), asDigest("sha256:t2")),
      );

      const journal = await env.store.readJournal({
        runId: IDS.run,
        afterSequence: asSequence(0),
      });
      expect(journal.status).toBe("FOUND");
      if (journal.status !== "FOUND") throw new Error("expected journal");
      expect(journal.entries.map((entry) => Number(entry.sequence))).toEqual([1, 2]);
      expect(Number(journal.headSequence)).toBe(2);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-018: rejected operations do not append journal entries", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      await env.store.commit(transitionCommit(0));
      const before = await env.store.readJournal({ runId: IDS.run });
      expect(before.status).toBe("FOUND");
      if (before.status !== "FOUND") throw new Error("expected journal");

      const stale = await env.store.commit(
        transitionCommit(0, asOperationId("op:rejected"), asDigest("sha256:rejected")),
      );
      expect(stale.status).toBe("CONFLICT");

      const after = await env.store.readJournal({ runId: IDS.run });
      expect(after.status).toBe("FOUND");
      if (after.status !== "FOUND") throw new Error("expected journal");
      expect(after.entries).toEqual(before.entries);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-019: graph binding cannot change", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      const request = transitionCommit(
        0,
        asOperationId("op:graph-change"),
        asDigest("sha256:graph-change"),
      );
      const changed = {
        ...request,
        nextState: {
          ...request.nextState,
          graphId: "graph:other" as GraphRunState["graphId"],
        },
      };
      const result = await env.store.commit(changed);
      expect(result.status).toBe("INTEGRITY_ERROR");
      if (result.status !== "INTEGRITY_ERROR") throw new Error("expected integrity error");
      expect(result.error.code).toBe("GRAPH_BINDING_MISMATCH");
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-020: next state cannot change run ID", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      const request = transitionCommit(
        0,
        asOperationId("op:run-change"),
        asDigest("sha256:run-change"),
      );
      const changed = {
        ...request,
        nextState: {
          ...request.nextState,
          runId: "run:other" as GraphRunState["runId"],
        },
      };
      const result = await env.store.commit(changed);
      expect(result.status).toBe("INTEGRITY_ERROR");
      if (result.status !== "INTEGRITY_ERROR") throw new Error("expected integrity error");
      expect(result.error.code).toBe("INVALID_COMMIT_STRUCTURE");
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-021: transition revision fields must bind to the commit revision", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      const request = transitionCommit(
        0,
        asOperationId("op:bad-decision-revision"),
        asDigest("sha256:bad-decision-revision"),
      );
      const badDecision = {
        ...transitionDecision(0),
        stateRevisionAfter: asRevision(2),
      };
      const result = await env.store.commit({
        ...request,
        operation: { kind: "transition_committed", decision: badDecision },
      });
      expect(result.status).toBe("INTEGRITY_ERROR");
      if (result.status !== "INTEGRITY_ERROR") throw new Error("expected integrity error");
      expect(result.error.code).toBe("INVALID_COMMIT_STRUCTURE");
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-022: committed transition ID becomes snapshot lastTransitionId", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      const request = transitionCommit(0);
      expect((await env.store.commit(request)).status).toBe("COMMITTED");
      const loaded = await env.store.loadRun({ runId: IDS.run });
      expect(loaded.status).toBe("FOUND");
      if (loaded.status !== "FOUND") throw new Error("expected FOUND");
      if (request.operation.kind !== "transition_committed") throw new Error("expected transition operation");
      expect(loaded.snapshot.state.lastTransitionId).toBe(request.operation.decision.transitionId);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-023: failure_recorded requires failure ID in next state", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      const request = failureCommit(0);
      const result = await env.store.commit({
        ...request,
        nextState: { ...request.nextState, failureRefs: [] },
      });
      expect(result.status).toBe("INTEGRITY_ERROR");
      if (result.status !== "INTEGRITY_ERROR") throw new Error("expected integrity error");
      expect(result.error.code).toBe("INVALID_COMMIT_STRUCTURE");
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-024: failure is durable before later retry", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      expect((await env.store.commit(failureCommit(0))).status).toBe("COMMITTED");
      expect((await env.store.commit(retryCommit(1, 1))).status).toBe("COMMITTED");

      const loaded = await env.store.loadRun({ runId: IDS.run });
      expect(loaded.status).toBe("FOUND");
      if (loaded.status !== "FOUND") throw new Error("expected FOUND");
      expect(loaded.snapshot.state.failureRefs).toContain(IDS.failure);
      expect(loaded.snapshot.state.retryCounters.implementation).toBe(1);

      const journal = await env.store.readJournal({ runId: IDS.run });
      expect(journal.status).toBe("FOUND");
      if (journal.status !== "FOUND") throw new Error("expected journal");
      expect(journal.entries.map((entry) => entry.operation.kind)).toEqual([
        "run_created",
        "failure_recorded",
        "retry_activated",
      ]);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-025: retry requires governing failure already durable in current state", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      const result = await env.store.commit(retryCommit(0, 1));
      expect(result.status).toBe("INTEGRITY_ERROR");
      if (result.status !== "INTEGRITY_ERROR") throw new Error("expected integrity error");
      expect(result.error.code).toBe("INVALID_COMMIT_STRUCTURE");
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-026: retry count and activation become durable in the same commit", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      await env.store.commit(failureCommit(0));
      const result = await env.store.commit(retryCommit(1, 1));
      expect(result.status).toBe("COMMITTED");

      const loaded = await env.store.loadRun({ runId: IDS.run });
      expect(loaded.status).toBe("FOUND");
      if (loaded.status !== "FOUND") throw new Error("expected FOUND");
      expect(loaded.snapshot.state.retryCounters.implementation).toBe(1);
      expect(loaded.snapshot.state.activeNodeIds).toContain(IDS.implementation);
      expect(Number(loaded.snapshot.state.revision)).toBe(2);
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-027: retry counter cannot skip the next attempt", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      await env.store.commit(failureCommit(0));
      const result = await env.store.commit(retryCommit(1, 2));
      expect(result.status).toBe("INTEGRITY_ERROR");
      if (result.status !== "INTEGRITY_ERROR") throw new Error("expected integrity error");
      expect(result.error.code).toBe("INVALID_COMMIT_STRUCTURE");
    } finally {
      await env.cleanup();
    }
  });

  test("STORE-028: recovery requires governing failure already durable", async () => {
    const env = await createSqliteTestEnvironment();
    try {
      await env.store.createRun(createRunRequest());
      const rejected = await env.store.commit(recoveryCommit(0));
      expect(rejected.status).toBe("INTEGRITY_ERROR");

      expect((await env.store.commit(failureCommit(0))).status).toBe("COMMITTED");
      const accepted = await env.store.commit(recoveryCommit(1));
      expect(accepted.status).toBe("COMMITTED");
    } finally {
      await env.cleanup();
    }
  });
});
