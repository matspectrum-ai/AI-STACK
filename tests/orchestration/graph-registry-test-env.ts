import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClosableGraphDefinitionRegistry } from "../../contracts/sqlite-graph-registry";
import { createSqliteGraphDefinitionRegistry } from "../../src/orchestration/registry/sqlite/create-sqlite-graph-definition-registry";

export interface GraphRegistryTestEnvironment {
  readonly directory: string;
  readonly databasePath: string;
  readonly registry: ClosableGraphDefinitionRegistry;
  openAnother(): Promise<ClosableGraphDefinitionRegistry>;
  corruptDefinition(graphId: string, graphVersion: string, definitionJson: string): void;
  cleanup(): Promise<void>;
}

export async function createGraphRegistryTestEnvironment(): Promise<GraphRegistryTestEnvironment> {
  const directory = await mkdtemp(join(tmpdir(), "ai-stack-graph-registry-"));
  const databasePath = join(directory, "graphs.sqlite");
  const open = () =>
    createSqliteGraphDefinitionRegistry({ databasePath, busyTimeoutMs: 1_000 });

  const registry = await open();
  const opened = new Set<ClosableGraphDefinitionRegistry>([registry]);

  return {
    directory,
    databasePath,
    registry,
    async openAnother() {
      const another = await open();
      opened.add(another);
      return another;
    },
    corruptDefinition(graphId, graphVersion, definitionJson) {
      const db = new Database(databasePath, { readwrite: true, strict: true });
      try {
        db.query(
          "UPDATE graph_definitions SET definition_json = ? WHERE graph_id = ? AND graph_version = ?",
        ).run(definitionJson, graphId, graphVersion);
      } finally {
        db.close();
      }
    },
    async cleanup() {
      for (const handle of opened) {
        try {
          await handle.close();
        } catch {
          // best effort cleanup
        }
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
}
