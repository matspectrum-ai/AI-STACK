import type { AuthoritativeStateStore } from "./persistence";

export interface PersistenceClock {
  now(): string;
}

export interface SqliteStateStoreOptions {
  readonly databasePath: string;
  readonly clock: PersistenceClock;
  readonly busyTimeoutMs: number;
}

export interface ClosableAuthoritativeStateStore extends AuthoritativeStateStore {
  close(): Promise<void>;
}

export type CreateSqliteAuthoritativeStateStore = (
  options: SqliteStateStoreOptions,
) => Promise<ClosableAuthoritativeStateStore>;
