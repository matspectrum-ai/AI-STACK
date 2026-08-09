import { expect, test } from "bun:test";
import { createExecutionProjector } from "../../src/orchestration/projector/create-execution-projector";
import { IDS, graph, retryEntry, transitionEntry } from "./projector-fixtures";

const projector = createExecutionProjector();
const CREATED_AT = "2026-08-09T06:10:00.000Z";

test("ORCH-005: same node with a different attempt derives a different execution ID", () => {
  const initial = projector.derive(transitionEntry(), graph(), CREATED_AT);
  const retry = projector.derive(retryEntry(2, IDS.dispatch), graph(), CREATED_AT);

  expect(initial.status).toBe("PROJECTED");
  expect(retry.status).toBe("PROJECTED");
  if (initial.status !== "PROJECTED" || retry.status !== "PROJECTED") {
    throw new Error("expected projected intents");
  }

  const first = initial.projection.intents[0]!;
  const second = retry.projection.intents[0]!;
  expect(first.nodeId).toBe(second.nodeId);
  expect(first.attempt).toBe(1);
  expect(second.attempt).toBe(2);
  expect(first.executionId).not.toBe(second.executionId);
});
