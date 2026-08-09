import type { ExecutorPort, ExecutorStartRequest } from "../../contracts/execution";
import type {
  ExecutionLaunchSpec,
  ExecutionLaunchSpecResolver,
  ResolveExecutionLaunchSpecResult,
} from "../../contracts/execution-launch";
import type { OmpExecutionRegistry } from "../../contracts/omp-executor";
import type { OmpExecutorClock } from "../../contracts/omp-runtime";
import { createExecutionLaunchSpecValidator } from "../../src/executors/launch/create-execution-launch-spec-validator";
import { createOmpExecutorAdapter } from "../../src/executors/omp/create-omp-executor-adapter";
import { launchSpec } from "./fixtures";
import { createOmpRegistryTestEnvironment } from "./omp-registry-test-env";
import { FakeOmpRuntime } from "./fake-omp-runtime";

export class FakeLaunchResolver implements ExecutionLaunchSpecResolver {
  spec: ExecutionLaunchSpec = launchSpec();
  mode: "FOUND" | "NOT_FOUND" | "INVALID" = "FOUND";
  invalidCode: Extract<ResolveExecutionLaunchSpecResult, { status: "INVALID" }>["code"] =
    "IDENTITY_MISMATCH";
  readonly requests: ExecutorStartRequest[] = [];

  async resolve(request: ExecutorStartRequest): Promise<ResolveExecutionLaunchSpecResult> {
    this.requests.push(structuredClone(request));
    if (this.mode === "NOT_FOUND") {
      return { status: "NOT_FOUND", executionId: request.executionId };
    }
    if (this.mode === "INVALID") {
      return { status: "INVALID", code: this.invalidCode };
    }
    return { status: "FOUND", spec: this.spec };
  }
}

export class MutableOmpClock implements OmpExecutorClock {
  iso = "2026-08-09T08:00:00.000Z";
  epochMs = Date.parse(this.iso);

  now() {
    return { iso: this.iso, epochMs: this.epochMs };
  }

  set(iso: string) {
    this.iso = iso;
    this.epochMs = Date.parse(iso);
  }
}

export async function createOmpAdapterTestEnvironment() {
  const registryEnv = await createOmpRegistryTestEnvironment();
  const runtime = new FakeOmpRuntime();
  const resolver = new FakeLaunchResolver();
  const clock = new MutableOmpClock();
  const events: string[] = [];

  const tracedRegistry: OmpExecutionRegistry = {
    async prepare(request) {
      events.push("registry.prepare");
      return registryEnv.registry.prepare(request);
    },
    async get(executionId) {
      return registryEnv.registry.get(executionId);
    },
    async markActive(request) {
      events.push("registry.markActive");
      return registryEnv.registry.markActive(request);
    },
    async markTerminal(request) {
      events.push("registry.markTerminal");
      return registryEnv.registry.markTerminal(request);
    },
    async markInterrupted(request) {
      events.push("registry.markInterrupted");
      return registryEnv.registry.markInterrupted(request);
    },
  };

  const makeAdapter = (runtimeOverride = runtime): ExecutorPort =>
    createOmpExecutorAdapter({
      launchResolver: resolver,
      launchValidator: createExecutionLaunchSpecValidator(),
      registry: tracedRegistry,
      runtime: runtimeOverride,
      clock,
      sessionRoot: "/var/lib/ai-stack/omp-sessions",
    });

  return {
    registryEnv,
    registry: tracedRegistry,
    runtime,
    resolver,
    clock,
    events,
    adapter: makeAdapter(),
    makeAdapter,
    async cleanup() {
      await registryEnv.cleanup();
    },
  };
}
