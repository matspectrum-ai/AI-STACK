import { describe, expect, test } from "bun:test";
import type {
  ApprovalPresentGateDefinition,
  EvidenceValidGateDefinition,
  GraphDefinition,
  PolicyResult,
} from "../../contracts/domain";
import { createGraphKernel } from "../../src/domain/create-graph-kernel";
import {
  IDS,
  approval,
  approvalGate,
  artifact,
  asArtifactId,
  asEdgeId,
  asGateId,
  asGraphId,
  asNodeId,
  asRevision,
  evidence,
  failure,
  gateResult,
  graph,
  policyResult,
  retryPolicy,
  state,
  transitionContext,
  transitionRequest,
} from "./fixtures";

const kernel = createGraphKernel();

function implementationArtifacts() {
  const spec = artifact(IDS.spec, "specification");
  const contract = artifact(IDS.contract, "contract", [IDS.spec]);
  return { spec, contract };
}

function implementationContext() {
  const { spec, contract } = implementationArtifacts();
  return transitionContext({
    state: state({
      artifactRefs: [spec.artifactId, contract.artifactId],
    }),
    artifacts: [spec, contract],
    gateResults: [gateResult(IDS.redGate, "PASS")],
  });
}

function graphWithPolicy(outcome: PolicyResult["outcome"]) {
  const base = graph();
  return {
    definition: {
      ...base,
      edges: base.edges.map((edge) =>
        edge.edgeId === IDS.redToImplementation
          ? { ...edge, policyIds: [IDS.policy] }
          : edge,
      ),
    } satisfies GraphDefinition,
    result: policyResult(
      outcome,
      outcome === "DENY"
        ? ["POLICY_DENIED"]
        : outcome === "INDETERMINATE"
          ? ["POLICY_INDETERMINATE"]
          : [],
    ),
  };
}

describe("graph definition contracts", () => {
  test("DOMAIN-029: valid graph has no structural errors", () => {
    expect(kernel.validateGraph(graph())).toEqual([]);
  });

  test("DOMAIN-029: missing edge endpoint rejects graph", () => {
    const base = graph();
    const invalid = {
      ...base,
      edges: [
        ...base.edges,
        {
          edgeId: asEdgeId("edge:broken"),
          fromNodeId: asNodeId("node:missing"),
          toNodeId: IDS.implementationNode,
          kind: "forward" as const,
          gateIds: [],
          policyIds: [],
        },
      ],
    };

    expect(kernel.validateGraph(invalid)).toContain("INVALID_GRAPH_DEFINITION");
  });

  test("DOMAIN-036: duplicate node IDs reject graph", () => {
    const base = graph();
    const invalid = { ...base, nodes: [...base.nodes, base.nodes[0]!] };
    expect(kernel.validateGraph(invalid)).toContain("INVALID_GRAPH_DEFINITION");
  });

  test("DOMAIN-036: duplicate edge IDs reject graph", () => {
    const base = graph();
    const invalid = { ...base, edges: [...base.edges, base.edges[0]!] };
    expect(kernel.validateGraph(invalid)).toContain("INVALID_GRAPH_DEFINITION");
  });

  test("DOMAIN-038: non-entry executable node requires inbound edge", () => {
    const base = graph();
    const orphan = {
      nodeId: asNodeId("node:orphan"),
      kind: "implementation" as const,
      requiredArtifactKinds: [],
      requiredGateIds: [],
      outputContracts: [],
    };
    const invalid = { ...base, nodes: [...base.nodes, orphan] };
    expect(kernel.validateGraph(invalid)).toContain("INVALID_GRAPH_DEFINITION");
  });

  test("DOMAIN-037: opaque identifier shape has no semantic effect", () => {
    const base = graph();
    const opaque = {
      ...base,
      graphId: asGraphId("🧪/opaque::graph::001"),
    };
    expect(kernel.validateGraph(opaque)).toEqual([]);
  });

  test("DOMAIN-030: activated graph version cannot be mutated in place", () => {
    const activated = graph();
    const proposed = {
      ...activated,
      terminalNodeIds: [IDS.releaseNode],
    };
    expect(kernel.validateGraphReplacement(activated, proposed)).toContain(
      "INVALID_GRAPH_DEFINITION",
    );
  });

  test("DOMAIN-030: a changed definition may use a new graph version", () => {
    const activated = graph();
    const proposed = {
      ...activated,
      graphVersion: "2",
      terminalNodeIds: [IDS.releaseNode],
    };
    expect(kernel.validateGraphReplacement(activated, proposed)).toEqual([]);
  });
});

