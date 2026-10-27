import type { ApprovalRequest, QualityGateResult } from '@cadcopilot/contracts';
import { TOOL_CATALOG } from '@cadcopilot/agent-tools';
import { describe, expect, it } from 'vitest';
import { PolicyGate } from './policyGate';

const gate = (passed: boolean, results = [{ criterionId: 'a', label: 'a', evaluationValidity: 'evaluable' as const, qualityResult: 'pass' as const }]): QualityGateResult => ({
  gateRef: 'g',
  criteriaSetVersion: 'set-1',
  requiredCriteria: ['a'],
  results,
  passed,
  evaluatedAt: '',
});

const policy = new PolicyGate({ mode: 'assist-execute', policyVersion: 'p-1', gateCriteriaSetVersion: 'set-1', egressAllowed: ['public_query'] });
const good = { candidateId: 'c', candidateHash: 'h', gate: gate(true), hasGeometry: true };
const approval: ApprovalRequest = {
  approvalRequestId: 'r',
  taskId: 't',
  stepId: 's',
  candidateId: 'c',
  candidateHash: 'h',
  target: { caseId: 'case', sessionId: 'x', object: 'margin_line', tooth: '46' },
  baseVersion: { versionId: 'v2', contentHash: 'b2', scope: [] },
  provenance: { predictor: { id: 'p', version: '1' }, geometryEngine: { id: 'g', version: '1' }, paramsHash: 'x' },
  qualityGateRef: 'g',
  criteriaSetVersion: 'set-1',
  policyVersion: 'p-1',
  requestedAt: '',
  status: 'approved',
  record: { approvalId: 'a', approver: { userId: 'u', displayName: 'U', authenticated: true }, decision: 'approve', decidedAt: '', uses: 1 },
};
const check = (toolKey: keyof typeof TOOL_CATALOG, extra: object = {}) =>
  policy.checkStep({ toolId: TOOL_CATALOG[toolKey].toolId, definition: TOOL_CATALOG[toolKey], now: Date.now(), ...extra });

describe('PolicyGate (05 §10)', () => {
  it('denies unregistered tools and undeclared or disallowed egress', () => {
    expect(policy.checkStep({ toolId: 'x', definition: undefined, now: 0 })).toMatchObject({ verdict: 'deny', code: 'NOT_REGISTERED' });
    expect(policy.checkEgress({ sendsOutside: true, categories: [] })).toMatchObject({ verdict: 'deny' });
    expect(policy.checkEgress({ sendsOutside: true, categories: ['deidentified_geometry'] })).toMatchObject({ verdict: 'deny' });
    expect(policy.checkEgress({ sendsOutside: true, categories: ['public_query'] })).toEqual({ verdict: 'allow' });
  });

  it('fails closed on display: only a fully passed gate with geometry may be shown as adoptable (I12)', () => {
    expect(check('displayCandidate', { candidate: good })).toEqual({ verdict: 'allow' });
    expect(check('displayCandidate', { candidate: { ...good, gate: gate(false) } })).toMatchObject({ verdict: 'deny', code: 'POLICY_DENIED' });
    expect(check('displayCandidate', { candidate: { ...good, gate: undefined } })).toMatchObject({ verdict: 'deny' });
    expect(check('displayCandidate', { candidate: { ...good, gate: gate(true, []) } })).toMatchObject({ verdict: 'deny' });
    expect(check('displayCandidate', { candidate: { ...good, hasGeometry: false } })).toMatchObject({ verdict: 'deny' });
    // Hints are always allowed for a known candidate.
    expect(check('displayRegionHint', { candidate: { ...good, gate: gate(false) } })).toEqual({ verdict: 'allow' });
  });

  it('never asks for approval of a candidate the gate would block, and requires one otherwise', () => {
    expect(check('writeMarginLine', { candidate: { ...good, gate: gate(false) } })).toMatchObject({ verdict: 'deny' });
    expect(check('writeMarginLine', { candidate: good })).toEqual({ verdict: 'needs_approval' });
    expect(check('writeMarginLine', { candidate: good, approval })).toEqual({ verdict: 'allow' });
  });

  it('voids approvals on any binding change (§10.3)', () => {
    expect(check('writeMarginLine', { candidate: { ...good, candidateHash: 'other' }, approval })).toMatchObject({ verdict: 'deny' });
    expect(check('writeMarginLine', { candidate: good, approval: { ...approval, policyVersion: 'p-0' } })).toMatchObject({ verdict: 'deny' });
    expect(check('writeMarginLine', { candidate: good, approval: { ...approval, criteriaSetVersion: 'set-0' } })).toMatchObject({ verdict: 'deny' });
    expect(check('writeMarginLine', { candidate: good, approval: { ...approval, expiresAt: '2000-01-01T00:00:00Z' } })).toMatchObject({ verdict: 'deny' });
    expect(check('writeMarginLine', { candidate: good, approval: { ...approval, status: 'consumed' } })).toMatchObject({ verdict: 'deny' });
    expect(policy.checkBaseVersion(approval, { versionId: 'v3', contentHash: 'b3' })).toMatchObject({ verdict: 'deny', code: 'BASE_VERSION_CHANGED' });
    expect(policy.checkBaseVersion(approval, { versionId: 'v2', contentHash: 'other' })).toMatchObject({ verdict: 'deny' });
    expect(policy.checkBaseVersion(approval, { versionId: 'v2', contentHash: 'b2' })).toEqual({ verdict: 'allow' });
  });

  it('refuses E-tier tools outside assist-execute even if asked directly', () => {
    const assist = new PolicyGate({ mode: 'assist', policyVersion: 'p-1', gateCriteriaSetVersion: 'set-1', egressAllowed: [] });
    expect(assist.checkStep({ toolId: TOOL_CATALOG.writeMarginLine.toolId, definition: TOOL_CATALOG.writeMarginLine, candidate: good, approval, now: Date.now() })).toMatchObject({ verdict: 'deny', code: 'POLICY_DENIED' });
  });
});
