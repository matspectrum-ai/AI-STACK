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
import { encodeGraphDefinition } from "./codec";
import { decodeExactGraphRow, readGraphRow } from "./records";
import {
  configureGraphRegistrySqlite,
  initializeGraphRegistrySchema,
} from "./schema";

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
        const decoded = decodeExactGraphRow(existing, graph.graphId, graph.graphVersion);
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
      const graph = decodeExactGraphRow(row, graphId, graphVersion);
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
