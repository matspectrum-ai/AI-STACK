import type { PrepareOmpExecutionRequest } from "../../contracts/omp-executor";
import type { ClosableOmpExecutionRegistry } from "../../contracts/sqlite-omp-execution-registry";
import { createSqliteOmpExecutionRegistry } from "../../src/executors/omp/registry/sqlite/create-sqlite-omp-execution-registry";

let registry: ClosableOmpExecutionRegistry | undefined;

type Incoming =
  | { readonly type: "setup"; readonly databasePath: string }
  | { readonly type: "prepare"; readonly request: PrepareOmpExecutionRequest };

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const message = event.data;
  if (message.type === "setup") {
    registry = await createSqliteOmpExecutionRegistry({
      databasePath: message.databasePath,
      busyTimeoutMs: 5_000,
    });
    postMessage({ type: "ready" });
    return;
  }

  if (!registry) {
    postMessage({ type: "error", message: "registry not initialized" });
    return;
  }

  try {
    const result = await registry.prepare(message.request);
    postMessage({ type: "result", status: result.status });
  } catch (error) {
    postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await registry.close();
    close();
  }
};
