import type {
  Candidate,
  CandidateRegion,
  DisplacementSample,
  GateCriterionResult,
  QualityGateResult,
} from '@cadcopilot/contracts';

export interface GateAssessment {
  /** The UI's own fail-closed verdict (05 §10.7, I12). */
  passed: boolean;
  /** What the Runtime reported. */
  runtimePassed: boolean;
  /** Runtime said passed but the results do not support it. */
  inconsistent: boolean;
  missing: string[];
  failing: GateCriterionResult[];
  notEvaluable: GateCriterionResult[];
  notEvaluated: GateCriterionResult[];
}

export const criterionPassed = (r: GateCriterionResult) =>
  r.evaluationValidity === 'evaluable' && r.qualityResult === 'pass';

/**
 * A candidate passes only if every required criterion has a result, and every
 * result is evaluable and passed. "No failure found" is not a pass.
 */
export function assessGate(q: QualityGateResult): GateAssessment {
  const byId = new Map(q.results.map((r) => [r.criterionId, r]));
  const missing = q.requiredCriteria.filter((id) => !byId.has(id));
  const failing = q.results.filter((r) => r.qualityResult === 'fail');
  const notEvaluable = q.results.filter((r) => r.evaluationValidity === 'not_evaluable');
  const notEvaluated = q.results.filter(
    (r) => r.evaluationValidity === 'evaluable' && r.qualityResult === 'not_evaluated',
  );
  const allPass = q.requiredCriteria.length > 0 && missing.length === 0 && q.requiredCriteria.every((id) => criterionPassed(byId.get(id)!));
  const passed = q.passed && allPass;
  return {
    passed,
    runtimePassed: q.passed,
    inconsistent: q.passed && !allPass,
    missing,
    failing,
    notEvaluable,
    notEvaluated,
  };
}

export interface CandidateView {
  adoptable: boolean;
  gate: GateAssessment;
  /** Why adoptable geometry is not shown, when it is not. */
  withheldReason?: string;
  /** Samples restricted to MATCHED regions (01 §5 rule 3). Empty unless adoptable. */
  samples: DisplacementSample[];
  /** Whether pointwise displacement may be shown for this region. */
  showsDisplacement: (region: CandidateRegion) => boolean;
}

function inRegion(t: number, region: CandidateRegion): boolean {
  return t >= region.t[0] && t <= region.t[1];
}

export function candidateView(c: Candidate): CandidateView {
  const gate = assessGate(c.quality);
  const adoptable = c.presentation === 'adoptable' && gate.passed && !!c.geometry;
  const matched = c.regions.filter((r) => r.correspondence === 'MATCHED');
  let withheldReason: string | undefined;
  if (!adoptable) {
    if (gate.inconsistent) withheldReason = '闸门结论与逐项结果不一致，按未通过处理';
    else if (!gate.passed) withheldReason = '候选未通过质量闸门，不展示候选几何';
    else withheldReason = 'Runtime 未提供可采纳的候选几何';
  }
  return {
    adoptable,
    gate,
    ...(withheldReason ? { withheldReason } : {}),
    samples: adoptable ? (c.geometry?.samples ?? []).filter((s) => matched.some((r) => inRegion(s.t, r))) : [],
    showsDisplacement: (region) => adoptable && region.correspondence === 'MATCHED' && !!region.displacement,
  };
}
