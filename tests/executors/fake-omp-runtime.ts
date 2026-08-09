import type {
  ExecutionId,
  ExecutorReference,
} from "../../contracts/execution";
import type {
  OmpRuntimeBridge,
  OmpRuntimeOpenRequest,
  OmpRuntimePrepareResult,
  OmpRuntimeSessionConfiguration,
  OmpRuntimeSettlement,
  OmpRuntimeStartResult,
} from "../../contracts/omp-runtime";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class FakeOmpRuntime implements OmpRuntimeBridge {
  readonly events: string[] = [];
  readonly preparedConfigs: OmpRuntimeSessionConfiguration[] = [];
  readonly openedRequests: OmpRuntimeOpenRequest[] = [];
  readonly promptRequests: Array<{ executionId: ExecutionId; instruction: string }> = [];

  prepareRejectCode?: string;
  openRejectCode?: string;
  startRejectCode?: string;
  throwOnPrepare = false;
  throwOnOpen = false;
  throwOnStart = false;

  onStartPrompt?: (executionId: ExecutionId) => Promise<void> | void;

  private readonly settlements = new Map<ExecutionId, Deferred<OmpRuntimeSettlement>>();
  private readonly live = new Set<ExecutionId>();
  private readonly sessions = new Map<ExecutionId, {
    sessionId: string;
    sessionFile: string;
    executorRef: ExecutorReference;
  }>();

  async prepareSession(config: OmpRuntimeSessionConfiguration): Promise<OmpRuntimePrepareResult> {
    this.events.push("runtime.prepareSession");
    this.preparedConfigs.push(structuredClone(config));
    if (this.throwOnPrepare) throw new Error("fake prepare failure");
    if (this.prepareRejectCode) {
      return { status: "REJECTED", errorCode: this.prepareRejectCode };
    }

    const suffix = encodeURIComponent(config.executionId);
    const sessionId = `omp-session:${suffix}`;
    const sessionFile = `${config.sessionDirectory}/session.jsonl`;
    const executorRef = `omp:${sessionId}` as ExecutorReference;
    this.sessions.set(config.executionId, { sessionId, sessionFile, executorRef });
    return {
      status: "PREPARED",
      session: { sessionId, sessionFile, executorRef },
    };
  }

  async openPreparedSession(request: OmpRuntimeOpenRequest) {
    this.events.push("runtime.openPreparedSession");
    this.openedRequests.push(structuredClone(request));
    if (this.throwOnOpen) throw new Error("fake open failure");
    if (this.openRejectCode) {
      return { status: "REJECTED" as const, errorCode: this.openRejectCode };
    }
    const executorRef = `omp:${request.sessionId}` as ExecutorReference;
    this.sessions.set(request.executionId, {
      sessionId: request.sessionId,
      sessionFile: request.sessionFile,
      executorRef,
    });
    return { status: "READY" as const, executorRef };
  }

  async startPrompt(request: { readonly executionId: ExecutionId; readonly instruction: string }): Promise<OmpRuntimeStartResult> {
    this.events.push("runtime.startPrompt");
    this.promptRequests.push({ ...request });
    if (this.throwOnStart) throw new Error("fake start failure");
    if (this.startRejectCode) {
      return { status: "REJECTED", errorCode: this.startRejectCode };
    }
    if (!this.sessions.has(request.executionId)) {
      return { status: "REJECTED", errorCode: "FAKE_SESSION_NOT_READY" };
    }
    await this.onStartPrompt?.(request.executionId);
    const pending = deferred<OmpRuntimeSettlement>();
    this.settlements.set(request.executionId, pending);
    this.live.add(request.executionId);
    void pending.promise.finally(() => {
      this.live.delete(request.executionId);
    }).catch(() => undefined);
    return { status: "STARTED", settlement: pending.promise };
  }

  isLive(executionId: ExecutionId): boolean {
    return this.live.has(executionId);
  }

  settle(executionId: ExecutionId, settlement: OmpRuntimeSettlement): void {
    const pending = this.settlements.get(executionId);
    if (!pending) throw new Error(`no pending settlement for ${executionId}`);
    pending.resolve(settlement);
  }

  rejectSettlement(executionId: ExecutionId, error: unknown): void {
    const pending = this.settlements.get(executionId);
    if (!pending) throw new Error(`no pending settlement for ${executionId}`);
    pending.reject(error);
  }
}