describe("gate contracts", () => {
  test("DOMAIN-001: artifact gate fails when specification is absent", () => {
    const result = kernel.evaluateGate(
      {
        gateId: asGateId("gate:spec"),
        gateType: "artifact_present",
        artifactKind: "specification",
        missingReason: "MISSING_REQUIRED_SPECIFICATION",
      },
      {
        state: state(),
        artifacts: [],
        evidence: [],
        approvals: [],
        requestedByExecutorId: IDS.requester,
        now: "2026-08-09T05:00:00.000Z",
      },
    );

    expect(result.outcome).toBe("FAIL");
    expect(result.reasonCodes).toContain("MISSING_REQUIRED_SPECIFICATION");
  });

  test("artifact gate passes only for an artifact referenced by run state", () => {
    const spec = artifact(IDS.spec, "specification");
    const result = kernel.evaluateGate(
      {
        gateId: asGateId("gate:spec"),
        gateType: "artifact_present",
        artifactKind: "specification",
        missingReason: "MISSING_REQUIRED_SPECIFICATION",
      },
      {
        state: state({ artifactRefs: [spec.artifactId] }),
        artifacts: [spec],
        evidence: [],
        approvals: [],
        requestedByExecutorId: IDS.requester,
        now: "2026-08-09T05:00:00.000Z",
      },
    );

    expect(result.outcome).toBe("PASS");
    expect(result.boundArtifactIds).toEqual([spec.artifactId]);
  });

  test("DOMAIN-003: missing RED evidence fails closed", () => {
    const testArtifact = artifact(IDS.test, "test_definition");
    const gate: EvidenceValidGateDefinition = {
      gateId: IDS.redGate,
      gateType: "evidence_valid",
      evidenceType: "test_red",
      subject: { kind: "artifact_kind", artifactKind: "test_definition" },
      missingReason: "MISSING_VALID_RED_EVIDENCE",
      invalidReason: "INVALID_RED_EVIDENCE",
    };
    const result = kernel.evaluateGate(gate, {
      state: state({ artifactRefs: [testArtifact.artifactId] }),
      artifacts: [testArtifact],
      evidence: [],
      approvals: [],
      requestedByExecutorId: IDS.requester,
      now: "2026-08-09T05:00:00.000Z",
    });

    expect(result.outcome).toBe("FAIL");
    expect(result.reasonCodes).toContain("MISSING_VALID_RED_EVIDENCE");
  });

  test.each(["INVALID", "UNVERIFIED", "EXPIRED"] as const)(
    "DOMAIN-004/021/022/023: %s evidence cannot satisfy RED gate",
    (status) => {
      const testArtifact = artifact(IDS.test, "test_definition");
      const red = evidence(IDS.redEvidence, "test_red", IDS.test, status);
      const gate: EvidenceValidGateDefinition = {
        gateId: IDS.redGate,
        gateType: "evidence_valid",
        evidenceType: "test_red",
        subject: { kind: "artifact_kind", artifactKind: "test_definition" },
        missingReason: "MISSING_VALID_RED_EVIDENCE",
        invalidReason: "INVALID_RED_EVIDENCE",
      };
      const result = kernel.evaluateGate(gate, {
        state: state({
          artifactRefs: [testArtifact.artifactId],
          evidenceRefs: [red.evidenceId],
        }),
        artifacts: [testArtifact],
        evidence: [red],
        approvals: [],
        requestedByExecutorId: IDS.requester,
        now: "2026-08-09T05:00:00.000Z",
      });

      expect(result.outcome).toBe("FAIL");
      expect(result.reasonCodes).toContain("INVALID_RED_EVIDENCE");
    },
  );

  test("valid RED evidence passes and is bound", () => {
    const testArtifact = artifact(IDS.test, "test_definition");
    const red = evidence(IDS.redEvidence, "test_red", IDS.test, "VALID");
    const gate: EvidenceValidGateDefinition = {
      gateId: IDS.redGate,
      gateType: "evidence_valid",
      evidenceType: "test_red",
      subject: { kind: "artifact_kind", artifactKind: "test_definition" },
      missingReason: "MISSING_VALID_RED_EVIDENCE",
      invalidReason: "INVALID_RED_EVIDENCE",
    };
    const result = kernel.evaluateGate(gate, {
      state: state({
        artifactRefs: [testArtifact.artifactId],
        evidenceRefs: [red.evidenceId],
      }),
      artifacts: [testArtifact],
      evidence: [red],
      approvals: [],
      requestedByExecutorId: IDS.requester,
      now: "2026-08-09T05:00:00.000Z",
    });

    expect(result.outcome).toBe("PASS");
    expect(result.boundEvidenceIds).toEqual([red.evidenceId]);
    expect(result.boundArtifactIds).toEqual([testArtifact.artifactId]);
  });

  test("DOMAIN-007: approval must match subject, action, and scope", () => {
    const gate = approvalGate();
    const wrongScope = approval({ scope: "release" });
    const result = kernel.evaluateGate(gate, {
      state: state({ approvalRefs: [wrongScope.approvalId] }),
      artifacts: [artifact(IDS.spec, "specification")],
      evidence: [],
      approvals: [wrongScope],
      requestedByExecutorId: IDS.requester,
      subjectExecutorId: IDS.worker,
      now: "2026-08-09T05:00:00.000Z",
    });

    expect(result.outcome).toBe("FAIL");
    expect(result.reasonCodes).toContain("APPROVAL_REQUIRED");
  });

  test("DOMAIN-008: expired approval fails closed", () => {
    const expired = approval({ expiresAt: "2026-08-09T04:30:00.000Z" });
    const result = kernel.evaluateGate(approvalGate(), {
      state: state({ approvalRefs: [expired.approvalId] }),
      artifacts: [artifact(IDS.spec, "specification")],
      evidence: [],
      approvals: [expired],
      requestedByExecutorId: IDS.requester,
      subjectExecutorId: IDS.worker,
      now: "2026-08-09T05:00:00.000Z",
    });

    expect(result.outcome).toBe("FAIL");
    expect(result.reasonCodes).toContain("APPROVAL_EXPIRED");
  });

  test("DOMAIN-006: executor cannot self-approve its own work", () => {
    const selfApproval = approval({ approverExecutorId: IDS.worker });
    const result = kernel.evaluateGate(approvalGate(), {
      state: state({ approvalRefs: [selfApproval.approvalId] }),
      artifacts: [artifact(IDS.spec, "specification")],
      evidence: [],
      approvals: [selfApproval],
      requestedByExecutorId: IDS.requester,
      subjectExecutorId: IDS.worker,
      now: "2026-08-09T05:00:00.000Z",
    });

    expect(result.outcome).toBe("FAIL");
    expect(result.reasonCodes).toContain("SELF_APPROVAL_FORBIDDEN");
  });

  test("independent current approval passes and is bound", () => {
    const current = approval({ expiresAt: "2026-08-10T00:00:00.000Z" });
    const result = kernel.evaluateGate(approvalGate(), {
      state: state({ approvalRefs: [current.approvalId] }),
      artifacts: [artifact(IDS.spec, "specification")],
      evidence: [],
      approvals: [current],
      requestedByExecutorId: IDS.requester,
      subjectExecutorId: IDS.worker,
      now: "2026-08-09T05:00:00.000Z",
    });

    expect(result.outcome).toBe("PASS");
    expect(result.boundApprovalIds).toEqual([current.approvalId]);
  });

  test("DOMAIN-034/041: identical gate inputs are deterministic and not mutated", () => {
    const current = approval();
    const gate: ApprovalPresentGateDefinition = approvalGate();
    const context = {
      state: state({ approvalRefs: [current.approvalId] }),
      artifacts: [artifact(IDS.spec, "specification")],
      evidence: [],
      approvals: [current],
      requestedByExecutorId: IDS.requester,
      subjectExecutorId: IDS.worker,
      now: "2026-08-09T05:00:00.000Z",
    };
    const before = structuredClone(context);

    expect(kernel.evaluateGate(gate, context)).toEqual(kernel.evaluateGate(gate, context));
    expect(context).toEqual(before);
  });
});

