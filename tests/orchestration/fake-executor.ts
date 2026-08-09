import type {
  ExecutionId,
  ExecutorPort,
  ExecutorStartRequest,
  ExecutorStartResult,
  ExecutorStatusResult,
} from "../../contracts/execution";

export type FakeStartStep =
  | { readonly kind: "return"; readonly value: ExecutorStartResult }
  | { readonly kind: "throw"; readonly error: Error };

export interface FakeExecutorController {
  readonly executor: ExecutorPort;
  readonly startCalls: ExecutorStartRequest[];
  readonly statusCalls: ExecutionId[];
  pushStart(...steps: readonly FakeStartStep[]): void;
  pushStatus(...results: readonly ExecutorStatusResult[]): void;
}

export function createFakeExecutor(): FakeExecutorController {
  const startCalls: ExecutorStartRequest[] = [];
  const statusCalls: ExecutionId[] = [];
  const startQueue: FakeStartStep[] = [];
  const statusQueue: ExecutorStatusResult[] = [];

  const executor: ExecutorPort = {
    async start(request) {
      startCalls.push(request);
      const step = startQueue.shift();
      if (!step) throw new Error("fake executor start plan exhausted");
      if (step.kind === "throw") throw step.error;
      return step.value;
    },

    async getStatus(executionId) {
      statusCalls.push(executionId);
      const result = statusQueue.shift();
      if (!result) throw new Error("fake executor status plan exhausted");
      return result;
    },
  };

  return {
    executor,
    startCalls,
    statusCalls,
    pushStart(...steps) {
      startQueue.push(...steps);
    },
    pushStatus(...results) {
      statusQueue.push(...results);
    },
  };
}
