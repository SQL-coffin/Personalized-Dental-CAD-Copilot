import { describe, expect, it } from 'vitest';
import type {
  ApprovalRequest,
  Candidate,
  DeploymentInfo,
  GateCriterionResult,
  Plan,
  PlanStep,
  TaskSnapshot,
} from '@cadcopilot/contracts';
import { approvalAvailability } from './approval';
import { assessGate, candidateView } from './quality';
import { stepDisplay } from './steps';

const pass = (id: string): GateCriterionResult => ({
  criterionId: id,
  label: id,
  evaluationValidity: 'evaluable',
  qualityResult: 'pass',
});

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    candidateId: 'cand-1',
    candidateHash: 'h1',
    caseId: 'case-1',
    object: 'margin_line',
    baseVersion: { versionId: 'v1', contentHash: 'b1', scope: ['margin_line'] },
    provenance: { predictor: { id: 'p', version: '1' }, geometryEngine: { id: 'g', version: '1' }, paramsHash: 'x' },
    regions: [
      { regionId: 'a', label: 'A', t: [0.1, 0.3], correspondence: 'MATCHED', displacement: { direction: 'apical', maxUm: 100, meanUm: 50 } },
      { regionId: 'b', label: 'B', t: [0.5, 0.7], correspondence: 'AMBIGUOUS', displacement: { direction: 'apical', maxUm: 80, meanUm: 40 } },
    ],
    preference: { score: 0.9, interval: [0.8, 0.95], basis: 'test', predictor: { id: 'p', version: '1' } },
    quality: { gateRef: 'g', criteriaSetVersion: 's1', requiredCriteria: ['c1', 'c2'], results: [pass('c1'), pass('c2')], passed: true, evaluatedAt: '' },
    presentation: 'adoptable',
    geometry: {
      kind: 'margin_line_displacement',
      frameVersion: 'f',
      samples: [
        { t: 0.2, lateralUm: -100 },
        { t: 0.6, lateralUm: -80 },
      ],
    },
    createdAt: '',
    ...overrides,
  };
}

describe('assessGate (05 §10.7, I12: fail closed)', () => {
  it('passes only when every required criterion is evaluable and passed', () => {
    expect(assessGate(candidate().quality).passed).toBe(true);
  });

  it('treats a missing result as not passed, even if the Runtime says passed', () => {
    const g = assessGate({ ...candidate().quality, results: [pass('c1')] });
    expect(g.passed).toBe(false);
    expect(g.missing).toEqual(['c2']);
    expect(g.inconsistent).toBe(true);
  });

  it('treats not-evaluable and not-evaluated as not passed', () => {
    const notEvaluable = assessGate({
      ...candidate().quality,
      passed: false,
      results: [pass('c1'), { ...pass('c2'), evaluationValidity: 'not_evaluable', qualityResult: 'not_evaluated' }],
    });
    expect(notEvaluable.passed).toBe(false);
    expect(notEvaluable.notEvaluable).toHaveLength(1);
    const notEvaluated = assessGate({ ...candidate().quality, passed: false, results: [pass('c1'), { ...pass('c2'), qualityResult: 'not_evaluated' }] });
    expect(notEvaluated.passed).toBe(false);
    expect(notEvaluated.notEvaluated).toHaveLength(1);
  });

  it('never passes an empty criteria set', () => {
    expect(assessGate({ ...candidate().quality, requiredCriteria: [], results: [] }).passed).toBe(false);
  });

  it('does not let the UI upgrade a Runtime "not passed"', () => {
    expect(assessGate({ ...candidate().quality, passed: false }).passed).toBe(false);
  });
});

describe('candidateView', () => {
  it('shows geometry only inside MATCHED regions', () => {
    const v = candidateView(candidate());
    expect(v.adoptable).toBe(true);
    expect(v.samples.map((s) => s.t)).toEqual([0.2]);
    expect(v.showsDisplacement(candidate().regions[0]!)).toBe(true);
    expect(v.showsDisplacement(candidate().regions[1]!)).toBe(false);
  });

  it('withholds geometry when the gate fails, regardless of preference', () => {
    const c = candidate({
      preference: { score: 0.99, interval: [0.98, 1], basis: 'x', predictor: { id: 'p', version: '1' } },
      quality: { ...candidate().quality, passed: false, results: [pass('c1'), { ...pass('c2'), qualityResult: 'fail' }] },
    });
    const v = candidateView(c);
    expect(v.adoptable).toBe(false);
    expect(v.samples).toEqual([]);
    expect(v.showsDisplacement(c.regions[0]!)).toBe(false);
    expect(v.withheldReason).toMatch(/未通过质量闸门/);
  });

  it('is not adoptable when the Runtime marks it diagnostic or omits geometry', () => {
    expect(candidateView(candidate({ presentation: 'diagnostic' })).adoptable).toBe(false);
    const { geometry: _omit, ...noGeometry } = candidate();
    expect(candidateView(noGeometry as Candidate).adoptable).toBe(false);
  });
});

