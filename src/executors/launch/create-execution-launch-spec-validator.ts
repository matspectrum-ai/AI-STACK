import { isAbsolute, normalize } from "node:path";
import type { ExecutorStartRequest } from "../../../contracts/execution";
import type {
  ExecutionLaunchInvalidCode,
  ExecutionLaunchSpec,
  ExecutionLaunchSpecValidator,
  ValidateExecutionLaunchSpecResult,
} from "../../../contracts/execution-launch";

const REASONING_PROFILES = new Set([
  "minimal",
  "low",
  "medium",
  "high",
  "max",
]);

function invalid(code: ExecutionLaunchInvalidCode): ValidateExecutionLaunchSpecResult {
  return { status: "INVALID", code };
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function validAbsoluteNormalizedPath(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    isAbsolute(value) &&
    normalize(value) === value
  );
}

function validWorkspace(spec: ExecutionLaunchSpec): boolean {
  return (
    validAbsoluteNormalizedPath(spec.workspace.cwd) &&
    spec.workspace.additionalDirectories.every(validAbsoluteNormalizedPath)
  );
}

function validInstruction(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function validModel(spec: ExecutionLaunchSpec): boolean {
  return (
    typeof spec.model.selector === "string" &&
    spec.model.selector.trim().length > 0 &&
    REASONING_PROFILES.has(spec.model.reasoningProfile)
  );
}

function validToolPolicy(spec: ExecutionLaunchSpec): boolean {
  if (spec.tools.mode !== "ALLOWLIST") return false;
  const names = spec.tools.toolNames;
  if (
    names.some(
      (name) => typeof name !== "string" || name.trim().length === 0 || name !== name.trim(),
    )
  ) {
    return false;
  }
  return new Set(names).size === names.length;
}

function validOutputContract(spec: ExecutionLaunchSpec): boolean {
  return (
    spec.output.mode === "STRUCTURED" &&
    typeof spec.output.schemaRef === "string" &&
    spec.output.schemaRef.trim().length > 0 &&
    typeof spec.output.jsonSchema === "object" &&
    spec.output.jsonSchema !== null &&
    !Array.isArray(spec.output.jsonSchema)
  );
}

function validDeadline(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function identityMatches(request: ExecutorStartRequest, spec: ExecutionLaunchSpec): boolean {
  return (
    request.executionId === spec.executionId &&
    request.runId === spec.runId &&
    request.graphId === spec.graphId &&
    request.graphVersion === spec.graphVersion &&
    request.nodeId === spec.nodeId &&
    request.attempt === spec.attempt
  );
}

function bindingsMatch(request: ExecutorStartRequest, spec: ExecutionLaunchSpec): boolean {
  return (
    sameStrings(request.boundArtifactIds, spec.boundArtifactIds) &&
    sameStrings(request.boundEvidenceIds, spec.boundEvidenceIds) &&
    sameStrings(request.boundApprovalIds, spec.boundApprovalIds)
  );
}

export function createExecutionLaunchSpecValidator(): ExecutionLaunchSpecValidator {
  return {
    validate(request, spec) {
      if (!identityMatches(request, spec)) return invalid("IDENTITY_MISMATCH");
      if (!bindingsMatch(request, spec)) return invalid("BINDING_MISMATCH");
      if (!validWorkspace(spec)) return invalid("INVALID_WORKSPACE");
      if (!validInstruction(spec.instruction)) return invalid("INVALID_INSTRUCTION");
      if (!validModel(spec)) return invalid("INVALID_MODEL");
      if (!validToolPolicy(spec)) return invalid("INVALID_TOOL_POLICY");
      if (!validOutputContract(spec)) return invalid("INVALID_OUTPUT_CONTRACT");
      if (!validDeadline(spec.deadlineEpochMs)) return invalid("INVALID_DEADLINE");
      return { status: "VALID", spec };
    },
  };
}
