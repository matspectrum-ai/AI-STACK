import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClosableOmpExecutionRegistry } from "../../contracts/sqlite-omp-execution-registry";
import { createSqliteOmpExecutionRegistry } from "../../src/executors/omp/registry/sqlite/create-sqlite-omp-execution-registry";

export interface OmpRegistryTestEnvironment {
  readonly directory: string;
  readonly databasePath: string;
  readonly registry: ClosableOmpExecutionRegistry;
  openAnother(): Promise<ClosableOmpExecutionRegistry>;
  corruptColumn(executionId: string, column: "launch_spec_json" | "terminal_result_json" | "terminal_output_json", value: string): void;
  cleanup(): Promise<void>;
}

export async function createOmpRegistryTestEnvironment(): Promise<OmpRegistryTestEnvironment> {
  const directory = await mkdtemp(join(tmpdir(), "ai-stack-omp-registry-"));
  const databasePath = join(directory, "omp-executions.sqlite");
  const open = () => createSqliteOmpExecutionRegistry({ databasePath, busyTimeoutMs: 1_000 });

  const registry = await open();
  const opened = new Set<ClosableOmpExecutionRegistry>([registry]);

  return {
    directory,
    databasePath,
    registry,
    async openAnother() {
      const another = await open();
      opened.add(another);
      return another;
    },
    corruptColumn(executionId, column, value) {
      const db = new Database(databasePath, { readwrite: true, strict: true });
      try {
        db.query(`UPDATE omp_executions SET ${column} = ? WHERE execution_id = ?`).run(
          value,
          executionId,
        );
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