describe("transition verdict contracts", () => {
  test("DOMAIN-001: implementation without specification is denied", () => {
    const contract = artifact(IDS.contract, "contract");
    const verdict = kernel.evaluateTransition(transitionRequest(),
      transitionContext({
        state: state({ artifactRefs: [contract.artifactId] }),
        artifacts: [contract],
        gateResults: [gateResult(IDS.redGate, "PASS")],
      }),
    );

    expect(verdict.decision).toBe("DENY");
    expect(verdict.reasonCodes).toContain("MISSING_REQUIRED_SPECIFICATION");
  });

  test("DOMAIN-002: implementation without contract is denied", () => {
    const spec = artifact(IDS.spec, "specification");
    const verdict = kernel.evaluateTransition(transitionRequest(),
      transitionContext({
        state: state({ artifactRefs: [spec.artifactId] }),
        artifacts: [spec],
        gateResults: [gateResult(IDS.redGate, "PASS")],
      }),
    );

    expect(verdict.decision).toBe("DENY");
    expect(verdict.reasonCodes).toContain("MISSING_REQUIRED_CONTRACT");
  });

  test("DOMAIN-003/032/046: missing mandatory gate result fails closed", () => {
    const { spec, contract } = implementationArtifacts();
    const verdict = kernel.evaluateTransition(transitionRequest(),
      transitionContext({
        state: state({ artifactRefs: [spec.artifactId, contract.artifactId] }),
        artifacts: [spec, contract],
        gateResults: [],
      }),
    );

    expect(verdict.decision).toBe("DENY");
    expect(verdict.reasonCodes).toContain("GATE_INDETERMINATE");
  });

  test("DOMAIN-031: edge existence does not override failed gate", () => {
    const context = implementationContext();
    const verdict = kernel.evaluateTransition(transitionRequest(), {
      ...context,
      gateResults: [gateResult(IDS.redGate, "FAIL", ["INVALID_RED_EVIDENCE"])],
    });

    expect(verdict.decision).toBe("DENY");
    expect(verdict.reasonCodes).toContain("INVALID_RED_EVIDENCE");
  });

  test("DOMAIN-032: INDETERMINATE gate blocks transition", () => {
    const context = implementationContext();
    const verdict = kernel.evaluateTransition(transitionRequest(), {
      ...context,
      gateResults: [gateResult(IDS.redGate, "INDETERMINATE", ["GATE_INDETERMINATE"])],
    });

    expect(verdict.decision).toBe("DENY");
    expect(verdict.reasonCodes).toContain("GATE_INDETERMINATE");
  });

  test("DOMAIN-012: stale state revision is denied", () => {
    const verdict = kernel.evaluateTransition(
      transitionRequest({ expectedStateRevision: asRevision(0) }),
      implementationContext(),
    );

    expect(verdict.decision).toBe("DENY");
    expect(verdict.reasonCodes).toContain("STALE_STATE_REVISION");
  });

  test("DOMAIN-033: INDETERMINATE policy blocks transition", () => {
    const { definition, result } = graphWithPolicy("INDETERMINATE");
    const context = implementationContext();
    const verdict = kernel.evaluateTransition(transitionRequest(), {
      ...context,
      graph: definition,
      policyResults: [result],
    });

    expect(verdict.decision).toBe("DENY");
    expect(verdict.reasonCodes).toContain("POLICY_INDETERMINATE");
  });

  test("policy DENY blocks transition", () => {
    const { definition, result } = graphWithPolicy("DENY");
    const context = implementationContext();
    const verdict = kernel.evaluateTransition(transitionRequest(), {
      ...context,
      graph: definition,
      policyResults: [result],
    });

    expect(verdict.decision).toBe("DENY");
    expect(verdict.reasonCodes).toContain("POLICY_DENIED");
  });

  test("policy REQUIRE_APPROVAL pauses transition", () => {
    const { definition, result } = graphWithPolicy("REQUIRE_APPROVAL");
    const context = implementationContext();
    const verdict = kernel.evaluateTransition(transitionRequest(), {
      ...context,
      graph: definition,
      policyResults: [result],
    });

    expect(verdict.decision).toBe("PAUSE");
    expect(verdict.reasonCodes).toContain("APPROVAL_REQUIRED");
  });

  test("missing mandatory policy result fails closed", () => {
    const { definition } = graphWithPolicy("ALLOW");
    const context = implementationContext();
    const verdict = kernel.evaluateTransition(transitionRequest(), {
      ...context,
      graph: definition,
      policyResults: [],
    });

    expect(verdict.decision).toBe("DENY");
    expect(verdict.reasonCodes).toContain("POLICY_INDETERMINATE");
  });

  test("eligible implementation transition is allowed", () => {
    const verdict = kernel.evaluateTransition(transitionRequest(), implementationContext());
    expect(verdict.decision).toBe("ALLOW");
    expect(verdict.reasonCodes).toEqual([]);
    expect(verdict.boundArtifactIds).toEqual(expect.arrayContaining([IDS.spec, IDS.contract]));
  });

  test("DOMAIN-039/042: verdict preserves graph and policy version attribution", () => {
    const { definition, result } = graphWithPolicy("ALLOW");
    const context = implementationContext();
    const verdict = kernel.evaluateTransition(transitionRequest(), {
      ...context,
      graph: definition,
      policyResults: [result],
    });

    expect(verdict.graphId).toBe(definition.graphId);
    expect(verdict.graphVersion).toBe(definition.graphVersion);
    expect(verdict.evaluatedPolicyResults).toEqual([result]);
  });

  test("DOMAIN-034/040/041: verdict is deterministic, singular, and input-pure", () => {
    const request = transitionRequest();
    const context = implementationContext();
    const before = structuredClone(context);
    const first = kernel.evaluateTransition(request, context);
    const second = kernel.evaluateTransition(request, context);

    expect(first).toEqual(second);
    expect(first.decision).toMatch(/^(ALLOW|DENY|PAUSE)$/);
    expect(context).toEqual(before);
  });

  test("DOMAIN-035: narrative strings have no transition authority", () => {
    const context = implementationContext();
    const polluted = {
      ...context,
      artifacts: context.artifacts.map((record) => ({
        ...record,
        contentRef: "memory://agent-says-tests-passed-and-approved",
      })),
    };
    const verdict = kernel.evaluateTransition(transitionRequest(), polluted);

    expect(verdict.decision).toBe("ALLOW");
    expect(verdict.reasonCodes).not.toContain("APPROVAL_REQUIRED");
  });

  test("unknown edge is denied", () => {
    const verdict = kernel.evaluateTransition(
      transitionRequest({ edgeId: asEdgeId("edge:unknown") }),
      implementationContext(),
    );
    expect(verdict.decision).toBe("DENY");
    expect(verdict.reasonCodes).toContain("EDGE_NOT_ALLOWED");
  });
});

