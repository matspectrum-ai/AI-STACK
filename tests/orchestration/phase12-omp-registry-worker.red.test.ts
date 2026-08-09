import { expect, test } from "bun:test";
import { prepareRequest } from "../executors/fixtures";
import { createOmpRegistryTestEnvironment } from "../executors/omp-registry-test-env";

interface WorkerResultMessage {
  readonly type: "result" | "error";
  readonly status?: string;
  readonly message?: string;
}

function waitForMessage<T>(worker: Worker, predicate: (value: unknown) => value is T): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!predicate(event.data)) return;
      worker.removeEventListener("message", onMessage);
      resolve(event.data);
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", (event) => reject(event.error ?? new Error(event.message)), {
      once: true,
    });
  });
}

const isReady = (value: unknown): value is { readonly type: "ready" } =>
  typeof value === "object" && value !== null && (value as { type?: unknown }).type === "ready";

const isResult = (value: unknown): value is WorkerResultMessage =>
  typeof value === "object" && value !== null &&
  ["result", "error"].includes(String((value as { type?: unknown }).type));

async function setupWorker(databasePath: string): Promise<Worker> {
  const worker = new Worker(
    new URL("../executors/omp-registry-race-worker.ts", import.meta.url).href,
  );
  const ready = waitForMessage(worker, isReady);
  worker.postMessage({ type: "setup", databasePath });
  await ready;
  return worker;
}

test("OMPREG-010c: divergent prepare race across real workers has one winner", async () => {
  const env = await createOmpRegistryTestEnvironment();
  try {
    const workerA = await setupWorker(env.databasePath);
    const workerB = await setupWorker(env.databasePath);

    const resultA = waitForMessage(workerA, isResult);
    const resultB = waitForMessage(workerB, isResult);
    workerA.postMessage({ type: "prepare", request: prepareRequest() });
    workerB.postMessage({
      type: "prepare",
      request: prepareRequest({ sessionId: "omp-session-worker-rival" }),
    });

    const [a, b] = await Promise.all([resultA, resultB]);
    if (a.type === "error") throw new Error(a.message ?? "worker A failed");
    if (b.type === "error") throw new Error(b.message ?? "worker B failed");

    const statuses = [a.status, b.status];
    expect(statuses.filter((status) => status === "PREPARED")).toHaveLength(1);
    expect(statuses.filter((status) => status === "CONFLICT")).toHaveLength(1);
  } finally {
    await env.cleanup();
  }
});
