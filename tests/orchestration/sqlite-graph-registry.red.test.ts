import { describe, expect, test } from "bun:test";
import type {
  EdgeId,
  GateId,
  NodeId,
  PolicyId,
} from "../../contracts/domain";
import type { ExecutionGraphDefinition } from "../../contracts/execution";
import { graph, node, IDS } from "./projector-fixtures";
import { createGraphRegistryTestEnvironment } from "./graph-registry-test-env";

function versioned(version: string): ExecutionGraphDefinition {
  return graph({ graphVersion: version });
}

function richlyOrderedGraph(): ExecutionGraphDefinition {
  const gateA = "gate:a" as GateId;
  const gateB = "gate:b" as GateId;
  const policyA = "policy:a" as PolicyId;
  const policyB = "policy:b" as PolicyId;
  const edgeB = "edge:b" as EdgeId;
  const nodeB = "node:b" as NodeId;

  return graph({
    graphVersion: "canonical",
    nodes: [
      node(IDS.source, "control", {
        requiredArtifactKinds: ["specification", "contract"],
        requiredGateIds: [gateB, gateA],
        outputContracts: [
          {
            contractId: "z",
            artifactKind: "source_change",
            schemaRef: "schema:z",
          },
          {
            contractId: "a",
            artifactKind: "review_report",
            schemaRef: "schema:a",
          },
        ],
      }),
      node(nodeB, "dispatch"),
    ],
    edges: [
      {
        edgeId: edgeB,
        fromNodeId: IDS.source,
        toNodeId: nodeB,
        kind: "forward",
        gateIds: [gateB, gateA],
        policyIds: [policyB, policyA],
      },
    ],
    entryNodeIds: [IDS.source],
    terminalNodeIds: [nodeB],
  });
}

function reorderedEquivalent(): ExecutionGraphDefinition {
  const original = richlyOrderedGraph();
  const source = original.nodes.find((candidate) => candidate.nodeId === IDS.source);
  const dispatch = original.nodes.find((candidate) => candidate.nodeId !== IDS.source);
  const edge = original.edges[0];
  if (!source || !dispatch || !edge) throw new Error("invalid fixture");

  return {
    ...original,
    nodes: [
      dispatch,
      {
        ...source,
        requiredArtifactKinds: [...source.requiredArtifactKinds].reverse(),
        requiredGateIds: [...source.requiredGateIds].reverse(),
        outputContracts: [...source.outputContracts].reverse(),
      },
    ],
    edges: [
      {
        ...edge,
        gateIds: [...edge.gateIds].reverse(),
        policyIds: [...edge.policyIds].reverse(),
      },
    ],
    entryNodeIds: [...original.entryNodeIds].reverse(),
    terminalNodeIds: [...original.terminalNodeIds].reverse(),
  };
}