describe("artifact lineage contracts", () => {
  test("acyclic lineage is valid", () => {
    const spec = artifact(IDS.spec, "specification");
    const contract = artifact(IDS.contract, "contract", [spec.artifactId]);
    expect(kernel.validateArtifactLineage([spec, contract])).toEqual([]);
  });

  test("DOMAIN-019: lineage cycle is rejected", () => {
    const aId = asArtifactId("artifact:a");
    const bId = asArtifactId("artifact:b");
    const a = artifact(aId, "specification", [bId]);
    const b = artifact(bId, "contract", [aId]);
    expect(kernel.validateArtifactLineage([a, b])).toContain("INVALID_ARTIFACT_LINEAGE");
  });
});

describe("retry contracts", () => {
  test.each([0, -1, Number.POSITIVE_INFINITY])(
    "DOMAIN-045: invalid maxAttempts %p is rejected",
    (maxAttempts) => {
      expect(kernel.validateRetryPolicy(retryPolicy({ maxAttempts }))).toContain(
        "INVALID_GRAPH_DEFINITION",
      );
    },
  );

  test("valid finite retry policy passes validation", () => {
    expect(kernel.validateRetryPolicy(retryPolicy())).toEqual([]);
  });

  test("DOMAIN-025: non-retryable failure cannot auto-retry", () => {
    const decision = kernel.evaluateRetry(
      failure({ retryability: "NON_RETRYABLE" }),
      retryPolicy(),
      0,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain("NON_RETRYABLE_FAILURE");
  });

  test("failure class outside retry policy cannot auto-retry", () => {
    const decision = kernel.evaluateRetry(
      failure({ failureClass: "CONTRACT_VIOLATION" }),
      retryPolicy(),
      0,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain("NON_RETRYABLE_FAILURE");
  });

  test("retry is allowed below budget for declared retryable failure", () => {
    const decision = kernel.evaluateRetry(failure(), retryPolicy(), 1);
    expect(decision.allowed).toBe(true);
    expect(decision.nextAttempt).toBe(2);
  });

  test("DOMAIN-026/028: exhausted retry budget routes to explicit edge", () => {
    const policy = retryPolicy();
    const decision = kernel.evaluateRetry(failure(), policy, policy.maxAttempts);
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain("RETRY_BUDGET_EXHAUSTED");
    expect(decision.exhaustionEdgeId).toBe(policy.exhaustionEdgeId);
  });
});
