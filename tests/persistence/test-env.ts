import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClosableAuthoritativeStateStore } from "../../contracts/sqlite-persistence";
import { createSqliteAuthoritativeStateStore } from "../../src/persistence/sqlite/create-sqlite-authoritative-state-store";
import { DeterministicClock } from "./fixtures";

export interface SqliteTestEnvironment {
  readonly directory: string;
  readonly databasePath: string;
  readonly store: ClosableAuthoritativeStateStore;
  openAnother(): Promise<ClosableAuthoritativeStateStore>;
  cleanup(): Promise<void>;
}

export async function createSqliteTestEnvironment(options?: {
  readonly busyTimeoutMs?: number;
  readonly timestamps?: readonly string[];
}): Promise<SqliteTestEnvironment> {
  const directory = await mkdtemp(join(tmpdir(), "ai-stack-sqlite-"));
  const databasePath = join(directory, "authority.sqlite");
  const timestamps = options?.timestamps ?? [
    "2026-08-09T05:30:00.000Z",
    "2026-08-09T05:30:01.000Z",
    "2026-08-09T05:30:02.000Z",
    "2026-08-09T05:30:03.000Z",
    "2026-08-09T05:30:04.000Z",
    "2026-08-09T05:30:05.000Z",
    "2026-08-09T05:30:06.000Z",
    "2026-08-09T05:30:07.000Z",
  ];
  const busyTimeoutMs = options?.busyTimeoutMs ?? 1_000;

  const open = () =>
    createSqliteAuthoritativeStateStore({
      databasePath,
      busyTimeoutMs,
      clock: new DeterministicClock(timestamps),
    });

  const store = await open();
  const opened = new Set<ClosableAuthoritativeStateStore>([store]);

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
          // Cleanup is best effort; individual close behavior is asserted separately.
        }
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
}
