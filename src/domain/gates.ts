import type {
  ApprovalId,
  ArtifactId,
  EvidenceId,
  GateDefinition,
  GateEvaluationContext,
  GateId,
  GateResult,
  ReasonCode,
  SubjectSelector,
} from "../../contracts/domain";
import { referencedArtifacts } from "./internal";

function resolveSubjectRefs(
  subject: SubjectSelector,
  context: GateEvaluationContext,
): { subjectRefs: string[]; boundArtifactIds: ArtifactId[] } {
  if (subject.kind === "exact") {
    return { subjectRefs: [subject.subjectRef], boundArtifactIds: [] };
  }

  const matches = referencedArtifacts(context.artifacts, context.state.artifactRefs).filter(
    (artifact) => artifact.artifactKind === subject.artifactKind,
  );

  return {
    subjectRefs: matches.map((artifact) => artifact.artifactId),
    boundArtifactIds: matches.map((artifact) => artifact.artifactId),
  };
}

function gateResult(
  gateId: GateId,
  outcome: GateResult["outcome"],
  reasonCodes: readonly ReasonCode[],
  options: {
    artifactIds?: readonly ArtifactId[];
    evidenceIds?: readonly EvidenceId[];
    approvalIds?: readonly ApprovalId[];
    inputRefs?: readonly string[];
  } = {},
): GateResult {
  return {
    gateId,
    outcome,
    reasonCodes: [...reasonCodes],
    evaluatedInputRefs: [...(options.inputRefs ?? [])],
    boundArtifactIds: [...(options.artifactIds ?? [])],
    boundEvidenceIds: [...(options.evidenceIds ?? [])],
    boundApprovalIds: [...(options.approvalIds ?? [])],
  };
}

function evaluateArtifactGate(
  definition: Extract<GateDefinition, { gateType: "artifact_present" }>,
  context: GateEvaluationContext,
): GateResult {
  const matches = referencedArtifacts(context.artifacts, context.state.artifactRefs).filter(
    (artifact) => artifact.artifactKind === definition.artifactKind,
  );

  if (matches.length === 0) {
    return gateResult(definition.gateId, "FAIL", [definition.missingReason]);
  }

  return gateResult(definition.gateId, "PASS", [], {
    artifactIds: matches.map((artifact) => artifact.artifactId),
    inputRefs: matches.map((artifact) => artifact.artifactId),
  });
}

function evaluateEvidenceGate(
  definition: Extract<GateDefinition, { gateType: "evidence_valid" }>,
  context: GateEvaluationContext,
): GateResult {
  const subjects = resolveSubjectRefs(definition.subject, context);
  const allowedEvidence = new Set(context.state.evidenceRefs);
  const matching = context.evidence.filter(
    (record) =>
      allowedEvidence.has(record.evidenceId) &&
      record.evidenceType === definition.evidenceType &&
      subjects.subjectRefs.includes(record.subjectRef),
  );

  if (matching.length === 0) {
    return gateResult(definition.gateId, "FAIL", [definition.missingReason], {
      artifactIds: subjects.boundArtifactIds,
    });
  }

  const valid = matching.filter((record) => record.verificationStatus === "VALID");
  if (valid.length === 0) {
    return gateResult(definition.gateId, "FAIL", [definition.invalidReason], {
      artifactIds: subjects.boundArtifactIds,
      evidenceIds: matching.map((record) => record.evidenceId),
      inputRefs: matching.map((record) => record.evidenceId),
    });
  }

  return gateResult(definition.gateId, "PASS", [], {
    artifactIds: subjects.boundArtifactIds,
    evidenceIds: valid.map((record) => record.evidenceId),
    inputRefs: valid.map((record) => record.evidenceId),
  });
}

function evaluateApprovalGate(
  definition: Extract<GateDefinition, { gateType: "approval_present" }>,
  context: GateEvaluationContext,
): GateResult {
  const subjects = resolveSubjectRefs(definition.subject, context);
  const allowedApprovals = new Set(context.state.approvalRefs);
  const matching = context.approvals.filter(
    (record) =>
      allowedApprovals.has(record.approvalId) &&
      subjects.subjectRefs.includes(record.subjectRef) &&
      record.action === definition.action &&
      record.scope === definition.scope,
  );

  if (matching.length === 0) {
    return gateResult(definition.gateId, "FAIL", [definition.missingReason], {
      artifactIds: subjects.boundArtifactIds,
    });
  }

  const current = matching.filter(
    (record) =>
      record.expiresAt === undefined ||
      Date.parse(record.expiresAt) > Date.parse(context.now),
  );

  if (current.length === 0) {
    return gateResult(definition.gateId, "FAIL", [definition.expiredReason], {
      artifactIds: subjects.boundArtifactIds,
      approvalIds: matching.map((record) => record.approvalId),
      inputRefs: matching.map((record) => record.approvalId),
    });
  }

  const independent =
    definition.requireIndependentApprover && context.subjectExecutorId
      ? current.filter(
          (record) => record.approverExecutorId !== context.subjectExecutorId,
        )
      : current;

  if (independent.length === 0) {
    return gateResult(definition.gateId, "FAIL", [definition.selfApprovalReason], {
      artifactIds: subjects.boundArtifactIds,
      approvalIds: current.map((record) => record.approvalId),
      inputRefs: current.map((record) => record.approvalId),
    });
  }

  return gateResult(definition.gateId, "PASS", [], {
    artifactIds: subjects.boundArtifactIds,
    approvalIds: independent.map((record) => record.approvalId),
    inputRefs: independent.map((record) => record.approvalId),
  });
}

export function evaluateGate(
  definition: GateDefinition,
  context: GateEvaluationContext,
): GateResult {
  switch (definition.gateType) {
    case "artifact_present":
      return evaluateArtifactGate(definition, context);
    case "evidence_valid":
      return evaluateEvidenceGate(definition, context);
    case "approval_present":
      return evaluateApprovalGate(definition, context);
  }
}
