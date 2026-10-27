import { describe, expect, it } from 'vitest';
import { InMemoryDataStore } from './memoryStore';
import type { CaseRecord } from './model';
import { toCaseRecordView, toCaseSummary } from './projections';
import { listCompletedCases } from './queries';
import { DataConstraintError } from './store';
import { ASSIGNMENT_RULE_VERSION, buildSyntheticDataset } from './synthetic';

function freshStore() {
  const store = new InMemoryDataStore();
  store.addTechnician({ technicianId: 't1', pseudonym: 'T1' });
  store.addTechnician({ technicianId: 't2', pseudonym: 'T2' });
  const rec: CaseRecord = {
    caseId: 'c1',
    patientPseudonym: 'p1',
    designObject: 'margin_line',
    covariates: { restoration: 'x', tooth: '46', arch: 'mandibular', toothClass: 'molar', prepType: 'chamfer', scanQuality: 'good' },
    createdAt: '2026-01-01T00:00:00Z',
    source: 'synthetic',
  };
  store.addCase(rec);
  return store;
}

const code = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return e instanceof DataConstraintError ? e.code : `unexpected: ${String(e)}`;
  }
  return 'no error';
};

const v0 = { caseId: 'c1', versionId: 'v0', object: 'margin_line' as const, parent: null, contentHash: 'h0', geometryRef: 'g0', origin: { kind: 'ai_initial' as const }, createdAt: '' };

describe('case assignment (ADR-0003)', () => {
  it('assigns a case to exactly one technician, once', () => {
    const store = freshStore();
    store.assign({ caseId: 'c1', technicianId: 't1', assignedAt: '', ruleVersion: ASSIGNMENT_RULE_VERSION });
    // Another technician cannot take the same case …
    expect(code(() => store.assign({ caseId: 'c1', technicianId: 't2', assignedAt: '', ruleVersion: 'r' }))).toBe('ASSIGNMENT_CONFLICT');
    // … and the same technician cannot be assigned it again.
    expect(code(() => store.assign({ caseId: 'c1', technicianId: 't1', assignedAt: '', ruleVersion: 'r' }))).toBe('ASSIGNMENT_CONFLICT');
    expect(store.listAssignments()).toHaveLength(1);
  });

  it('lets only the assigned technician open sessions, edit or confirm', () => {
    const store = freshStore();
    store.assign({ caseId: 'c1', technicianId: 't1', assignedAt: '', ruleVersion: 'r' });
    expect(code(() => store.openSession({ sessionId: 's2', caseId: 'c1', technicianId: 't2', captureLevel: 'C3', startedAt: '' }))).toBe('NOT_ASSIGNED_TECHNICIAN');
    store.appendVersion(v0);
    expect(
      code(() => store.appendVersion({ ...v0, versionId: 'v1', parent: 'v0', origin: { kind: 'technician_edit', technicianId: 't2' } })),
    ).toBe('NOT_ASSIGNED_TECHNICIAN');
    expect(
      code(() =>
        store.appendOutcome({
          outcomeId: 'o1', caseId: 'c1', versionId: 'v0', geometryConfirmed: { confirmed: true, by: 't2' },
          independentReview: { status: 'none' }, manufactured: 'unknown', postAdjustment: 'unknown', criteriaResults: [],
          evaluationValidity: 'evaluable', qualityResult: 'not_evaluated', recordedAt: '',
        }),
      ),
    ).toBe('NOT_ASSIGNED_TECHNICIAN');
  });

  it('refuses work on an unassigned case', () => {
    const store = freshStore();
    expect(code(() => store.openSession({ sessionId: 's1', caseId: 'c1', technicianId: 't1', captureLevel: 'C3', startedAt: '' }))).toBe('NOT_ASSIGNED_TECHNICIAN');
  });
});

