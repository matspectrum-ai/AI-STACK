import type { DurableExecutionStore } from "./execution-store";

export interface SqliteExecutionStoreOptions {
  readonly databasePath: string;
  readonly busyTimeoutMs: number;
}

export interface ClosableExecutionStore extends DurableExecutionStore {
  close(): Promise<void>;
}

export type CreateSqliteExecutionStore = (
  options: SqliteExecutionStoreOptions,
) => Promise<ClosableExecutionStore>;
