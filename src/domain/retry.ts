import type {
  FailureRecord,
  ReasonCode,
  RetryDecision,
  RetryPolicy,
} from "../../contracts/domain";

export function validateRetryPolicy(
  policy: RetryPolicy,
): readonly ReasonCode[] {
  if (
    !Number.isFinite(policy.maxAttempts) ||
    !Number.isInteger(policy.maxAttempts) ||
    policy.maxAttempts < 1
  ) {
    return ["INVALID_GRAPH_DEFINITION"];
  }

  return [];
}

export function evaluateRetry(
  failure: FailureRecord,
  policy: RetryPolicy,
  attemptsUsed: number,
): RetryDecision {
  if (
    validateRetryPolicy(policy).length > 0 ||
    !Number.isInteger(attemptsUsed) ||
    attemptsUsed < 0
  ) {
    return { allowed: false, reasonCodes: ["INVALID_GRAPH_DEFINITION"] };
  }

  const reasonAllowed =
    policy.allowedReasonCodes === undefined ||
    policy.allowedReasonCodes.includes(failure.reasonCode);
  const classAllowed = policy.allowedFailureClasses.includes(failure.failureClass);

  if (failure.retryability !== "RETRYABLE" || !classAllowed || !reasonAllowed) {
    return { allowed: false, reasonCodes: ["NON_RETRYABLE_FAILURE"] };
  }

  if (attemptsUsed >= policy.maxAttempts) {
    return {
      allowed: false,
      reasonCodes: ["RETRY_BUDGET_EXHAUSTED"],
      exhaustionEdgeId: policy.exhaustionEdgeId,
    };
  }

  return {
    allowed: true,
    reasonCodes: [],
    nextAttempt: attemptsUsed + 1,
  };
}
