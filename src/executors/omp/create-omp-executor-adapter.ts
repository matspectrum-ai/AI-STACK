import { isAbsolute, join, normalize } from "node:path";
import type {
  ExecutionId,
  ExecutionResult,
  ExecutionResultReference,
  ExecutorPort,
  ExecutorReference,
  ExecutorStartRequest,
  ExecutorStartResult,
  ExecutorStatusResult,
} from "../../../contracts/execution";
import type { ExecutionLaunchSpec } from "../../../contracts/execution-launch";
import type {
  OmpExecutionRecord,
  OmpStructuredTerminalOutput,
} from "../../../contracts/omp-executor";
import type {
  CreateOmpExecutorAdapterOptions,
  OmpExecutorClockSnapshot,
  OmpRuntimeSessionConfiguration,
  OmpRuntimeSettlement,
} from "../../../contracts/omp-runtime";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stableValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function validAbsoluteNormalizedPath(value: string): boolean {
  return typeof value === "string" && value.length > 0 && isAbsolute(value) && normalize(value) === value;
}

function validClockSnapshot(value: OmpExecutorClockSnapshot): boolean {
  return (
    Number.isFinite(value.epochMs) &&
    Number.isInteger(value.epochMs) &&
    typeof value.iso === "string" &&
    !Number.isNaN(Date.parse(value.iso))
  );
}

function executorRefForSession(sessionId: string): ExecutorReference {
  return `omp:${sessionId}` as ExecutorReference;
}

function resultRefForExecution(executionId: ExecutionId): ExecutionResultReference {
  return `omp-result:${encodeURIComponent(executionId)}` as ExecutionResultReference;
}

function runtimeConfig(
  executionId: ExecutionId,
  spec: ExecutionLaunchSpec,
  sessionRoot: string,
): OmpRuntimeSessionConfiguration {
  return {
    executionId,
    sessionDirectory: join(sessionRoot, encodeURIComponent(executionId)),
    cwd: spec.workspace.cwd,
    additionalDirectories: [...spec.workspace.additionalDirectories],
    modelSelector: spec.model.selector,
    reasoningProfile: spec.model.reasoningProfile,
    toolNames: [...spec.tools.toolNames],
    restrictToolNames: true,
    outputSchemaRef: spec.output.schemaRef,
    outputSchema: spec.output.jsonSchema,
    outputSchemaMode: "strict",
    requireYieldTool: true,
    deadlineEpochMs: spec.deadlineEpochMs,
  };
}

function sameLaunch(left: ExecutionLaunchSpec, right: ExecutionLaunchSpec): boolean {
  return stableJson(left) === stableJson(right);
}

function rejected(errorCode: string): ExecutorStartResult {
  return { status: "REJECTED", errorCode };
}

