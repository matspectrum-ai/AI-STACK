import type { DurableGraphDefinitionRegistry } from "./graph-registry";

export interface SqliteGraphRegistryOptions {
  readonly databasePath: string;
  readonly busyTimeoutMs: number;
}

export interface ClosableGraphDefinitionRegistry
  extends DurableGraphDefinitionRegistry {
  close(): Promise<void>;
}

export type CreateSqliteGraphDefinitionRegistry = (
  options: SqliteGraphRegistryOptions,
) => Promise<ClosableGraphDefinitionRegistry>;
