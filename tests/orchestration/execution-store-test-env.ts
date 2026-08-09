import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClosableExecutionStore } from "../../contracts/sqlite-execution-store";
import { createSqliteExecutionStore } from "../../src/orchestration/store/sqlite/create-sqlite-execution-store";

export interface SqliteExecutionStoreTestEnvironment {
  readonly directory: string;
  readonly databasePath: string;
  readonly store: ClosableExecutionStore;
  openAnother(): Promise<ClosableExecutionStore>;
  cleanup(): Promise<void>;
}

export async function createSqliteExecutionStoreTestEnvironment(options?: {
  readonly busyTimeoutMs?: number;
}): Promise<SqliteExecutionStoreTestEnvironment> {
  const directory = await mkdtemp(join(tmpdir(), "ai-stack-execution-store-"));
  const databasePath = join(directory, "execution.sqlite");
  const busyTimeoutMs = options?.busyTimeoutMs ?? 1_000;

  const open = () => createSqliteExecutionStore({ databasePath, busyTimeoutMs });
  const store = await open();
  const opened = new Set<ClosableExecutionStore>([store]);

  return {
    directory,
    databasePath,
    store,
    async openAnother() {
      const another = await open();
      opened.add(another);
      return another;
    },
    async cleanup() {
      for (const handle of opened) {
        try {
          await handle.close();
        } catch {
          // Cleanup is best effort; close behavior is asserted separately.
        }
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
}
