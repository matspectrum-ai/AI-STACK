import { describe, expect, test } from "bun:test";
import type { ExecutionId } from "../../contracts/execution";
import { createExecutionLaunchSpecValidator } from "../../src/executors/launch/create-execution-launch-spec-validator";
import { createOmpExecutorAdapter } from "../../src/executors/omp/create-omp-executor-adapter";
import { IDS, TIMES, launchSpec, prepareRequest, startRequest, terminalOutput } from "./fixtures";
import { FakeOmpRuntime } from "./fake-omp-runtime";
import { createOmpAdapterTestEnvironment } from "./omp-adapter-test-env";

async function waitForPhase(
  registry: Awaited<ReturnType<typeof createOmpAdapterTestEnvironment>>["registry"],
  phase: "SUCCEEDED" | "FAILED" | "INTERRUPTED",
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const loaded = await registry.get(IDS.execution);
    if (loaded.status === "FOUND" && loaded.record.phase === phase) return loaded.record;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`registry did not reach ${phase}`);
}

describe("OmpExecutorAdapter against deterministic fake runtime", () => {
  test("OMP-001: missing/invalid/mismatched launch material rejects before runtime preparation", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      env.resolver.mode = "NOT_FOUND";
      expect(await env.adapter.start(startRequest())).toEqual({
        status: "REJECTED",
        errorCode: "OMP_LAUNCH_SPEC_NOT_FOUND",
      });
      expect(env.runtime.preparedConfigs).toHaveLength(0);

      env.resolver.mode = "INVALID";
      env.resolver.invalidCode = "INVALID_WORKSPACE";
      expect((await env.adapter.start(startRequest())).status).toBe("REJECTED");
      expect(env.runtime.preparedConfigs).toHaveLength(0);

      env.resolver.mode = "FOUND";
      env.resolver.spec = launchSpec({ attempt: 2 });
      expect((await env.adapter.start(startRequest())).status).toBe("REJECTED");
      expect(env.runtime.preparedConfigs).toHaveLength(0);
    } finally {
      await env.cleanup();
    }
  });

  test("OMP-002: durable PREPARED + ACTIVE exist before prompt activation", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      env.runtime.onStartPrompt = async () => {
        const loaded = await env.registry.get(IDS.execution);
        expect(loaded.status).toBe("FOUND");
        if (loaded.status !== "FOUND") throw new Error("expected registry record");
        expect(loaded.record.phase).toBe("ACTIVE");
      };

      const started = await env.adapter.start(startRequest());
      expect(started.status).toBe("STARTED");
      expect(env.events.slice(0, 2)).toEqual(["registry.prepare", "registry.markActive"]);
      expect(env.runtime.events).toEqual(["runtime.prepareSession", "runtime.startPrompt"]);
    } finally {
      await env.cleanup();
    }
  });

  test("OMP-003: launch spec maps exactly to restricted runtime configuration", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      await env.adapter.start(startRequest());
      expect(env.runtime.preparedConfigs).toHaveLength(1);
      expect(env.runtime.preparedConfigs[0]).toEqual({
        executionId: IDS.execution,
        sessionDirectory: "/var/lib/ai-stack/omp-sessions/execution%3Aomp%3A1",
        cwd: "/workspace/ai-stack-execution",
        additionalDirectories: ["/workspace/shared-contracts"],
        modelSelector: "openai/gpt-5.6",
        reasoningProfile: "high",
        toolNames: ["read", "write", "bash"],
        restrictToolNames: true,
        outputSchemaRef: "schema://ai-stack/execution-result/v1",
        outputSchema: launchSpec().output.jsonSchema,
        outputSchemaMode: "strict",
        requireYieldTool: true,
        deadlineEpochMs: launchSpec().deadlineEpochMs,
      });
      expect(env.runtime.promptRequests[0]?.instruction).toBe(launchSpec().instruction);
    } finally {
      await env.cleanup();
    }
  });

  test("OMP-004: start returns STARTED while terminal settlement is still pending", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      const result = await env.adapter.start(startRequest());
      expect(result.status).toBe("STARTED");
      expect(env.runtime.isLive(IDS.execution)).toBe(true);
      expect((await env.adapter.getStatus(IDS.execution)).status).toBe("RUNNING");
    } finally {
      await env.cleanup();
    }
  });

  test("OMP-005: same live ExecutionId returns ALREADY_STARTED without a second prompt", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      const first = await env.adapter.start(startRequest());
      expect(first.status).toBe("STARTED");
      const second = await env.adapter.start(startRequest());
      expect(second.status).toBe("ALREADY_STARTED");
      expect(env.runtime.promptRequests).toHaveLength(1);
    } finally {
      await env.cleanup();
    }
  });

  test("OMP-006: durable terminal state returns ALREADY_COMPLETED after adapter reconstruction", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      await env.adapter.start(startRequest());
      env.runtime.settle(IDS.execution, {
        status: "SUCCEEDED",
        output: terminalOutput(),
        completedAt: TIMES.settled,
      });
      await waitForPhase(env.registry, "SUCCEEDED");

      const restarted = env.makeAdapter(new FakeOmpRuntime());
      const result = await restarted.start(startRequest());
      expect(result.status).toBe("ALREADY_COMPLETED");
      if (result.status !== "ALREADY_COMPLETED") throw new Error("expected completed");
      expect(result.result.outcome).toBe("SUCCEEDED");
    } finally {
      await env.cleanup();
    }
  });

  test("OMP-007: PREPARED but never activated is safely startable with the same session", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      await env.registry.prepare(prepareRequest());
      expect((await env.adapter.getStatus(IDS.execution)).status).toBe("NOT_FOUND");
      const result = await env.adapter.start(startRequest());
      expect(result.status).toBe("STARTED");
      expect(env.runtime.openedRequests).toHaveLength(1);
      expect(env.runtime.preparedConfigs).toHaveLength(0);
      expect(env.runtime.promptRequests).toHaveLength(1);
    } finally {
      await env.cleanup();
    }
  });

  test("OMP-008/012: ACTIVE live runtime remains RUNNING until trustworthy settlement", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      await env.adapter.start(startRequest());
      const loaded = await env.registry.get(IDS.execution);
      expect(loaded.status).toBe("FOUND");
      if (loaded.status !== "FOUND") throw new Error("expected record");
      expect(loaded.record.phase).toBe("ACTIVE");
      expect((await env.adapter.getStatus(IDS.execution)).status).toBe("RUNNING");
      expect((await env.registry.get(IDS.execution)).status).toBe("FOUND");
    } finally {
      await env.cleanup();
    }
  });

  test("OMP-009: orphan ACTIVE after host restart becomes UNKNOWN/INTERRUPTED without new prompt", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      await env.adapter.start(startRequest());
      const coldRuntime = new FakeOmpRuntime();
      const restarted = env.makeAdapter(coldRuntime);
      expect((await restarted.getStatus(IDS.execution)).status).toBe("UNKNOWN");
      const record = await waitForPhase(env.registry, "INTERRUPTED");
      expect(record.interruptionReason).toContain("runtime");
      expect(coldRuntime.promptRequests).toHaveLength(0);
    } finally {
      await env.cleanup();
    }
  });

  test("OMP-010: schema-bound structured success settles durable SUCCEEDED result", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      await env.adapter.start(startRequest());
      env.runtime.settle(IDS.execution, {
        status: "SUCCEEDED",
        output: terminalOutput({ value: { summary: "done" } }),
        completedAt: TIMES.settled,
      });
      const record = await waitForPhase(env.registry, "SUCCEEDED");
      expect(record.terminalOutput?.value).toEqual({ summary: "done" });
      const status = await env.adapter.getStatus(IDS.execution);
      expect(status.status).toBe("SUCCEEDED");
      if (status.status !== "SUCCEEDED") throw new Error("expected success");
      expect(status.result.executionId).toBe(IDS.execution);
      expect(status.result.resultRef).toBe("omp-result:execution%3Aomp%3A1");
    } finally {
      await env.cleanup();
    }
  });

  test("OMP-011/013: invalid structured success cannot become SUCCEEDED", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      await env.adapter.start(startRequest());
      env.runtime.settle(IDS.execution, {
        status: "SUCCEEDED",
        output: terminalOutput({ schemaRef: "schema://wrong" }),
        completedAt: TIMES.settled,
      });
      await waitForPhase(env.registry, "INTERRUPTED");
      expect((await env.adapter.getStatus(IDS.execution)).status).toBe("UNKNOWN");
    } finally {
      await env.cleanup();
    }
  });

  test("OMP-014: runtime preparation/tool configuration rejection starts nothing", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      env.runtime.prepareRejectCode = "OMP_TOOL_POLICY_UNENFORCEABLE";
      const result = await env.adapter.start(startRequest());
      expect(result).toEqual({
        status: "REJECTED",
        errorCode: "OMP_TOOL_POLICY_UNENFORCEABLE",
      });
      expect(env.runtime.promptRequests).toHaveLength(0);
      expect((await env.registry.get(IDS.execution)).status).toBe("NOT_FOUND");
    } finally {
      await env.cleanup();
    }
  });

  test("OMP-015: existing ExecutionId with changed launch material is rejected", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      await env.registry.prepare(prepareRequest());
      env.resolver.spec = launchSpec({ instruction: "different task material" });
      const result = await env.adapter.start(startRequest());
      expect(result).toEqual({
        status: "REJECTED",
        errorCode: "OMP_LAUNCH_BINDING_CONFLICT",
      });
      expect(env.runtime.promptRequests).toHaveLength(0);
    } finally {
      await env.cleanup();
    }
  });

  test("OMP-016: session construction failure is explicit and creates no false durable run", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      env.runtime.throwOnPrepare = true;
      const result = await env.adapter.start(startRequest());
      expect(result.status).toBe("REJECTED");
      expect((await env.registry.get(IDS.execution)).status).toBe("NOT_FOUND");
      expect(env.runtime.promptRequests).toHaveLength(0);
    } finally {
      await env.cleanup();
    }
  });

  test("OMP-017: already-expired deadline rejects before runtime/session effects", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      env.resolver.spec = launchSpec({ deadlineEpochMs: env.clock.epochMs - 1 });
      const result = await env.adapter.start(startRequest());
      expect(result).toEqual({ status: "REJECTED", errorCode: "OMP_DEADLINE_EXPIRED" });
      expect(env.runtime.preparedConfigs).toHaveLength(0);
      expect((await env.registry.get(IDS.execution)).status).toBe("NOT_FOUND");
    } finally {
      await env.cleanup();
    }
  });

  test("OMP-018: runtime settlement loss after activation fails closed to INTERRUPTED/UNKNOWN", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      await env.adapter.start(startRequest());
      env.runtime.rejectSettlement(IDS.execution, new Error("runtime disappeared"));
      await waitForPhase(env.registry, "INTERRUPTED");
      expect((await env.adapter.getStatus(IDS.execution)).status).toBe("UNKNOWN");
    } finally {
      await env.cleanup();
    }
  });

  test("prompt rejection after ACTIVE marks INTERRUPTED and returns REJECTED", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      env.runtime.startRejectCode = "OMP_PROMPT_REJECTED";
      const result = await env.adapter.start(startRequest());
      expect(result).toEqual({ status: "REJECTED", errorCode: "OMP_PROMPT_REJECTED" });
      const record = await waitForPhase(env.registry, "INTERRUPTED");
      expect(record.phase).toBe("INTERRUPTED");
    } finally {
      await env.cleanup();
    }
  });

  test("OMP-019: adapter public surface has only ExecutorPort authority", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      expect(Object.keys(env.adapter).sort()).toEqual(["getStatus", "start"]);
      for (const forbidden of ["commit", "approve", "dispatch", "executeTool", "markTerminal"]) {
        expect(forbidden in env.adapter).toBe(false);
      }
    } finally {
      await env.cleanup();
    }
  });

  test("constructor rejects relative session root", async () => {
    const env = await createOmpAdapterTestEnvironment();
    try {
      expect(() => createOmpExecutorAdapter({
        launchResolver: env.resolver,
        launchValidator: createExecutionLaunchSpecValidator(),
        registry: env.registry,
        runtime: env.runtime,
        clock: env.clock,
        sessionRoot: "relative/sessions",
      })).toThrow();
    } finally {
      await env.cleanup();
    }
  });
});
