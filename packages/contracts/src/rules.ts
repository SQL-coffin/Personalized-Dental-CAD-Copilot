/**
 * Pure rules shared by every layer. Keeping one definition means the Runtime's
 * Policy Gate and the UI's defensive re-check cannot disagree about what
 * "passed" or "terminal" means.
 */
import type { QualityGateResult } from './candidates';
import type { StepState, TaskState } from './task';

export const TERMINAL_TASK_STATES: readonly TaskState[] = ['DONE', 'FAILED', 'CANCELLED'];

export const TERMINAL_STEP_STATES: readonly StepState[] = ['SUCCEEDED', 'POSTCONDITION_FAILED', 'FAILED_NO_EFFECT', 'DENIED'];

/**
 * §10.7 / I12: a candidate passes only when every criterion in the registered
 * set has a result, each result is evaluable and passed, and the Runtime's own
 * verdict agrees. "No failure found" is not a pass; an empty set never passes.
 */
export function isGatePassed(q: QualityGateResult | undefined): boolean {
  if (!q || !q.passed || q.requiredCriteria.length === 0) return false;
  return q.requiredCriteria.every((id) => {
    const r = q.results.find((x) => x.criterionId === id);
    return !!r && r.evaluationValidity === 'evaluable' && r.qualityResult === 'pass';
  });
}
