import type { OmpExecutionRegistry } from "./omp-executor";

export interface SqliteOmpExecutionRegistryOptions {
  readonly databasePath: string;
  readonly busyTimeoutMs: number;
}

export interface ClosableOmpExecutionRegistry extends OmpExecutionRegistry {
  close(): Promise<void>;
}

export type CreateSqliteOmpExecutionRegistry = (
  options: SqliteOmpExecutionRegistryOptions,
) => Promise<ClosableOmpExecutionRegistry>;
