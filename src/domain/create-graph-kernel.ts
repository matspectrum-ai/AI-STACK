import type { GraphKernel } from "../../contracts/domain";
import { evaluateGate } from "./gates";
import {
  validateGraph,
  validateGraphReplacement,
} from "./graph-validation";
import { validateArtifactLineage } from "./lineage";
import { evaluateRetry, validateRetryPolicy } from "./retry";
import { evaluateTransition } from "./transitions";

export function createGraphKernel(): GraphKernel {
  return {
    validateGraph,
    validateGraphReplacement,
    evaluateGate,
    evaluateTransition,
    validateArtifactLineage,
    validateRetryPolicy,
    evaluateRetry,
  };
}
