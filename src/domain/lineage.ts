import type {
  ArtifactId,
  ArtifactRecord,
  ReasonCode,
} from "../../contracts/domain";

export function validateArtifactLineage(
  artifacts: readonly ArtifactRecord[],
): readonly ReasonCode[] {
  const ids = new Set(artifacts.map((artifact) => artifact.artifactId));
  const parents = new Map<ArtifactId, readonly ArtifactId[]>(
    artifacts.map((artifact) => [artifact.artifactId, artifact.parentArtifactIds]),
  );

  for (const artifact of artifacts) {
    if (artifact.parentArtifactIds.some((parent) => !ids.has(parent))) {
      return ["INVALID_ARTIFACT_LINEAGE"];
    }
  }

  const visiting = new Set<ArtifactId>();
  const visited = new Set<ArtifactId>();

  const hasCycle = (id: ArtifactId): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;

    visiting.add(id);
    for (const parent of parents.get(id) ?? []) {
      if (hasCycle(parent)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  for (const id of ids) {
    if (hasCycle(id)) return ["INVALID_ARTIFACT_LINEAGE"];
  }

  return [];
}
