import { Database } from "bun:sqlite";
import type {
  ExecutionGraphDefinition,
  GraphDefinitionLookupResult,
} from "../../../../contracts/execution";
import type { RegisterGraphDefinitionResult } from "../../../../contracts/graph-registry";
import type {
  ClosableGraphDefinitionRegistry,
  SqliteGraphRegistryOptions,
} from "../../../../contracts/sqlite-graph-registry";
import { canonicalGraphJson } from "../canonicalize-graph";
import { isValidExecutionGraphDefinition } from "../validate-graph-definition";
import { decodeGraphDefinition, encodeGraphDefinition } from "./codec";
import {
  configureGraphRegistrySqlite,
  initializeGraphRegistrySchema,
} from "./schema";

interface GraphRow {
  readonly graph_id: string;
  readonly graph_version: string;
  readonly canonical_json: string;
  readonly definition_json: string;
}

function assertOptions(options: SqliteGraphRegistryOptions): void {
  if (
    typeof options.databasePath !== "string" ||
    options.databasePath.length === 0 ||
    options.databasePath === ":memory:"
  ) {
    throw new Error("SQLite graph registry requires a file-backed databasePath");
  }
  if (
    !Number.isFinite(options.busyTimeoutMs) ||
    !Number.isInteger(options.busyTimeoutMs) ||
    options.busyTimeoutMs < 0
  ) {
    throw new Error("busyTimeoutMs must be a finite non-negative integer");
  }
}

function readGraphRow(
  db: Database,
  graphId: string,
  graphVersion: string,
): GraphRow | undefined {
  const row = db
    .query(
      `SELECT graph_id, graph_version, canonical_json, definition_json
         FROM graph_definitions
        WHERE graph_id = ? AND graph_version = ?`,
    )
    .get(graphId, graphVersion) as GraphRow | null | undefined;
  return row ?? undefined;
}

function decodeExactRow(
  row: GraphRow,
  graphId: string,
  graphVersion: string,
): ExecutionGraphDefinition | undefined {
  try {
    const graph = decodeGraphDefinition(row.definition_json);
    if (
      graph.graphId !== graphId ||
      graph.graphVersion !== graphVersion ||
      row.graph_id !== graphId ||
      row.graph_version !== graphVersion ||
      canonicalGraphJson(graph) !== row.canonical_json
    ) {
      return undefined;
    }
    return graph;
  } catch {
    return undefined;
  }
}

export async function createSqliteGraphDefinitionRegistry(
  options: SqliteGraphRegistryOptions,
): Promise<ClosableGraphDefinitionRegistry> {
  assertOptions(options);

  const db = new Database(options.databasePath, {
    create: true,
    readwrite: true,
    strict: true,
    safeIntegers: false,
  });
  configureGraphRegistrySqlite(db, options.busyTimeoutMs);
  initializeGraphRegistrySchema(db);

  let closed = false;
  const ensureOpen = (): void => {
    if (closed) throw new Error("SQLite graph registry is closed");
  };

  const registerTransaction = db.transaction(
    (graph: ExecutionGraphDefinition): RegisterGraphDefinitionResult => {
      if (!isValidExecutionGraphDefinition(graph)) {
        return { status: "INVALID_GRAPH" };
      }

      const canonical = canonicalGraphJson(graph);
      const existing = readGraphRow(db, graph.graphId, graph.graphVersion);
      if (existing) {
        const decoded = decodeExactRow(existing, graph.graphId, graph.graphVersion);
        if (!decoded) return { status: "INVALID_GRAPH" };
        if (existing.canonical_json !== canonical) return { status: "CONFLICT" };
        return { status: "REPLAYED", graph: decoded };
      }

      db.query(
        `INSERT INTO graph_definitions
           (graph_id, graph_version, canonical_json, definition_json)
         VALUES (?, ?, ?, ?)`,
      ).run(
        graph.graphId,
        graph.graphVersion,
        canonical,
        encodeGraphDefinition(graph),
      );

      return { status: "REGISTERED", graph };
    },
  );

  return {
    async register(graph) {
      ensureOpen();
      return registerTransaction.immediate(graph) as RegisterGraphDefinitionResult;
    },

    async get(graphId, graphVersion): Promise<GraphDefinitionLookupResult> {
      ensureOpen();
      if (graphId.length === 0 || graphVersion.length === 0) {
        return { status: "INTEGRITY_ERROR", code: "GRAPH_DEFINITION_INVALID" };
      }
      const row = readGraphRow(db, graphId, graphVersion);
      if (!row) return { status: "NOT_FOUND" };
      const graph = decodeExactRow(row, graphId, graphVersion);
      return graph === undefined
        ? { status: "INTEGRITY_ERROR", code: "GRAPH_DEFINITION_INVALID" }
        : { status: "FOUND", graph };
    },

    async close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
