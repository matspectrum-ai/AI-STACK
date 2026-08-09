import { describe, expect, test } from "bun:test";
import type {
  ExecutionGraphDefinition,
  ExecutionProjectionResult,
} from "../../contracts/execution";
import { createExecutionProjector } from "../../src/orchestration/projector/create-execution-projector";
import {
  IDS,
  asEdgeId,
  asGraphId,
  asNodeId,
  asOperationId,
  asSequence,
  failureEntry,
  graph,
  journalEntry,
  node,
  recoveryEntry,
  retryEntry,
  runCreatedEntry,
  transitionDecision,
  transitionEntry,
} from "./projector-fixtures";

const projector = createExecutionProjector();
const CREATED_AT = "2026-08-09T06:10:00.000Z";

function projected(result: ExecutionProjectionResult) {
  expect(result.status).toBe("PROJECTED");
  if (result.status !== "PROJECTED") throw new Error("expected PROJECTED");
  return result.projection;
}

describe("pure execution projector", () => {
  test("ORCH-001: executable transition projects exactly one pending attempt", () => {
    const projection = projected(projector.derive(transitionEntry(), graph(), CREATED_AT));
    expect(projection.intents).toHaveLength(1);
    const intent = projection.intents[0]!;
    expect(intent.runId).toBe(IDS.run);
    expect(intent.graphId).toBe(IDS.graph);
    expect(intent.graphVersion).toBe("1");
    expect(intent.nodeId).toBe(IDS.dispatch);
    expect(Number(intent.sourceJournalSequence)).toBe(1);
    expect(intent.sourceOperationId).toBe(asOperationId("op:1"));
    expect(intent.attempt).toBe(1);
    expect(intent.status).toBe("PENDING");
    expect(intent.createdAt).toBe(CREATED_AT);
  });

  test("ORCH-002: control transition projects no intent", () => {
    const projection = projected(
      projector.derive(transitionEntry(IDS.controlEdge), graph(), CREATED_AT),
    );
    expect(projection.intents).toEqual([]);
  });

  test("ORCH-003/004: identical projection input derives equivalent stable execution ID", () => {
    const entry = transitionEntry();
    const definition = graph();
    const first = projected(projector.derive(entry, definition, CREATED_AT));
    const second = projected(projector.derive(entry, definition, CREATED_AT));
    expect(first).toEqual(second);
    expect(first.intents[0]!.executionId).toBe(second.intents[0]!.executionId);
  });

  test("execution ID changes when source journal sequence changes", () => {
    const first = projected(projector.derive(transitionEntry(), graph(), CREATED_AT));
    const secondEntry = transitionEntry(IDS.transitionEdge, {
      sequence: asSequence(2),
      operationId: asOperationId("op:2"),
    });
    const second = projected(projector.derive(secondEntry, graph(), CREATED_AT));
    expect(first.intents[0]!.executionId).not.toBe(second.intents[0]!.executionId);
  });

  test("ORCH-005/008: retry uses explicit attempt and a different execution ID", () => {
    const initial = projected(projector.derive(transitionEntry(), graph(), CREATED_AT));
    const retry = projected(projector.derive(retryEntry(2), graph(), CREATED_AT));
    expect(retry.intents).toHaveLength(1);
    expect(retry.intents[0]!.attempt).toBe(2);
    expect(retry.intents[0]!.nodeId).toBe(IDS.retry);
    expect(retry.intents[0]!.executionId).not.toBe(initial.intents[0]!.executionId);
  });

  test("ORCH-006: transition bindings propagate exactly", () => {
    const intent = projected(projector.derive(transitionEntry(), graph(), CREATED_AT)).intents[0]!;
    expect(intent.boundArtifactIds).toEqual([IDS.artifact]);
    expect(intent.boundEvidenceIds).toEqual([IDS.evidence]);
    expect(intent.boundApprovalIds).toEqual([IDS.approval]);
  });

  test("ORCH-007: destination executor policy propagates", () => {
    const intent = projected(projector.derive(transitionEntry(), graph(), CREATED_AT)).intents[0]!;
    expect(intent.executorPolicyId).toBe(IDS.executorPolicy);
  });

  test("ORCH-009: retry to control node produces no intent", () => {
    const projection = projected(projector.derive(retryEntry(2, IDS.control), graph(), CREATED_AT));
    expect(projection.intents).toEqual([]);
  });

  test("ORCH-010: recovery dispatch projection is deterministic", () => {
    const first = projected(projector.derive(recoveryEntry(), graph(), CREATED_AT));
    const second = projected(projector.derive(recoveryEntry(), graph(), CREATED_AT));
    expect(first).toEqual(second);
    expect(first.intents).toHaveLength(1);
    expect(first.intents[0]!.nodeId).toBe(IDS.recovery);
    expect(first.intents[0]!.attempt).toBe(1);
    expect(first.intents[0]!.boundArtifactIds).toEqual([]);
    expect(first.intents[0]!.boundEvidenceIds).toEqual([]);
    expect(first.intents[0]!.boundApprovalIds).toEqual([]);
  });

  test("recovery to control node produces no intent", () => {
    const projection = projected(projector.derive(recoveryEntry(IDS.control), graph(), CREATED_AT));
    expect(projection.intents).toEqual([]);
  });

  test("ORCH-011: run creation produces no intent", () => {
    expect(projected(projector.derive(runCreatedEntry(), graph(), CREATED_AT)).intents).toEqual([]);
  });

  test("ORCH-012: failure record produces no intent", () => {
    expect(projected(projector.derive(failureEntry(), graph(), CREATED_AT)).intents).toEqual([]);
  });

  test("ORCH-013: transition referencing absent edge fails closed", () => {
    const entry = journalEntry({
      kind: "transition_committed",
      decision: transitionDecision(asEdgeId("edge:missing")),
    });
    expect(projector.derive(entry, graph(), CREATED_AT)).toEqual({
      status: "INTEGRITY_ERROR",
      code: "PROJECTION_INTEGRITY_FAILURE",
    });
  });

  test("ORCH-014: retry referencing absent node fails closed", () => {
    expect(
      projector.derive(retryEntry(2, asNodeId("node:missing")), graph(), CREATED_AT),
    ).toEqual({
      status: "INTEGRITY_ERROR",
      code: "PROJECTION_INTEGRITY_FAILURE",
    });
  });

  test("ORCH-014: recovery referencing absent node fails closed", () => {
    expect(
      projector.derive(recoveryEntry(asNodeId("node:missing")), graph(), CREATED_AT),
    ).toEqual({
      status: "INTEGRITY_ERROR",
      code: "PROJECTION_INTEGRITY_FAILURE",
    });
  });

  test("ORCH-015: journal/graph identity mismatch fails closed", () => {
    const mismatched = graph({ graphId: asGraphId("graph:other") });
    expect(projector.derive(transitionEntry(), mismatched, CREATED_AT)).toEqual({
      status: "INTEGRITY_ERROR",
      code: "PROJECTION_INTEGRITY_FAILURE",
    });
  });

  test("embedded transition identity mismatch fails closed", () => {
    const entry = journalEntry({
      kind: "transition_committed",
      decision: transitionDecision(IDS.transitionEdge, {
        graphVersion: "2",
      }),
    });
    expect(projector.derive(entry, graph(), CREATED_AT)).toEqual({
      status: "INTEGRITY_ERROR",
      code: "PROJECTION_INTEGRITY_FAILURE",
    });
  });

  test("invalid retry attempt fails closed", () => {
    expect(projector.derive(retryEntry(0), graph(), CREATED_AT)).toEqual({
      status: "INTEGRITY_ERROR",
      code: "PROJECTION_INTEGRITY_FAILURE",
    });
  });

  test("ORCH-054: structurally invalid graph fails with GRAPH_DEFINITION_INVALID", () => {
    const base = graph();
    const invalid: ExecutionGraphDefinition = {
      ...base,
      nodes: [...base.nodes, base.nodes[0]!],
    };
    expect(projector.derive(transitionEntry(), invalid, CREATED_AT)).toEqual({
      status: "INTEGRITY_ERROR",
      code: "GRAPH_DEFINITION_INVALID",
    });
  });

  test("execution metadata does not need to change core node kind semantics", () => {
    const definition = graph({
      nodes: [
        node(IDS.source, "control", { kind: "discovery" }),
        node(IDS.dispatch, "dispatch", { kind: "verification" }),
      ],
      edges: [
        {
          edgeId: IDS.transitionEdge,
          fromNodeId: IDS.source,
          toNodeId: IDS.dispatch,
          kind: "forward",
          gateIds: [],
          policyIds: [],
        },
      ],
      entryNodeIds: [IDS.source],
      terminalNodeIds: [IDS.dispatch],
    });
    const intent = projected(projector.derive(transitionEntry(), definition, CREATED_AT)).intents[0]!;
    expect(intent.nodeId).toBe(IDS.dispatch);
  });

  test("projector is input-pure", () => {
    const entry = transitionEntry();
    const definition = graph();
    const entryBefore = structuredClone(entry);
    const graphBefore = structuredClone(definition);
    projector.derive(entry, definition, CREATED_AT);
    expect(entry).toEqual(entryBefore);
    expect(definition).toEqual(graphBefore);
  });
});
