import type {
  ExecutionIntent,
  ExecutorStartRequest,
} from "../../../contracts/execution";

export function toExecutorStartRequest(
  intent: ExecutionIntent,
): ExecutorStartRequest {
  return {
    executionId: intent.executionId,
    runId: intent.runId,
    graphId: intent.graphId,
    graphVersion: intent.graphVersion,
    nodeId: intent.nodeId,
    attempt: intent.attempt,
    boundArtifactIds: [...intent.boundArtifactIds],
    boundEvidenceIds: [...intent.boundEvidenceIds],
    boundApprovalIds: [...intent.boundApprovalIds],
  };
}