export function createOmpExecutorAdapter(
  options: CreateOmpExecutorAdapterOptions,
): ExecutorPort {
  const {
    launchResolver,
    launchValidator,
    registry,
    runtime,
    clock,
    sessionRoot,
  } = options;

  if (!validAbsoluteNormalizedPath(sessionRoot)) {
    throw new Error("OMP adapter sessionRoot must be an absolute normalized path");
  }

  const now = (): OmpExecutorClockSnapshot => {
    const snapshot = clock.now();
    if (!validClockSnapshot(snapshot)) throw new Error("invalid OMP executor clock snapshot");
    return snapshot;
  };

  async function interrupt(
    executionId: ExecutionId,
    reason: string,
    observedAt?: string,
  ): Promise<void> {
    const at = observedAt ?? now().iso;
    try {
      await registry.markInterrupted({ executionId, reason, observedAt: at });
    } catch {
      // The adapter is already on a fail-closed path. Registry corruption is
      // surfaced as UNKNOWN by getStatus; never retry external work here.
    }
  }

  async function settle(
    executionId: ExecutionId,
    settlement: OmpRuntimeSettlement,
  ): Promise<void> {
    if (settlement.status === "INTERRUPTED") {
      await interrupt(executionId, settlement.reason, settlement.observedAt);
      return;
    }

    const result: ExecutionResult = {
      executionId,
      outcome: settlement.status,
      resultRef: resultRefForExecution(executionId),
      ...(settlement.status === "FAILED" ? { errorCode: settlement.errorCode } : {}),
      completedAt: settlement.completedAt,
    };

    const terminal = await registry.markTerminal({
      executionId,
      result,
      ...(settlement.output !== undefined ? { output: settlement.output } : {}),
      settledAt: settlement.completedAt,
    });

    if (terminal.status !== "UPDATED" && terminal.status !== "REPLAYED") {
      await interrupt(
        executionId,
        "OMP runtime terminal settlement failed registry validation",
      );
    }
  }

  function attachSettlement(
    executionId: ExecutionId,
    settlement: Promise<OmpRuntimeSettlement>,
  ): void {
    void settlement
      .then((value) => settle(executionId, value))
      .catch(async () => {
        await interrupt(executionId, "OMP runtime settlement promise was rejected");
      });
  }

  async function activatePrepared(
    request: ExecutorStartRequest,
    spec: ExecutionLaunchSpec,
    record: OmpExecutionRecord,
    config: OmpRuntimeSessionConfiguration,
    needsOpen: boolean,
  ): Promise<ExecutorStartResult> {
    const expectedRef = executorRefForSession(record.sessionId);

    if (needsOpen) {
      let opened;
      try {
        opened = await runtime.openPreparedSession({
          executionId: request.executionId,
          sessionId: record.sessionId,
          sessionFile: record.sessionFile,
          config,
        });
      } catch {
        return rejected("OMP_SESSION_OPEN_FAILED");
      }
      if (opened.status === "REJECTED") return rejected(opened.errorCode);
      if (opened.executorRef !== expectedRef) {
        return rejected("OMP_EXECUTOR_REFERENCE_MISMATCH");
      }
    }

    const activeAt = now();
    const activated = await registry.markActive({
      executionId: request.executionId,
      activatedAt: activeAt.iso,
    });
    if (activated.status !== "UPDATED" && activated.status !== "REPLAYED") {
      return rejected("OMP_REGISTRY_ACTIVATION_FAILED");
    }

    let started;
    try {
      started = await runtime.startPrompt({
        executionId: request.executionId,
        instruction: spec.instruction,
      });
    } catch {
      await interrupt(request.executionId, "OMP runtime startPrompt threw");
      return rejected("OMP_PROMPT_START_FAILED");
    }

    if (started.status === "REJECTED") {
      await interrupt(
        request.executionId,
        `OMP runtime rejected prompt: ${started.errorCode}`,
      );
      return rejected(started.errorCode);
    }

    attachSettlement(request.executionId, started.settlement);
    return { status: "STARTED", executorRef: expectedRef };
  }

  async function resolveLaunch(
    request: ExecutorStartRequest,
  ): Promise<
    | { readonly status: "READY"; readonly spec: ExecutionLaunchSpec }
    | { readonly status: "REJECTED"; readonly errorCode: string }
  > {
    const resolved = await launchResolver.resolve(request);
    if (resolved.status === "NOT_FOUND") {
      return { status: "REJECTED", errorCode: "OMP_LAUNCH_SPEC_NOT_FOUND" };
    }
    if (resolved.status === "INVALID") {
      return {
        status: "REJECTED",
        errorCode: `OMP_LAUNCH_${resolved.code}`,
      };
    }

    const validated = launchValidator.validate(request, resolved.spec);
    if (validated.status === "INVALID") {
      return {
        status: "REJECTED",
        errorCode: `OMP_LAUNCH_${validated.code}`,
      };
    }

    const snapshot = now();
    if (validated.spec.deadlineEpochMs <= snapshot.epochMs) {
      return { status: "REJECTED", errorCode: "OMP_DEADLINE_EXPIRED" };
    }

    return { status: "READY", spec: validated.spec };
  }

  async function start(request: ExecutorStartRequest): Promise<ExecutorStartResult> {
    const launch = await resolveLaunch(request);
    if (launch.status === "REJECTED") return rejected(launch.errorCode);
    const spec = launch.spec;
    const config = runtimeConfig(request.executionId, spec, sessionRoot);

    const existing = await registry.get(request.executionId);
    if (existing.status === "INTEGRITY_ERROR") {
      return rejected("OMP_REGISTRY_INTEGRITY_ERROR");
    }

    if (existing.status === "FOUND") {
      const record = existing.record;
      if (!sameLaunch(record.launchSpec, spec)) {
        return rejected("OMP_LAUNCH_BINDING_CONFLICT");
      }
      const executorRef = executorRefForSession(record.sessionId);

      if (record.phase === "SUCCEEDED" || record.phase === "FAILED") {
        if (!record.terminalResult) return rejected("OMP_REGISTRY_INTEGRITY_ERROR");
        return {
          status: "ALREADY_COMPLETED",
          executorRef,
          result: record.terminalResult,
        };
      }

      if (record.phase === "INTERRUPTED") {
        return { status: "ALREADY_STARTED", executorRef };
      }

      if (record.phase === "ACTIVE") {
        if (runtime.isLive(request.executionId)) {
          return { status: "ALREADY_STARTED", executorRef };
        }
        await interrupt(
          request.executionId,
          "OMP runtime is not live after adapter reconstruction",
        );
        return { status: "ALREADY_STARTED", executorRef };
      }

      return activatePrepared(request, spec, record, config, true);
    }

    let preparedRuntime;
    try {
      preparedRuntime = await runtime.prepareSession(config);
    } catch {
      return rejected("OMP_SESSION_PREPARE_FAILED");
    }
    if (preparedRuntime.status === "REJECTED") {
      return rejected(preparedRuntime.errorCode);
    }

    const session = preparedRuntime.session;
    if (
      typeof session.sessionId !== "string" ||
      session.sessionId.length === 0 ||
      !validAbsoluteNormalizedPath(session.sessionFile) ||
      session.executorRef !== executorRefForSession(session.sessionId)
    ) {
      return rejected("OMP_PREPARED_SESSION_INVALID");
    }

    const preparedAt = now();
    const persisted = await registry.prepare({
      executionId: request.executionId,
      launchSpec: spec,
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      preparedAt: preparedAt.iso,
    });

    if (persisted.status === "CONFLICT") {
      return rejected("OMP_REGISTRY_PREPARE_CONFLICT");
    }
    if (persisted.status === "INTEGRITY_ERROR") {
      return rejected("OMP_REGISTRY_INTEGRITY_ERROR");
    }

    return activatePrepared(
      request,
      spec,
      persisted.record,
      config,
      false,
    );
  }

  async function getStatus(executionId: ExecutionId): Promise<ExecutorStatusResult> {
    const loaded = await registry.get(executionId);
    if (loaded.status === "NOT_FOUND") return { status: "NOT_FOUND" };
    if (loaded.status === "INTEGRITY_ERROR") return { status: "UNKNOWN" };

    const record = loaded.record;
    const executorRef = executorRefForSession(record.sessionId);

    if (record.phase === "PREPARED") return { status: "NOT_FOUND" };
    if (record.phase === "INTERRUPTED") return { status: "UNKNOWN" };

    if (record.phase === "ACTIVE") {
      if (runtime.isLive(executionId)) return { status: "RUNNING", executorRef };
      await interrupt(executionId, "OMP runtime is not live after adapter reconstruction");
      return { status: "UNKNOWN" };
    }

    if (!record.terminalResult) return { status: "UNKNOWN" };
    return {
      status: record.phase,
      executorRef,
      result: record.terminalResult,
    };
  }

  return { start, getStatus };
}
