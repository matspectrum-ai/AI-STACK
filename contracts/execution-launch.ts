import type {
  ApprovalId,
  ArtifactId,
  EvidenceId,
  GraphId,
  NodeId,
  RunId,
} from "./domain";
import type {
  ExecutionId,
  ExecutorStartRequest,
} from "./execution";

export type ReasoningProfile =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "max";

export interface ExecutionWorkspaceBinding {
  /** Absolute primary workspace root in which the agent executes. */
  readonly cwd: string;
  /** Additional absolute workspace roots visible to the executor. */
  readonly additionalDirectories: readonly string[];
}

export interface ExecutionModelBinding {
  /** Adapter-resolvable model selector/pattern chosen before executor invocation. */
  readonly selector: string;
  readonly reasoningProfile: ReasoningProfile;
}

export interface ExecutionToolPolicy {
  /** v1 is fail-closed: only named tools may be active. */
  readonly mode: "ALLOWLIST";
  readonly toolNames: readonly string[];
}

export interface StructuredExecutionOutputContract {
  readonly mode: "STRUCTURED";
  /** Stable contract/schema identifier used for provenance. */
  readonly schemaRef: string;
  /** Materialized JSON Schema presented to/validated by the executor adapter. */
  readonly jsonSchema: Readonly<Record<string, unknown>>;
}

/**
 * Immutable, application-materialized input required to launch one execution.
 *
 * The generic dispatcher deliberately does not construct this object. An
 * executor adapter resolves it by the stable ExecutionId and validates that its
 * provenance exactly matches the ExecutorStartRequest before invoking a model.
 */
export interface ExecutionLaunchSpec {
  readonly executionId: ExecutionId;
  readonly runId: RunId;
  readonly graphId: GraphId;
  readonly graphVersion: string;
  readonly nodeId: NodeId;
  readonly attempt: number;

  readonly boundArtifactIds: readonly ArtifactId[];
  readonly boundEvidenceIds: readonly EvidenceId[];
  readonly boundApprovalIds: readonly ApprovalId[];

  readonly workspace: ExecutionWorkspaceBinding;
  /** Fully materialized task instruction. No hidden artifact lookup is allowed after this boundary. */
  readonly instruction: string;
  readonly model: ExecutionModelBinding;
  readonly tools: ExecutionToolPolicy;
  readonly output: StructuredExecutionOutputContract;

  /** Absolute epoch milliseconds; the adapter must not extend it implicitly. */
  readonly deadlineEpochMs: number;
}

export type ExecutionLaunchInvalidCode =
  | "IDENTITY_MISMATCH"
  | "BINDING_MISMATCH"
  | "INVALID_WORKSPACE"
  | "INVALID_INSTRUCTION"
  | "INVALID_MODEL"
  | "INVALID_TOOL_POLICY"
  | "INVALID_OUTPUT_CONTRACT"
  | "INVALID_DEADLINE";

export type ResolveExecutionLaunchSpecResult =
  | {
      readonly status: "FOUND";
      readonly spec: ExecutionLaunchSpec;
    }
  | {
      readonly status: "NOT_FOUND";
      readonly executionId: ExecutionId;
    }
  | {
      readonly status: "INVALID";
      readonly code: ExecutionLaunchInvalidCode;
    };

export interface ExecutionLaunchSpecResolver {
  resolve(
    request: ExecutorStartRequest,
  ): Promise<ResolveExecutionLaunchSpecResult>;
}

export type ValidateExecutionLaunchSpecResult =
  | {
      readonly status: "VALID";
      readonly spec: ExecutionLaunchSpec;
    }
  | {
      readonly status: "INVALID";
      readonly code: ExecutionLaunchInvalidCode;
    };

export interface ExecutionLaunchSpecValidator {
  validate(
    request: ExecutorStartRequest,
    spec: ExecutionLaunchSpec,
  ): ValidateExecutionLaunchSpecResult;
}
