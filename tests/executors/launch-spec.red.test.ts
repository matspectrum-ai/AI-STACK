import { describe, expect, test } from "bun:test";
import type { ExecutionLaunchSpec } from "../../contracts/execution-launch";
import { createExecutionLaunchSpecValidator } from "../../src/executors/launch/create-execution-launch-spec-validator";
import { IDS, launchSpec, startRequest } from "./fixtures";

const validator = createExecutionLaunchSpecValidator();

function expectInvalid(
  spec: ExecutionLaunchSpec,
  code:
    | "IDENTITY_MISMATCH"
    | "BINDING_MISMATCH"
    | "INVALID_WORKSPACE"
    | "INVALID_INSTRUCTION"
    | "INVALID_MODEL"
    | "INVALID_TOOL_POLICY"
    | "INVALID_OUTPUT_CONTRACT"
    | "INVALID_DEADLINE",
) {
  expect(validator.validate(startRequest(), spec)).toEqual({ status: "INVALID", code });
}

describe("ExecutionLaunchSpec validator", () => {
  test("LAUNCH-001: exact execution identity is required", () => {
    expect(validator.validate(startRequest(), launchSpec())).toEqual({
      status: "VALID",
      spec: launchSpec(),
    });

    expectInvalid(
      launchSpec({ executionId: "execution:other" as typeof IDS.execution }),
      "IDENTITY_MISMATCH",
    );
    expectInvalid(
      launchSpec({ graphVersion: "2" }),
      "IDENTITY_MISMATCH",
    );
    expectInvalid(
      launchSpec({ attempt: 2 }),
      "IDENTITY_MISMATCH",
    );
  });

  test("LAUNCH-002: provenance bindings must match exactly", () => {
    expectInvalid(launchSpec({ boundArtifactIds: [] }), "BINDING_MISMATCH");
    expectInvalid(launchSpec({ boundEvidenceIds: [] }), "BINDING_MISMATCH");
    expectInvalid(launchSpec({ boundApprovalIds: [] }), "BINDING_MISMATCH");
  });

  test("LAUNCH-003: workspace roots must be explicit absolute normalized paths", () => {
    expectInvalid(
      launchSpec({ workspace: { cwd: "relative/work", additionalDirectories: [] } }),
      "INVALID_WORKSPACE",
    );
    expectInvalid(
      launchSpec({ workspace: { cwd: "/workspace/../other", additionalDirectories: [] } }),
      "INVALID_WORKSPACE",
    );
    expectInvalid(
      launchSpec({
        workspace: { cwd: "/workspace/project", additionalDirectories: ["relative/shared"] },
      }),
      "INVALID_WORKSPACE",
    );
  });

  test("LAUNCH-004: instruction must be materialized and non-empty", () => {
    expectInvalid(launchSpec({ instruction: "   " }), "INVALID_INSTRUCTION");
  });

  test("LAUNCH-005: model selector and reasoning profile are explicit", () => {
    expectInvalid(
      launchSpec({ model: { selector: "", reasoningProfile: "high" } }),
      "INVALID_MODEL",
    );
    expectInvalid(
      launchSpec({
        model: {
          selector: "openai/gpt-5.6",
          reasoningProfile: "turbo" as "high",
        },
      }),
      "INVALID_MODEL",
    );
  });

  test("LAUNCH-006: tool policy is a unique non-empty allowlist", () => {
    expect(validator.validate(startRequest(), launchSpec({
      tools: { mode: "ALLOWLIST", toolNames: [] },
    })).status).toBe("VALID");

    expectInvalid(
      launchSpec({ tools: { mode: "ALLOWLIST", toolNames: ["read", ""] } }),
      "INVALID_TOOL_POLICY",
    );
    expectInvalid(
      launchSpec({ tools: { mode: "ALLOWLIST", toolNames: ["read", "read"] } }),
      "INVALID_TOOL_POLICY",
    );
  });

  test("LAUNCH-007: structured output contract requires schema identity and object schema", () => {
    expectInvalid(
      launchSpec({
        output: { mode: "STRUCTURED", schemaRef: "", jsonSchema: {} },
      }),
      "INVALID_OUTPUT_CONTRACT",
    );
    expectInvalid(
      launchSpec({
        output: {
          mode: "STRUCTURED",
          schemaRef: "schema://valid",
          jsonSchema: [] as unknown as Readonly<Record<string, unknown>>,
        },
      }),
      "INVALID_OUTPUT_CONTRACT",
    );
  });

  test("LAUNCH-008: deadline is a finite positive epoch value", () => {
    expectInvalid(launchSpec({ deadlineEpochMs: Number.NaN }), "INVALID_DEADLINE");
    expectInvalid(launchSpec({ deadlineEpochMs: Number.POSITIVE_INFINITY }), "INVALID_DEADLINE");
    expectInvalid(launchSpec({ deadlineEpochMs: 0 }), "INVALID_DEADLINE");
  });

  test("validation does not mutate the caller's request/spec", () => {
    const request = startRequest();
    const spec = launchSpec();
    const beforeRequest = structuredClone(request);
    const beforeSpec = structuredClone(spec);
    validator.validate(request, spec);
    expect(request).toEqual(beforeRequest);
    expect(spec).toEqual(beforeSpec);
  });
});
