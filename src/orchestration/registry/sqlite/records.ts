import { Database } from "bun:sqlite";
import type { ExecutionGraphDefinition } from "../../../../contracts/execution";
import { canonicalGraphJson } from "../canonicalize-graph";
import { decodeGraphDefinition } from "./codec";

export interface GraphRow {
  readonly graph_id: string;
  readonly graph_version: string;
  readonly canonical_json: string;
  readonly definition_json: string;
}

export function readGraphRow(
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

export function decodeExactGraphRow(
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
