import { buildSyntheticDataset, listCompletedCases, MARGIN_REGIONS } from '@cadcopilot/data';
import { describe, expect, it } from 'vitest';
import { diagnoseDesign } from './design';
import { buildHistoryView } from './history';
import { changedIntervals, evaluateCase, regionF1, summarizeByCase } from './metrics';
import { PersonalLearningPredictor, PredictorNotImplementedError, RegionAveragePredictor, SimilarCaseRetrievalPredictor, wilsonInterval } from './predictors';
import { DRAFT_REGISTRATION } from './registration';
import { chooseHoldoutPatients, splitByPatient } from './split';

const ds = buildSyntheticDataset();
const tech = ds.currentTechnicianId;
const open = ds.store.getCase('case-sim-0001')!;
const target = {
  caseId: open.caseId,
  technicianId: tech,
  patientPseudonym: open.patientPseudonym,
  covariates: open.covariates,
  regions: MARGIN_REGIONS.map((r) => ({ ...r, correspondence: 'MATCHED' as const })),
};
const asOf = '2026-10-27T00:00:00.000Z';

describe('history view boundary (05 §8.3)', () => {
  it('returns only the same technician’s confirmed cases before as_of, excluding the patient', () => {
    const view = buildHistoryView(ds.store, { pool: { kind: 'same_technician', technicianId: tech }, asOf, excludePatients: [open.patientPseudonym] });
    expect(view.cases.length).toBeGreaterThan(0);
    for (const row of view.cases) {
      expect(row.technicianId).toBe(tech);
      expect(row.patientPseudonym).not.toBe(open.patientPseudonym);
      expect(Date.parse(row.confirmedAt)).toBeLessThan(Date.parse(asOf));
    }
    // The historical case of the same patient is excluded, with a reason.
    expect(view.excluded.some((e) => e.reason === 'excluded_patient')).toBe(true);
  });

  it('excludes everything confirmed at or after as_of', () => {
    const view = buildHistoryView(ds.store, { pool: { kind: 'all' }, asOf: '2026-01-01T00:00:00Z', excludePatients: [] });
    expect(view.cases).toHaveLength(0);
    expect(view.excluded.every((e) => e.reason === 'not_before_as_of')).toBe(true);
  });
});

describe('predictors', () => {
  const personal = buildHistoryView(ds.store, { pool: { kind: 'same_technician', technicianId: tech }, asOf, excludePatients: [open.patientPseudonym] });

  it('M uses only the pool it is given and at most k neighbours', () => {
    const result = new SimilarCaseRetrievalPredictor('M', 3).predict(target, personal);
    expect(result.neighbors).toHaveLength(3);
    const allowed = new Set(personal.cases.map((c) => c.caseId));
    for (const n of result.neighbors) expect(allowed.has(n.caseId)).toBe(true);
    expect(result.preference.interval[0]).toBeLessThanOrEqual(result.preference.score);
    expect(result.preference.interval[1]).toBeGreaterThanOrEqual(result.preference.score);
  });

  it('gives no pointwise prediction for a region that is not MATCHED (01 §5 rule 3)', () => {
    const ambiguous = { ...target, regions: target.regions.map((r) => (r.regionId === 'r-db' ? { ...r, correspondence: 'AMBIGUOUS' as const } : r)) };
    const result = new SimilarCaseRetrievalPredictor('M').predict(ambiguous, personal);
    const db = result.regions.find((r) => r.regionId === 'r-db')!;
    expect(db.profile).toBeUndefined();
    expect(db.displacement).toBeUndefined();
    expect(result.regions.find((r) => r.regionId === 'r-l')?.profile).toBeDefined();
  });

  it('is deterministic, and a magnitude scale changes the parameter fingerprint', () => {
    const p = new SimilarCaseRetrievalPredictor('M');
    expect(p.predict(target, personal)).toEqual(p.predict(target, personal));
    expect(p.predict(target, personal, { magnitudeScale: 0.5 }).paramsHash).not.toBe(p.predict(target, personal).paramsHash);
  });

  it('reports an empty history instead of inventing a prediction', () => {
    const empty = buildHistoryView(ds.store, { pool: { kind: 'all' }, asOf: '2026-01-01T00:00:00Z', excludePatients: [] });
    const result = new RegionAveragePredictor('P_self').predict(target, empty);
    expect(result.preference.score).toBe(0);
    expect(result.preference.interval).toEqual([0, 1]);
    expect(result.regions.every((r) => !r.profile)).toBe(true);
  });

  it('L is an explicit placeholder', () => {
    expect(() => new PersonalLearningPredictor().predict()).toThrow(PredictorNotImplementedError);
  });

  it('wilson interval stays within [0, 1]', () => {
    expect(wilsonInterval(5, 5)[1]).toBeLessThanOrEqual(1);
    expect(wilsonInterval(0, 5)[0]).toBeGreaterThanOrEqual(0);
  });
});

