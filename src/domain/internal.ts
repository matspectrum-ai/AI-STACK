import type {
  ArtifactId,
  ArtifactRecord,
  ReasonCode,
} from "../../contracts/domain";

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function withFallbackReason(
  reasonCodes: readonly ReasonCode[],
  fallback: ReasonCode,
): readonly ReasonCode[] {
  return reasonCodes.length > 0 ? reasonCodes : [fallback];
}

export function referencedArtifacts(
  artifacts: readonly ArtifactRecord[],
  refs: readonly ArtifactId[],
): ArtifactRecord[] {
  const allowed = new Set<ArtifactId>(refs);
  return artifacts.filter((artifact) => allowed.has(artifact.artifactId));
}
