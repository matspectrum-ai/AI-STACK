import type {
  ExecutionGraphDefinition,
  ExecutionNodeDefinition,
  ProjectorId,
} from "../../contracts/execution";
import type { ProjectionRunner } from "../../contracts/projection-runner";
import { createProjectionRunner } from "../../src/orchestration/runner/create-projection-runner";
import { createExecutionProjector } from "../../src/orchestration/projector/create-execution-projector";
import {
  createSqliteTestEnvironment,
  type SqliteTestEnvironment,
} from "../persistence/test-env";
import {
  createSqliteExecutionStoreTestEnvironment,
  type SqliteExecutionStoreTestEnvironment,
} from "./execution-store-test-env";
import {
  createGraphRegistryTestEnvironment,
  type GraphRegistryTestEnvironment,
} from "./graph-registry-test-env";
import {
  IDS,
  createRunRequest,
  transitionCommit,
} from "../persistence/fixtures";

export const RUNNER_PROJECTOR_ID = "projector:journal-runner" as ProjectorId;

function executionNode(
  nodeId: ExecutionNodeDefinition["nodeId"],
  executionMode: ExecutionNodeDefinition["executionMode"],
): ExecutionNodeDefinition {
  return {
    nodeId,
    kind: executionMode === "dispatch" ? "implementation" : "specification",
    executionMode,
    requiredArtifactKinds: [],
    requiredGateIds: [],
    outputContracts: [],
  };
}

export function authoritativeExecutionGraph(
  version = "1",
): ExecutionGraphDefinition {
  return {
    graphId: IDS.graph,
    graphVersion: version,
    nodes: [
      executionNode(IDS.active, "control"),
      executionNode(IDS.implementation, "dispatch"),
    ],
    edges: [
      {
        edgeId: IDS.edge,
        fromNodeId: IDS.active,
        toNodeId: IDS.implementation,
        kind: "forward",
        gateIds: [],
        policyIds: [],
      },
    ],
    entryNodeIds: [IDS.active],
    terminalNodeIds: [IDS.implementation],
  };
}

export interface ProjectionRunnerTestEnvironment {
  readonly authority: SqliteTestEnvironment;
  readonly execution: SqliteExecutionStoreTestEnvironment;
  readonly registry: GraphRegistryTestEnvironment;
  readonly runner: ProjectionRunner;
  registerGraph(): Promise<void>;
  seedRun(options?: { readonly transition?: boolean }): Promise<void>;
  cleanup(): Promise<void>;
}

export async function createProjectionRunnerTestEnvironment(options?: {
  readonly batchSize?: number;
}): Promise<ProjectionRunnerTestEnvironment> {
  const authority = await createSqliteTestEnvironment();
  const execution = await createSqliteExecutionStoreTestEnvironment();
  const registry = await createGraphRegistryTestEnvironment();
  const projector = createExecutionProjector();

  const createRunner = () =>
    createProjectionRunner({
      journal: { readJournal: authority.store.readJournal.bind(authority.store) },
      registry: registry.registry,
      projector,
      store: execution.store,
      projectorId: RUNNER_PROJECTOR_ID,
      batchSize: options?.batchSize ?? 100,
    });

  return {
    authority,
    execution,
    registry,
    runner: createRunner(),
    async registerGraph() {
      const result = await registry.registry.register(authoritativeExecutionGraph());
      if (result.status !== "REGISTERED" && result.status !== "REPLAYED") {
        throw new Error(`graph registration failed: ${result.status}`);
      }
    },
    async seedRun(seedOptions) {
      const created = await authority.store.createRun(createRunRequest());
      if (created.status !== "CREATED" && created.status !== "REPLAYED") {
        throw new Error(`run creation failed: ${created.status}`);
      }
      if (seedOptions?.transition ?? true) {
        const committed = await authority.store.commit(transitionCommit(0));
        if (committed.status !== "COMMITTED" && committed.status !== "REPLAYED") {
          throw new Error(`transition commit failed: ${committed.status}`);
        }
      }
    },
    async cleanup() {
      await Promise.all([
        authority.cleanup(),
        execution.cleanup(),
        registry.cleanup(),
      ]);
    },
  };
}