describe('metrics (analysis unit = case)', () => {
  it('computes arc-length F1 on intervals', () => {
    expect(regionF1([[0.3, 0.5]], [[0.3, 0.5]]).f1).toBe(1);
    expect(regionF1([[0.3, 0.4]], [[0.3, 0.5]])).toEqual({ precision: 1, recall: 0.5, f1: 0.667 });
    expect(regionF1([], []).f1).toBe(1);
    expect(regionF1([], [[0.1, 0.2]]).f1).toBe(0);
  });

  it('evaluates leave-one-out predictions per case and averages over cases', () => {
    const rows = listCompletedCases(ds.store).filter((r) => r.technicianId === tech);
    const evals = rows.map((row) => {
      const view = buildHistoryView(ds.store, { pool: { kind: 'same_technician', technicianId: tech }, asOf: row.confirmedAt, excludePatients: [row.patientPseudonym] });
      const prediction = new RegionAveragePredictor('P_self').predict(
        { caseId: row.caseId, technicianId: tech, patientPseudonym: row.patientPseudonym, covariates: row.covariates, regions: row.finalDelta.regions.map((r) => ({ regionId: r.regionId, label: r.label, t: r.t, correspondence: r.correspondence })) },
        view,
      );
      return evaluateCase(row.caseId, prediction, row.finalDelta);
    });
    const summary = summarizeByCase(evals);
    expect(summary.cases).toBe(rows.length);
    expect(changedIntervals(rows[0]!.finalDelta, 25).length).toBeGreaterThanOrEqual(0);
  });
});

describe('design diagnostics under one-technician-per-case', () => {
  const d = diagnoseDesign(ds.store);

  it('finds no unassigned cases and reports counts as not yet confirmed', () => {
    expect(d.unassignedCases).toEqual([]);
    expect(d.casesPerTechnician).toBe('to_be_confirmed');
  });

  it('rules out same-case comparisons and flags cross-technician comparisons as confounded', () => {
    const status = Object.fromEntries(d.notes.map((n) => [n.analysis, n.status]));
    expect(status['同一病例的跨牙技师比较（例如标准病例设计）']).toBe('not_available');
    expect(status['同一牙技师重复处理同一病例（个人内一致性）']).toBe('not_available');
    expect(status['个人检索 vs 个人先验（M vs P_self）']).toBe('available');
    expect(status['个人 vs 通用（M vs G）及牙技师之间的修正量比较']).toBe('confounded');
  });

  it('detects the deliberately unbalanced synthetic case mix', () => {
    expect(d.imbalance.length).toBeGreaterThan(0);
  });
});

describe('registration and split', () => {
  it('is a draft owned by the project lead, with case counts unconfirmed', () => {
    expect(DRAFT_REGISTRATION.status).toBe('draft');
    expect(DRAFT_REGISTRATION.assignmentRule.casesPerTechnician).toBe('to_be_confirmed');
  });

  it('never puts one patient on both sides', () => {
    const rows = listCompletedCases(ds.store);
    const holdout = chooseHoldoutPatients(rows.map((r) => r.patientPseudonym), 0.3);
    const { dev, holdout: test } = splitByPatient(rows, holdout);
    const devPatients = new Set(dev.map((r) => r.patientPseudonym));
    expect(test.some((r) => devPatients.has(r.patientPseudonym))).toBe(false);
    expect(dev.length + test.length).toBe(rows.length);
  });
});
