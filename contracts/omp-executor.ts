import type { ExecutionId, ExecutionResult } from "./execution";
import type { ExecutionLaunchSpec } from "./execution-launch";

export type OmpExecutionPhase =
  | "PREPARED"
  | "ACTIVE"
  | "SUCCEEDED"
  | "FAILED"
  | "INTERRUPTED";

export interface OmpStructuredTerminalOutput {
  readonly schemaRef: string;
  /** Already validated against the launch spec's JSON Schema. */
  readonly value: unknown;
}

export interface OmpExecutionRecord {
  readonly executionId: ExecutionId;
  /** Exact immutable launch content bound when this execution is first prepared. */
  readonly launchSpec: ExecutionLaunchSpec;
  readonly sessionId: string;
  readonly sessionFile: string;
  readonly phase: OmpExecutionPhase;
  readonly preparedAt: string;
  readonly activatedAt?: string;
  readonly settledAt?: string;
  readonly terminalResult?: ExecutionResult;
  readonly terminalOutput?: OmpStructuredTerminalOutput;
  readonly interruptionReason?: string;
}

export interface PrepareOmpExecutionRequest {
  readonly executionId: ExecutionId;
  readonly launchSpec: ExecutionLaunchSpec;
  readonly sessionId: string;
  readonly sessionFile: string;
  readonly preparedAt: string;
}

export type PrepareOmpExecutionResult =
  | {
      readonly status: "PREPARED" | "REPLAYED";
      readonly record: OmpExecutionRecord;
    }
  | {
      readonly status: "CONFLICT";
    }
  | {
      readonly status: "INTEGRITY_ERROR";
    };

export type GetOmpExecutionResult =
  | {
      readonly status: "FOUND";
      readonly record: OmpExecutionRecord;
    }
  | {
      readonly status: "NOT_FOUND";
    }
  | {
      readonly status: "INTEGRITY_ERROR";
    };

export type UpdateOmpExecutionResult =
  | {
      readonly status: "UPDATED" | "REPLAYED";
      readonly record: OmpExecutionRecord;
    }
  | {
      readonly status: "NOT_FOUND";
    }
  | {
      readonly status: "CONFLICT" | "INTEGRITY_ERROR";
    };

/**
 * Adapter-owned durable identity/lifecycle registry.
 *
 * This is deliberately separate from generic ExecutionStore. Its purpose is to
 * map one AI-STACK ExecutionId to the OMP-generated session identity/path so
 * getStatus can reconcile after the adapter host process restarts.
 */
export interface OmpExecutionRegistry {
  prepare(request: PrepareOmpExecutionRequest): Promise<PrepareOmpExecutionResult>;

  get(executionId: ExecutionId): Promise<GetOmpExecutionResult>;

  markActive(request: {
    readonly executionId: ExecutionId;
    readonly activatedAt: string;
  }): Promise<UpdateOmpExecutionResult>;

  markTerminal(request: {
    readonly executionId: ExecutionId;
    readonly result: ExecutionResult;
    readonly output: OmpStructuredTerminalOutput;
    readonly settledAt: string;
  }): Promise<UpdateOmpExecutionResult>;

  markInterrupted(request: {
    readonly executionId: ExecutionId;
    readonly reason: string;
    readonly observedAt: string;
  }): Promise<UpdateOmpExecutionResult>;
}
