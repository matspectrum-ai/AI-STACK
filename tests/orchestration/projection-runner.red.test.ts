import { describe, expect, test } from "bun:test";
import type { AuthoritativeJournalReader } from "../../contracts/projection-runner";
import { createProjectionRunner } from "../../src/orchestration/runner/create-projection-runner";
import { createExecutionProjector } from "../../src/orchestration/projector/create-execution-projector";
import { IDS } from "../persistence/fixtures";
import {
  RUNNER_PROJECTOR_ID,
  createProjectionRunnerTestEnvironment,
} from "./projection-runner-test-env";

describe("durable journal projection runner", () => {
  test("RUN-001: unknown authoritative run produces RUN_NOT_FOUND without projection state", async () => {
    const env = await createProjectionRunnerTestEnvironment();
    try {
      await env.registerGraph();
      const result = await env.runner.run(IDS.run);
      expect(result).toEqual({ status: "RUN_NOT_FOUND", runId: IDS.run });
      expect(
        await env.execution.store.getCheckpoint({
          projectorId: RUNNER_PROJECTOR_ID,
          runId: IDS.run,
        }),
      ).toEqual({ status: "NOT_FOUND" });
    } finally {
      await env.cleanup();
    }
  });

  test("RUN-002: sequence zero plus transition project to checkpoint and one durable intent", async () => {
    const env = await createProjectionRunnerTestEnvironment();
    try {
      await env.registerGraph();
      await env.seedRun();

      const result = await env.runner.run(IDS.run);
      expect(result.status).toBe("PROGRESSED");
      if (result.status !== "PROGRESSED") throw new Error("expected PROGRESSED");
      expect(result.processedEntries).toBe(2);
      expect(Number(result.processedThroughSequence)).toBe(1);
      expect(result.executionIds).toHaveLength(1);

      const pending = await env.execution.store.listPending({ limit: 10 });
      expect(pending).toHaveLength(1);
      expect(pending[0]?.intent.runId).toBe(IDS.run);
      expect(pending[0]?.intent.graphId).toBe(IDS.graph);
      expect(pending[0]?.intent.nodeId).toBe(IDS.implementation);
      expect(pending[0]?.intent.sourceJournalSequence).toBe(1);

      const checkpoint = await env.execution.store.getCheckpoint({
        projectorId: RUNNER_PROJECTOR_ID,
        runId: IDS.run,
      });
      expect(checkpoint.status).toBe("FOUND");
      if (checkpoint.status !== "FOUND") throw new Error("expected checkpoint");
      expect(Number(checkpoint.checkpoint.processedThroughSequence)).toBe(1);
    } finally {
      await env.cleanup();
    }
  });

  test("RUN-003: batch size bounds progress without inventing local cursor", async () => {
    const env = await createProjectionRunnerTestEnvironment({ batchSize: 1 });
    try {
      await env.registerGraph();
      await env.seedRun();

      const first = await env.runner.run(IDS.run);
      expect(first.status).toBe("PROGRESSED");
      if (first.status !== "PROGRESSED") throw new Error("expected first progress");
      expect(first.processedEntries).toBe(1);
      expect(Number(first.processedThroughSequence)).toBe(0);
      expect(await env.execution.store.listPending({ limit: 10 })).toHaveLength(0);

      const second = await env.runner.run(IDS.run);
      expect(second.status).toBe("PROGRESSED");
      if (second.status !== "PROGRESSED") throw new Error("expected second progress");
      expect(Number(second.processedThroughSequence)).toBe(1);
      expect(await env.execution.store.listPending({ limit: 10 })).toHaveLength(1);

      const third = await env.runner.run(IDS.run);
      expect(third.status).toBe("IDLE");
    } finally {
      await env.cleanup();
    }
  });

  test("RUN-004: completed projection is idempotent on repeated runner invocation", async () => {
    const env = await createProjectionRunnerTestEnvironment();
    try {
      await env.registerGraph();
      await env.seedRun();
      expect((await env.runner.run(IDS.run)).status).toBe("PROGRESSED");

      const replay = await env.runner.run(IDS.run);
      expect(replay.status).toBe("IDLE");
      expect(await env.execution.store.listPending({ limit: 10 })).toHaveLength(1);
    } finally {
      await env.cleanup();
    }
  });

  test("RUN-005: missing exact graph blocks before checkpoint advancement", async () => {
    const env = await createProjectionRunnerTestEnvironment();
    try {
      await env.seedRun({ transition: false });
      const result = await env.runner.run(IDS.run);
      expect(result.status).toBe("BLOCKED");
      if (result.status !== "BLOCKED") throw new Error("expected BLOCKED");
      expect(result.code).toBe("GRAPH_DEFINITION_MISSING");
      expect(Number(result.sequence)).toBe(0);
      expect(
        await env.execution.store.getCheckpoint({
          projectorId: RUNNER_PROJECTOR_ID,
          runId: IDS.run,
        }),
      ).toEqual({ status: "NOT_FOUND" });
    } finally {
      await env.cleanup();
    }
  });

  test("RUN-006: corrupt exact graph blocks fail-closed without checkpoint advancement", async () => {
    const env = await createProjectionRunnerTestEnvironment();
    try {
      await env.registerGraph();
      await env.seedRun({ transition: false });
      env.registry.corruptDefinition(IDS.graph, "1", "{broken graph");

      const result = await env.runner.run(IDS.run);
      expect(result.status).toBe("BLOCKED");
      if (result.status !== "BLOCKED") throw new Error("expected BLOCKED");
      expect(result.code).toBe("GRAPH_DEFINITION_INVALID");
      expect(Number(result.sequence)).toBe(0);
      expect(
        await env.execution.store.getCheckpoint({
          projectorId: RUNNER_PROJECTOR_ID,
          runId: IDS.run,
        }),
      ).toEqual({ status: "NOT_FOUND" });
    } finally {
      await env.cleanup();
    }
  });

  test("RUN-007: process restart resumes solely from durable projection checkpoint", async () => {
    const env = await createProjectionRunnerTestEnvironment({ batchSize: 1 });
    try {
      await env.registerGraph();
      await env.seedRun();
      const first = await env.runner.run(IDS.run);
      expect(first.status).toBe("PROGRESSED");
      if (first.status !== "PROGRESSED") throw new Error("expected progress");
      expect(Number(first.processedThroughSequence)).toBe(0);

      const authority2 = await env.authority.openAnother();
      const execution2 = await env.execution.openAnother();
      const registry2 = await env.registry.openAnother();
      const restarted = createProjectionRunner({
        journal: { readJournal: authority2.readJournal.bind(authority2) },
        registry: registry2,
        projector: createExecutionProjector(),
        store: execution2,
        projectorId: RUNNER_PROJECTOR_ID,
        batchSize: 1,
      });

      const resumed = await restarted.run(IDS.run);
      expect(resumed.status).toBe("PROGRESSED");
      if (resumed.status !== "PROGRESSED") throw new Error("expected resumed progress");
      expect(Number(resumed.processedThroughSequence)).toBe(1);
      expect(await execution2.listPending({ limit: 10 })).toHaveLength(1);
    } finally {
      await env.cleanup();
    }
  });

  test("RUN-008: two runner instances racing the same run cannot duplicate an intent", async () => {
    const env = await createProjectionRunnerTestEnvironment();
    try {
      await env.registerGraph();
      await env.seedRun();

      const authority2 = await env.authority.openAnother();
      const execution2 = await env.execution.openAnother();
      const registry2 = await env.registry.openAnother();
      const runner2 = createProjectionRunner({
        journal: { readJournal: authority2.readJournal.bind(authority2) },
        registry: registry2,
        projector: createExecutionProjector(),
        store: execution2,
        projectorId: RUNNER_PROJECTOR_ID,
        batchSize: 100,
      });

      const [a, b] = await Promise.all([
        env.runner.run(IDS.run),
        runner2.run(IDS.run),
      ]);
      expect(["PROGRESSED", "IDLE"]).toContain(a.status);
      expect(["PROGRESSED", "IDLE"]).toContain(b.status);
      expect(await execution2.listPending({ limit: 10 })).toHaveLength(1);
      const checkpoint = await execution2.getCheckpoint({
        projectorId: RUNNER_PROJECTOR_ID,
        runId: IDS.run,
      });
      expect(checkpoint.status).toBe("FOUND");
      if (checkpoint.status !== "FOUND") throw new Error("expected checkpoint");
      expect(Number(checkpoint.checkpoint.processedThroughSequence)).toBe(1);
    } finally {
      await env.cleanup();
    }
  });

  test("RUN-009: non-contiguous journal response is rejected as authoritative integrity failure", async () => {
    const env = await createProjectionRunnerTestEnvironment();
    try {
      await env.registerGraph();
      await env.seedRun();
      const actual = await env.authority.store.readJournal({ runId: IDS.run });
      if (actual.status !== "FOUND") throw new Error("expected journal");
      const sequenceOne = actual.entries.find((entry) => Number(entry.sequence) === 1);
      if (!sequenceOne) throw new Error("expected sequence 1");

      const badReader: AuthoritativeJournalReader = {
        async readJournal() {
          return {
            status: "FOUND",
            entries: [sequenceOne],
            headSequence: actual.headSequence,
          };
        },
      };
      const runner = createProjectionRunner({
        journal: badReader,
        registry: env.registry.registry,
        projector: createExecutionProjector(),
        store: env.execution.store,
        projectorId: RUNNER_PROJECTOR_ID,
        batchSize: 100,
      });
      const result = await runner.run(IDS.run);
      expect(result.status).toBe("BLOCKED");
      if (result.status !== "BLOCKED") throw new Error("expected blocked");
      expect(result.code).toBe("AUTHORITATIVE_INTEGRITY_ERROR");
    } finally {
      await env.cleanup();
    }
  });

  test("RUN-010: authoritative integrity error is surfaced without projection", async () => {
    const env = await createProjectionRunnerTestEnvironment();
    try {
      const reader: AuthoritativeJournalReader = {
        async readJournal() {
          return {
            status: "INTEGRITY_ERROR",
            error: { code: "JOURNAL_SEQUENCE_GAP" },
          };
        },
      };
      const runner = createProjectionRunner({
        journal: reader,
        registry: env.registry.registry,
        projector: createExecutionProjector(),
        store: env.execution.store,
        projectorId: RUNNER_PROJECTOR_ID,
        batchSize: 10,
      });
      const result = await runner.run(IDS.run);
      expect(result).toEqual({
        status: "BLOCKED",
        code: "AUTHORITATIVE_INTEGRITY_ERROR",
      });
    } finally {
      await env.cleanup();
    }
  });

  test("RUN-011: batch size must be a finite positive integer", async () => {
    const env = await createProjectionRunnerTestEnvironment();
    try {
      expect(() =>
        createProjectionRunner({
          journal: { readJournal: env.authority.store.readJournal.bind(env.authority.store) },
          registry: env.registry.registry,
          projector: createExecutionProjector(),
          store: env.execution.store,
          projectorId: RUNNER_PROJECTOR_ID,
          batchSize: 0,
        }),
      ).toThrow();
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-047: runner authority surface is read-only by type and implementation", async () => {
    const source = await Bun.file(
      "src/orchestration/runner/create-projection-runner.ts",
    ).text();
    expect(source).not.toMatch(/\.commit\s*\(/);
    expect(source).not.toMatch(/\.createRun\s*\(/);
    expect(source).not.toMatch(/\.loadRun\s*\(/);

    const env = await createProjectionRunnerTestEnvironment();
    try {
      const reader = {
        readJournal: env.authority.store.readJournal.bind(env.authority.store),
      } satisfies AuthoritativeJournalReader;
      expect(Object.keys(reader)).toEqual(["readJournal"]);
      expect("commit" in reader).toBe(false);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-056: generic orchestration contracts/runtime contain no OMP dependency", async () => {
    const paths = [
      "contracts/execution.ts",
      "contracts/dispatcher.ts",
      "contracts/projection-runner.ts",
      "src/orchestration/projector/create-execution-projector.ts",
      "src/orchestration/dispatcher/create-execution-dispatcher.ts",
      "src/orchestration/runner/create-projection-runner.ts",
    ];
    const forbidden = /@oh-my-pi|oh-my-pi|from\s+["'][^"']*\/omp[^"']*["']/i;
    for (const path of paths) {
      const source = await Bun.file(path).text();
      expect(source, path).not.toMatch(forbidden);
    }
  });
});