describe("SQLite immutable GraphDefinitionRegistry", () => {
  test("REG-001: first valid graph registers and exact lookup returns it", async () => {
    const env = await createGraphRegistryTestEnvironment();
    try {
      const definition = versioned("1");
      const registered = await env.registry.register(definition);
      expect(registered.status).toBe("REGISTERED");

      const loaded = await env.registry.get(definition.graphId, "1");
      expect(loaded.status).toBe("FOUND");
      if (loaded.status !== "FOUND") throw new Error("expected FOUND");
      expect(loaded.graph).toEqual(definition);
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-053: exact graph version is required; another version is never substituted", async () => {
    const env = await createGraphRegistryTestEnvironment();
    try {
      await env.registry.register(versioned("1"));
      await env.registry.register(versioned("3"));

      const missing = await env.registry.get(IDS.graph, "2");
      expect(missing).toEqual({ status: "NOT_FOUND" });
    } finally {
      await env.cleanup();
    }
  });

  test("ORCH-054/REG-002: invalid graph is rejected before persistence", async () => {
    const env = await createGraphRegistryTestEnvironment();
    try {
      const invalid = graph({
        graphVersion: "invalid",
        nodes: [node(IDS.source, "control"), node(IDS.source, "dispatch")],
      });
      expect(await env.registry.register(invalid)).toEqual({ status: "INVALID_GRAPH" });
      expect(await env.registry.get(invalid.graphId, invalid.graphVersion)).toEqual({
        status: "NOT_FOUND",
      });
    } finally {
      await env.cleanup();
    }
  });

  test("REG-003: canonically equivalent reorder is an idempotent replay", async () => {
    const env = await createGraphRegistryTestEnvironment();
    try {
      const original = richlyOrderedGraph();
      const equivalent = reorderedEquivalent();
      expect((await env.registry.register(original)).status).toBe("REGISTERED");
      const replay = await env.registry.register(equivalent);
      expect(replay.status).toBe("REPLAYED");

      const loaded = await env.registry.get(original.graphId, original.graphVersion);
      expect(loaded.status).toBe("FOUND");
      if (loaded.status !== "FOUND") throw new Error("expected FOUND");
      expect(loaded.graph.graphId).toBe(original.graphId);
      expect(loaded.graph.graphVersion).toBe(original.graphVersion);
    } finally {
      await env.cleanup();
    }
  });

  test("REG-004: same graph identity cannot be rebound to different semantics", async () => {
    const env = await createGraphRegistryTestEnvironment();
    try {
      const original = versioned("fixed");
      const conflicting = {
        ...original,
        nodes: original.nodes.map((candidate) =>
          candidate.nodeId === IDS.dispatch
            ? { ...candidate, kind: "review" as const }
            : candidate,
        ),
      };
      expect((await env.registry.register(original)).status).toBe("REGISTERED");
      expect(await env.registry.register(conflicting)).toEqual({ status: "CONFLICT" });

      const loaded = await env.registry.get(original.graphId, original.graphVersion);
      expect(loaded.status).toBe("FOUND");
      if (loaded.status !== "FOUND") throw new Error("expected FOUND");
      expect(loaded.graph).toEqual(original);
    } finally {
      await env.cleanup();
    }
  });

  test("REG-005: different graph versions coexist independently", async () => {
    const env = await createGraphRegistryTestEnvironment();
    try {
      const v1 = versioned("1");
      const v2 = versioned("2");
      expect((await env.registry.register(v1)).status).toBe("REGISTERED");
      expect((await env.registry.register(v2)).status).toBe("REGISTERED");
      expect((await env.registry.get(v1.graphId, "1")).status).toBe("FOUND");
      expect((await env.registry.get(v2.graphId, "2")).status).toBe("FOUND");
    } finally {
      await env.cleanup();
    }
  });

  test("REG-006: close/reopen preserves exact immutable definitions", async () => {
    const env = await createGraphRegistryTestEnvironment();
    try {
      const definition = versioned("durable");
      await env.registry.register(definition);
      await env.registry.close();
      const reopened = await env.openAnother();
      const loaded = await reopened.get(definition.graphId, definition.graphVersion);
      expect(loaded.status).toBe("FOUND");
      if (loaded.status !== "FOUND") throw new Error("expected FOUND");
      expect(loaded.graph).toEqual(definition);
    } finally {
      await env.cleanup();
    }
  });

  test("REG-007: concurrent equivalent registrations produce one immutable definition", async () => {
    const env = await createGraphRegistryTestEnvironment();
    try {
      const second = await env.openAnother();
      const definition = richlyOrderedGraph();
      const equivalent = reorderedEquivalent();
      const [a, b] = await Promise.all([
        env.registry.register(definition),
        second.register(equivalent),
      ]);
      const statuses = [a.status, b.status];
      expect(statuses.filter((status) => status === "REGISTERED")).toHaveLength(1);
      expect(statuses.filter((status) => status === "REPLAYED")).toHaveLength(1);
    } finally {
      await env.cleanup();
    }
  });

  test("REG-008: concurrent conflicting registrations produce one winner and one conflict", async () => {
    const env = await createGraphRegistryTestEnvironment();
    try {
      const second = await env.openAnother();
      const first = versioned("race");
      const conflicting: ExecutionGraphDefinition = {
        ...first,
        nodes: first.nodes.map((candidate) =>
          candidate.nodeId === IDS.dispatch
            ? { ...candidate, kind: "qa" as const }
            : candidate,
        ),
      };
      const [a, b] = await Promise.all([
        env.registry.register(first),
        second.register(conflicting),
      ]);
      const statuses = [a.status, b.status];
      expect(statuses.filter((status) => status === "REGISTERED")).toHaveLength(1);
      expect(statuses.filter((status) => status === "CONFLICT")).toHaveLength(1);
    } finally {
      await env.cleanup();
    }
  });

  test("REG-009: corrupted persisted graph fails closed", async () => {
    const env = await createGraphRegistryTestEnvironment();
    try {
      const definition = versioned("corrupt");
      await env.registry.register(definition);
      env.corruptDefinition(definition.graphId, definition.graphVersion, "{bad json");

      expect(await env.registry.get(definition.graphId, definition.graphVersion)).toEqual({
        status: "INTEGRITY_ERROR",
        code: "GRAPH_DEFINITION_INVALID",
      });
    } finally {
      await env.cleanup();
    }
  });

  test("REG-010: public registry exposes no graph-run/executor mutation methods", async () => {
    const env = await createGraphRegistryTestEnvironment();
    try {
      const publicKeys = Object.keys(env.registry).sort();
      expect(publicKeys).toEqual(["close", "get", "register"]);
      expect("commit" in env.registry).toBe(false);
      expect("dispatch" in env.registry).toBe(false);
      expect("start" in env.registry).toBe(false);
      expect("approve" in env.registry).toBe(false);
    } finally {
      await env.cleanup();
    }
  });
});
