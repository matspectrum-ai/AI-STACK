import type {
  ExecutionId,
  ExecutionLease,
  LeaseId,
  WorkerId,
} from "../../contracts/execution";
import type {
  DispatcherClock,
  ExecutionDispatcher,
  ExecutionLeaseFactory,
} from "../../contracts/dispatcher";
import { createExecutionDispatcher } from "../../src/orchestration/dispatcher/create-execution-dispatcher";
import {
  createSqliteExecutionStoreTestEnvironment,
  type SqliteExecutionStoreTestEnvironment,
} from "./execution-store-test-env";
import { createFakeExecutor, type FakeExecutorController } from "./fake-executor";

export class MutableDispatcherClock implements DispatcherClock {
  constructor(public current: string) {}
  now(): string {
    return this.current;
  }
}

export class DeterministicLeaseFactory implements ExecutionLeaseFactory {
  private sequence = 0;

  constructor(private readonly durationMs = 60_000) {}

  create(request: {
    readonly executionId: ExecutionId;
    readonly workerId: WorkerId;
    readonly claimedAt: string;
  }): ExecutionLease {
    this.sequence += 1;
    const expires = new Date(Date.parse(request.claimedAt) + this.durationMs).toISOString();
    return {
      leaseId: `lease:dispatcher:${this.sequence}` as LeaseId,
      workerId: request.workerId,
      claimedAt: request.claimedAt,
      expiresAt: expires,
    };
  }
}

export interface DispatcherTestEnvironment {
  readonly storage: SqliteExecutionStoreTestEnvironment;
  readonly fake: FakeExecutorController;
  readonly clock: MutableDispatcherClock;
  readonly workerId: WorkerId;
  readonly dispatcher: ExecutionDispatcher;
  cleanup(): Promise<void>;
}

export async function createDispatcherTestEnvironment(options?: {
  readonly now?: string;
  readonly workerId?: WorkerId;
  readonly leaseDurationMs?: number;
}): Promise<DispatcherTestEnvironment> {
  const storage = await createSqliteExecutionStoreTestEnvironment();
  const fake = createFakeExecutor();
  const clock = new MutableDispatcherClock(options?.now ?? "2026-08-09T07:00:00.000Z");
  const workerId = options?.workerId ?? ("worker:dispatcher" as WorkerId);
  const leaseFactory = new DeterministicLeaseFactory(options?.leaseDurationMs ?? 60_000);
  const dispatcher = createExecutionDispatcher({
    store: storage.store,
    executor: fake.executor,
    workerId,
    clock,
    leaseFactory,
  });

  return {
    storage,
    fake,
    clock,
    workerId,
    dispatcher,
    cleanup: () => storage.cleanup(),
  };
}
