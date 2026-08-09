import { describe, expect, test } from "bun:test";
import type { ExecutionId } from "../../contracts/execution";
import {
  IDS,
  TIMES,
  executionResult,
  launchSpec,
  prepareRequest,
  terminalOutput,
} from "./fixtures";
import { createOmpRegistryTestEnvironment } from "./omp-registry-test-env";

async function prepareAndActivate(registry: Awaited<ReturnType<typeof createOmpRegistryTestEnvironment>>["registry"]) {
  const prepared = await registry.prepare(prepareRequest());
  expect(prepared.status).toBe("PREPARED");
  const active = await registry.markActive({
    executionId: IDS.execution,
    activatedAt: TIMES.active,
  });
  expect(active.status).toBe("UPDATED");
}

describe("SQLite OmpExecutionRegistry", () => {
  test("OMPREG-001: first prepare durably binds execution to launch spec/session", async () => {
    const env = await createOmpRegistryTestEnvironment();
    try {
      const result = await env.registry.prepare(prepareRequest());
      expect(result.status).toBe("PREPARED");
      if (result.status !== "PREPARED") throw new Error("expected PREPARED");
      expect(result.record.phase).toBe("PREPARED");
      expect(result.record.executionId).toBe(IDS.execution);
      expect(result.record.launchSpec).toEqual(launchSpec());
      expect(result.record.sessionId).toBe("omp-session-1");
      expect(result.record.sessionFile).toBe("/var/lib/ai-stack/omp/execution-1/session.jsonl");
    } finally {
      await env.cleanup();
    }
  });

  test("OMPREG-002: identical prepare replay is idempotent", async () => {
    const env = await createOmpRegistryTestEnvironment();
    try {
      const request = prepareRequest();
      expect((await env.registry.prepare(request)).status).toBe("PREPARED");
      const replay = await env.registry.prepare(request);
      expect(replay.status).toBe("REPLAYED");
      if (replay.status !== "REPLAYED") throw new Error("expected REPLAYED");
      expect(replay.record.phase).toBe("PREPARED");
    } finally {
      await env.cleanup();
    }
  });

  test("OMPREG-003: one ExecutionId cannot be rebound to another spec/session", async () => {
    const env = await createOmpRegistryTestEnvironment();
    try {
      await env.registry.prepare(prepareRequest());
      expect(await env.registry.prepare(prepareRequest({ sessionId: "omp-session-2" }))).toEqual({
        status: "CONFLICT",
      });
      expect(await env.registry.prepare(prepareRequest({
        launchSpec: launchSpec({ instruction: "Different work" }),
      }))).toEqual({ status: "CONFLICT" });
    } finally {
      await env.cleanup();
    }
  });

  test("OMPREG-004: PREPARED transitions once to ACTIVE and exact replay is idempotent", async () => {
    const env = await createOmpRegistryTestEnvironment();
    try {
      await env.registry.prepare(prepareRequest());
      const first = await env.registry.markActive({
        executionId: IDS.execution,
        activatedAt: TIMES.active,
      });
      expect(first.status).toBe("UPDATED");
      if (first.status !== "UPDATED") throw new Error("expected UPDATED");
      expect(first.record.phase).toBe("ACTIVE");

      const replay = await env.registry.markActive({
        executionId: IDS.execution,
        activatedAt: TIMES.active,
      });
      expect(replay.status).toBe("REPLAYED");

      const conflict = await env.registry.markActive({
        executionId: IDS.execution,
        activatedAt: "2026-08-09T08:00:01.500Z",
      });
      expect(conflict.status).toBe("CONFLICT");
    } finally {
      await env.cleanup();
    }
  });

  test("OMPREG-005: ACTIVE can settle SUCCEEDED only with bound structured output", async () => {
    const env = await createOmpRegistryTestEnvironment();
    try {
      await prepareAndActivate(env.registry);

      const missingOutput = await env.registry.markTerminal({
        executionId: IDS.execution,
        result: executionResult("SUCCEEDED", "missing"),
        settledAt: TIMES.settled,
      });
      expect(missingOutput.status).toBe("INTEGRITY_ERROR");

      const wrongSchema = await env.registry.markTerminal({
        executionId: IDS.execution,
        result: executionResult("SUCCEEDED", "wrong"),
        output: terminalOutput({ schemaRef: "schema://wrong" }),
        settledAt: TIMES.settled,
      });
      expect(wrongSchema.status).toBe("INTEGRITY_ERROR");

      const result = executionResult("SUCCEEDED", "ok");
      const output = terminalOutput();
      const settled = await env.registry.markTerminal({
        executionId: IDS.execution,
        result,
        output,
        settledAt: TIMES.settled,
      });
      expect(settled.status).toBe("UPDATED");
      if (settled.status !== "UPDATED") throw new Error("expected UPDATED");
      expect(settled.record.phase).toBe("SUCCEEDED");
      expect(settled.record.terminalResult).toEqual(result);
      expect(settled.record.terminalOutput).toEqual(output);
    } finally {
      await env.cleanup();
    }
  });

  test("OMPREG-006: ACTIVE can settle FAILED without structured output", async () => {
    const env = await createOmpRegistryTestEnvironment();
    try {
      await prepareAndActivate(env.registry);
      const result = executionResult("FAILED", "failure");
      const settled = await env.registry.markTerminal({
        executionId: IDS.execution,
        result,
        settledAt: TIMES.settled,
      });
      expect(settled.status).toBe("UPDATED");
      if (settled.status !== "UPDATED") throw new Error("expected UPDATED");
      expect(settled.record.phase).toBe("FAILED");
      expect(settled.record.terminalResult).toEqual(result);
      expect(settled.record.terminalOutput).toBeUndefined();
    } finally {
      await env.cleanup();
    }
  });

  test("OMPREG-007: terminal settlement is immutable and identical replay is idempotent", async () => {
    const env = await createOmpRegistryTestEnvironment();
    try {
      await prepareAndActivate(env.registry);
      const request = {
        executionId: IDS.execution,
        result: executionResult("SUCCEEDED", "immutable"),
        output: terminalOutput(),
        settledAt: TIMES.settled,
      } as const;
      expect((await env.registry.markTerminal(request)).status).toBe("UPDATED");
      expect((await env.registry.markTerminal(request)).status).toBe("REPLAYED");

      const conflict = await env.registry.markTerminal({
        executionId: IDS.execution,
        result: executionResult("FAILED", "conflict"),
        settledAt: TIMES.settled,
      });
      expect(conflict.status).toBe("CONFLICT");
      expect((await env.registry.get(IDS.execution)).status).toBe("FOUND");
    } finally {
      await env.cleanup();
    }
  });

  test("OMPREG-008: PREPARED/ACTIVE may become INTERRUPTED but terminal state cannot", async () => {
    const env = await createOmpRegistryTestEnvironment();
    try {
      await env.registry.prepare(prepareRequest());
      const interrupted = await env.registry.markInterrupted({
        executionId: IDS.execution,
        reason: "adapter host restarted before trustworthy settlement",
        observedAt: TIMES.interrupted,
      });
      expect(interrupted.status).toBe("UPDATED");
      if (interrupted.status !== "UPDATED") throw new Error("expected UPDATED");
      expect(interrupted.record.phase).toBe("INTERRUPTED");
      expect((await env.registry.markInterrupted({
        executionId: IDS.execution,
        reason: "adapter host restarted before trustworthy settlement",
        observedAt: TIMES.interrupted,
      })).status).toBe("REPLAYED");
      expect((await env.registry.markActive({
        executionId: IDS.execution,
        activatedAt: TIMES.active,
      })).status).toBe("CONFLICT");
    } finally {
      await env.cleanup();
    }

    const terminalEnv = await createOmpRegistryTestEnvironment();
    try {
      await prepareAndActivate(terminalEnv.registry);
      await terminalEnv.registry.markTerminal({
        executionId: IDS.execution,
        result: executionResult("FAILED", "done"),
        settledAt: TIMES.settled,
      });
      expect((await terminalEnv.registry.markInterrupted({
        executionId: IDS.execution,
        reason: "too late",
        observedAt: TIMES.interrupted,
      })).status).toBe("CONFLICT");
    } finally {
      await terminalEnv.cleanup();
    }
  });

  test("OMPREG-009: mapping/lifecycle/terminal settlement survives close/reopen", async () => {
    const env = await createOmpRegistryTestEnvironment();
    try {
      await prepareAndActivate(env.registry);
      const result = executionResult("SUCCEEDED", "durable");
      const output = terminalOutput();
      await env.registry.markTerminal({
        executionId: IDS.execution,
        result,
        output,
        settledAt: TIMES.settled,
      });
      await env.registry.close();

      const reopened = await env.openAnother();
      const loaded = await reopened.get(IDS.execution);
      expect(loaded.status).toBe("FOUND");
      if (loaded.status !== "FOUND") throw new Error("expected FOUND");
      expect(loaded.record.phase).toBe("SUCCEEDED");
      expect(loaded.record.launchSpec).toEqual(launchSpec());
      expect(loaded.record.terminalResult).toEqual(result);
      expect(loaded.record.terminalOutput).toEqual(output);
    } finally {
      await env.cleanup();
    }
  });

  test("OMPREG-010: concurrent divergent prepare has one winner and one conflict", async () => {
    const env = await createOmpRegistryTestEnvironment();
    try {
      const second = await env.openAnother();
      const [a, b] = await Promise.all([
        env.registry.prepare(prepareRequest()),
        second.prepare(prepareRequest({ sessionId: "omp-session-rival" })),
      ]);
      const statuses = [a.status, b.status];
      expect(statuses.filter((status) => status === "PREPARED")).toHaveLength(1);
      expect(statuses.filter((status) => status === "CONFLICT")).toHaveLength(1);

      const loaded = await env.registry.get(IDS.execution);
      expect(loaded.status).toBe("FOUND");
    } finally {
      await env.cleanup();
    }
  });

  test("OMPREG-010b: concurrent identical prepare produces PREPARED + REPLAYED", async () => {
    const env = await createOmpRegistryTestEnvironment();
    try {
      const second = await env.openAnother();
      const request = prepareRequest();
      const [a, b] = await Promise.all([
        env.registry.prepare(request),
        second.prepare(request),
      ]);
      const statuses = [a.status, b.status];
      expect(statuses.filter((status) => status === "PREPARED")).toHaveLength(1);
      expect(statuses.filter((status) => status === "REPLAYED")).toHaveLength(1);
    } finally {
      await env.cleanup();
    }
  });

  test("OMPREG-011: corrupted persisted launch state fails closed", async () => {
    const env = await createOmpRegistryTestEnvironment();
    try {
      await env.registry.prepare(prepareRequest());
      env.corruptColumn(IDS.execution, "launch_spec_json", "{broken json");
      expect(await env.registry.get(IDS.execution)).toEqual({ status: "INTEGRITY_ERROR" });
    } finally {
      await env.cleanup();
    }
  });

  test("OMPREG-012: registry public API has no graph/dispatch/tool authority", async () => {
    const env = await createOmpRegistryTestEnvironment();
    try {
      expect(Object.keys(env.registry).sort()).toEqual([
        "close",
        "get",
        "markActive",
        "markInterrupted",
        "markTerminal",
        "prepare",
      ]);
      for (const forbidden of ["commit", "dispatch", "start", "approve", "executeTool"]) {
        expect(forbidden in env.registry).toBe(false);
      }
    } finally {
      await env.cleanup();
    }
  });

  test("registry rejects identity mismatch, relative session file, and invalid timestamps", async () => {
    const env = await createOmpRegistryTestEnvironment();
    try {
      expect((await env.registry.prepare(prepareRequest({
        executionId: "execution:other" as ExecutionId,
      }))).status).toBe("INTEGRITY_ERROR");
      expect((await env.registry.prepare(prepareRequest({
        sessionFile: "relative/session.jsonl",
      }))).status).toBe("INTEGRITY_ERROR");
      expect((await env.registry.prepare(prepareRequest({
        preparedAt: "not-a-time",
      }))).status).toBe("INTEGRITY_ERROR");
    } finally {
      await env.cleanup();
    }
  });
});