function step(state: PlanStep['state'], extra: Partial<PlanStep> = {}): PlanStep {
  return {
    stepId: 's',
    index: 1,
    title: 't',
    purpose: '',
    tool: { toolId: 'x', version: '1', kind: 'adapter', tier: 'E', sideEffects: 'writes_cad', deterministic: true, idempotent: false },
    state,
    attempts: [],
    maxAttempts: 1,
    ...extra,
  };
}
const plan = (status: Plan['status']): Plan => ({ planId: 'p', version: 1, status, createdAt: '', steps: [] });

describe('stepDisplay', () => {
  it('labels never-started steps by why they did not run', () => {
    expect(stepDisplay(step(null), plan('active'), { state: 'CANCELLED' }).label).toBe('未执行（任务已取消）');
    expect(stepDisplay(step(null), plan('superseded'), { state: 'RUNNING' }).label).toBe('未执行（计划已修订）');
    expect(stepDisplay(step(null), plan('active'), { state: 'RUNNING' }).label).toBe('待执行');
  });

  it('does not relabel unfinished steps as completed or cancelled-at-step level', () => {
    const d = stepDisplay(step('AWAITING_APPROVAL'), plan('active'), { state: 'CANCELLED' });
    expect(d.label).toBe('未完成（任务已取消）');
    expect(d.tone).toBe('muted');
  });

  it('keeps an in-doubt side effect visible even after cancellation', () => {
    const d = stepDisplay(step('IN_DOUBT'), plan('active'), { state: 'CANCELLED' });
    expect(d.label).toBe('结果不明');
    expect(d.tone).toBe('danger');
  });
});

describe('approvalAvailability', () => {
  const deployment: DeploymentInfo = {
    deploymentId: 'd',
    mode: 'assist-execute',
    simulated: false,
    cadConnected: true,
    policyVersion: 'p',
    gateCriteriaSetVersion: 's1',
    registeredTools: [step(null).tool],
    capabilities: { cancelTask: true, humanFeedback: true, approvals: true, caseSelection: true },
    identity: { userId: 'u', displayName: 'U', authenticated: true },
  };
  const request: ApprovalRequest = {
    approvalRequestId: 'r',
    taskId: 't',
    stepId: 's',
    candidateId: 'cand-1',
    candidateHash: 'h1',
    target: { caseId: 'case-1', sessionId: 'x', object: 'margin_line', tooth: '46' },
    baseVersion: { versionId: 'v1', contentHash: 'b1', scope: [] },
    provenance: candidate().provenance,
    qualityGateRef: 'g',
    criteriaSetVersion: 's1',
    policyVersion: 'p',
    requestedAt: '',
    status: 'pending',
  };
  const task = {
    state: 'BLOCKED',
    blocked: { reason: 'approval', since: '', summary: '', completed: [], requiredAction: '', allowedResponses: [] },
    plans: [{ ...plan('active'), steps: [step('AWAITING_APPROVAL')] }],
  } as unknown as TaskSnapshot;
  const base = { request, candidate: candidate(), task, deployment, hasChannel: true };

  it('allows a decision when every condition holds', () => {
    expect(approvalAvailability(base)).toEqual({ canDecide: true, reasons: [] });
  });

  it.each<[string, Partial<typeof base>]>([
    ['no channel', { hasChannel: false }],
    ['assist mode', { deployment: { ...deployment, mode: 'assist' } }],
    ['E tool not registered', { deployment: { ...deployment, registeredTools: [] } }],
    ['request not pending', { request: { ...request, status: 'invalidated' } }],
    ['expired', { request: { ...request, expiresAt: '2000-01-01T00:00:00Z' } }],
    ['task not waiting for approval', { task: { ...task, state: 'RUNNING' } as TaskSnapshot }],
    ['cancel requested', { task: { ...task, cancelRequested: true } as TaskSnapshot }],
    ['candidate missing', { candidate: undefined }],
    ['candidate hash mismatch', { candidate: candidate({ candidateHash: 'other' }) }],
    ['candidate base version mismatch', { candidate: candidate({ baseVersion: { versionId: 'v2', contentHash: 'b2', scope: [] } }) }],
    ['gate not passed', { candidate: candidate({ presentation: 'diagnostic' }) }],
    ['unauthenticated in a real deployment', { deployment: { ...deployment, identity: { ...deployment.identity, authenticated: false } } }],
  ])('blocks the decision: %s', (_name, override) => {
    const result = approvalAvailability({ ...base, ...override });
    expect(result.canDecide).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('allows an unauthenticated identity only in a simulated deployment', () => {
    const sim = { ...deployment, simulated: true, identity: { ...deployment.identity, authenticated: false } };
    expect(approvalAvailability({ ...base, deployment: sim }).canDecide).toBe(true);
  });
});
