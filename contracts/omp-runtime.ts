import type { ExecutionId, ExecutorReference } from "./execution";
import type {
  ExecutionLaunchSpec,
  ExecutionLaunchSpecResolver,
  ExecutionLaunchSpecValidator,
} from "./execution-launch";
import type {
  OmpExecutionRegistry,
  OmpStructuredTerminalOutput,
} from "./omp-executor";

export interface OmpExecutorClockSnapshot {
  readonly iso: string;
  readonly epochMs: number;
}

export interface OmpExecutorClock {
  now(): OmpExecutorClockSnapshot;
}

export interface OmpRuntimeSessionConfiguration {
  readonly executionId: ExecutionId;
  readonly sessionDirectory: string;
  readonly cwd: string;
  readonly additionalDirectories: readonly string[];
  readonly modelSelector: string;
  readonly reasoningProfile: ExecutionLaunchSpec["model"]["reasoningProfile"];
  readonly toolNames: readonly string[];
  readonly restrictToolNames: true;
  readonly outputSchemaRef: string;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchemaMode: "strict";
  readonly requireYieldTool: true;
  readonly deadlineEpochMs: number;
}

export interface OmpPreparedRuntimeSession {
  readonly sessionId: string;
  readonly sessionFile: string;
  readonly executorRef: ExecutorReference;
}

export type OmpRuntimePrepareResult =
  | {
      readonly status: "PREPARED";
      readonly session: OmpPreparedRuntimeSession;
    }
  | {
      readonly status: "REJECTED";
      readonly errorCode: string;
    };

export interface OmpRuntimeOpenRequest {
  readonly executionId: ExecutionId;
  readonly sessionId: string;
  readonly sessionFile: string;
  readonly config: OmpRuntimeSessionConfiguration;
}

export type OmpRuntimeOpenResult =
  | {
      readonly status: "READY";
      readonly executorRef: ExecutorReference;
    }
  | {
      readonly status: "REJECTED";
      readonly errorCode: string;
    };

export type OmpRuntimeSettlement =
  | {
      readonly status: "SUCCEEDED";
      readonly output: OmpStructuredTerminalOutput;
      readonly completedAt: string;
    }
  | {
      readonly status: "FAILED";
      readonly errorCode: string;
      readonly output?: OmpStructuredTerminalOutput;
      readonly completedAt: string;
    }
  | {
      readonly status: "INTERRUPTED";
      readonly reason: string;
      readonly observedAt: string;
    };

export type OmpRuntimeStartResult =
  | {
      readonly status: "STARTED";
      /** Resolves exactly once to the trustworthy runtime settlement. */
      readonly settlement: Promise<OmpRuntimeSettlement>;
    }
  | {
      readonly status: "REJECTED";
      readonly errorCode: string;
    };

/**
 * OMP-specific runtime bridge used by the adapter state machine.
 *
 * Phase 13 tests this interface with a deterministic fake. Phase 14 supplies
 * the real @oh-my-pi/pi-coding-agent bridge and is the only phase that may
 * claim actual OMP conformance.
 */
export interface OmpRuntimeBridge {
  prepareSession(
    config: OmpRuntimeSessionConfiguration,
  ): Promise<OmpRuntimePrepareResult>;

  openPreparedSession(request: OmpRuntimeOpenRequest): Promise<OmpRuntimeOpenResult>;

  startPrompt(request: {
    readonly executionId: ExecutionId;
    readonly instruction: string;
  }): Promise<OmpRuntimeStartResult>;

  isLive(executionId: ExecutionId): boolean;
}

export interface CreateOmpExecutorAdapterOptions {
  readonly launchResolver: ExecutionLaunchSpecResolver;
  readonly launchValidator: ExecutionLaunchSpecValidator;
  readonly registry: OmpExecutionRegistry;
  readonly runtime: OmpRuntimeBridge;
  readonly clock: OmpExecutorClock;
  /** Absolute adapter-owned root under which one OMP session directory is derived per ExecutionId. */
  readonly sessionRoot: string;
}