describe('version graph (02 §6.1)', () => {
  it('starts with S_0, requires known parents, and keeps undo as a new node', () => {
    const store = freshStore();
    store.assign({ caseId: 'c1', technicianId: 't1', assignedAt: '', ruleVersion: 'r' });
    expect(code(() => store.appendVersion({ ...v0, origin: { kind: 'technician_edit', technicianId: 't1' } }))).toBe('INVALID_GRAPH');
    store.appendVersion(v0);
    expect(code(() => store.appendVersion({ ...v0, versionId: 'v1', parent: 'v9', origin: { kind: 'technician_edit', technicianId: 't1' } }))).toBe('UNKNOWN_VERSION');
    store.appendVersion({ ...v0, versionId: 'v1', parent: 'v0', origin: { kind: 'technician_edit', technicianId: 't1' } });
    store.appendVersion({ ...v0, versionId: 'v2', parent: 'v1', revertsTo: 'v0', origin: { kind: 'undo', technicianId: 't1' } });
    expect(store.listVersions('c1').map((v) => v.versionId)).toEqual(['v0', 'v1', 'v2']);
    expect(store.headVersion('c1')?.revertsTo).toBe('v0');
    expect(store.initialVersion('c1')?.versionId).toBe('v0');
  });

  it('requires an approval for Copilot-written versions and actions', () => {
    const store = freshStore();
    store.assign({ caseId: 'c1', technicianId: 't1', assignedAt: '', ruleVersion: 'r' });
    store.appendVersion(v0);
    expect(code(() => store.appendVersion({ ...v0, versionId: 'v1', parent: 'v0', origin: { kind: 'copilot_execution', taskId: 'task', approvalId: '' } }))).toBe('MISSING_APPROVAL');
    store.appendVersion({ ...v0, versionId: 'v1', parent: 'v0', origin: { kind: 'copilot_execution', taskId: 'task', approvalId: 'apr-1' } });
    expect(
      code(() =>
        store.appendAction({
          actionId: 'a1', caseId: 'c1', object: 'margin_line', tool: 'cad.write', fromVersion: 'v0', toVersion: 'v1',
          regions: [], captureLevel: 'C3', actor: { kind: 'copilot', taskId: 'task', approvalId: '' }, at: '',
        }),
      ),
    ).toBe('MISSING_APPROVAL');
  });

  it('rejects pointwise displacement in non-MATCHED regions', () => {
    const store = freshStore();
    store.assign({ caseId: 'c1', technicianId: 't1', assignedAt: '', ruleVersion: 'r' });
    store.appendVersion(v0);
    expect(
      code(() =>
        store.appendDelta({
          deltaId: 'gd', caseId: 'c1', gdType: 'final', object: 'margin_line', fromVersion: 'v0', toVersion: 'v0',
          regions: [{ regionId: 'r', label: 'r', t: [0, 0.1], correspondence: 'AMBIGUOUS', displacement: { direction: 'apical', maxUm: 1, meanUm: 1 } }],
          frameVersion: 'f', computedBy: { tool: 't', version: '1' }, computedAt: '',
        }),
      ),
    ).toBe('INVALID_GRAPH');
  });
});

describe('synthetic dataset', () => {
  const ds = buildSyntheticDataset();

  it('assigns every case to exactly one technician and never repeats a case', () => {
    const assignments = ds.store.listAssignments();
    const cases = ds.store.listCases();
    expect(assignments).toHaveLength(cases.length);
    expect(new Set(assignments.map((a) => a.caseId)).size).toBe(cases.length);
  });

  it('is deterministic for a seed and parameterised in cases per technician', () => {
    const again = buildSyntheticDataset();
    expect(listCompletedCases(again.store).map((r) => r.finalDelta.regions[0]?.displacement?.maxUm)).toEqual(
      listCompletedCases(ds.store).map((r) => r.finalDelta.regions[0]?.displacement?.maxUm),
    );
    const small = buildSyntheticDataset({ historicalCasesPerTechnician: 2 });
    for (const t of small.technicians) {
      expect(listCompletedCases(small.store).filter((r) => r.technicianId === t.technicianId)).toHaveLength(2);
    }
  });

  it('includes a historical case sharing a patient with an open case (for leakage checks)', () => {
    const openPatient = ds.store.getCase('case-sim-0001')!.patientPseudonym;
    const shared = listCompletedCases(ds.store).filter((r) => r.patientPseudonym === openPatient);
    expect(shared.length).toBeGreaterThan(0);
  });

  it('projects case summaries and records for the UI', () => {
    const summary = toCaseSummary(ds.store, 'case-sim-0001');
    expect(summary.assignedTechnician?.technicianId).toBe(ds.currentTechnicianId);
    expect(summary.status).toBe('open');
    expect(summary.currentVersion.versionId).toBe('v2');
    const view = toCaseRecordView(ds.store, 'case-sim-0001');
    expect(view.versions.map((v) => v.origin)).toEqual(['ai_initial', 'technician_edit', 'technician_edit']);
    expect(view.versions.at(-1)?.isCurrent).toBe(true);
    expect(view.confirmation.status).toBe('not_confirmed');
    expect(view.notes.join('')).toMatch(/不等于个人偏好/);
    const historical = toCaseRecordView(ds.store, listCompletedCases(ds.store)[0]!.caseId);
    expect(historical.confirmation.status).toBe('confirmed');
    expect(historical.deltas.some((d) => d.gdType === 'final')).toBe(true);
  });
});
