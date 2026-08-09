import type { NodeId } from "../../../contracts/domain";
import type { ExecutionId } from "../../../contracts/execution";
import type { JournalEntry } from "../../../contracts/persistence";

export function deriveExecutionId(
  entry: JournalEntry,
  nodeId: NodeId,
  attempt: number,
): ExecutionId {
  const parts = [
    entry.runId,
    entry.graphVersion,
    String(Number(entry.sequence)),
    nodeId,
    String(attempt),
  ].map((part) => encodeURIComponent(part));

  return `execution:v1:${parts.join(":")}` as ExecutionId;
}
