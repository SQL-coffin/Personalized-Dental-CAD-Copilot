/**
 * Evaluation metrics (02 §8, 03 §3.1). Computed per case and aggregated over
 * cases: the analysis unit is the case, never a sample point or region
 * (03 §2), so many points from one case do not inflate the sample.
 */
import type { ArcInterval, DisplacementSample } from '@cadcopilot/contracts';
import type { GeometryDelta } from '@cadcopilot/data';
import type { PredictionResult } from './predictors';

const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;

function union(intervals: ArcInterval[]): ArcInterval[] {
  const sorted = intervals.map(([a, b]): ArcInterval => [Math.min(a, b), Math.max(a, b)]).sort((x, y) => x[0] - y[0]);
  const out: ArcInterval[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

const measure = (xs: ArcInterval[]) => union(xs).reduce((s, [a, b]) => s + (b - a), 0);

function overlap(a: ArcInterval[], b: ArcInterval[]): number {
  let total = 0;
  for (const [a1, a2] of union(a)) for (const [b1, b2] of union(b)) total += Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  return total;
}

/**
 * T1: arc-length–weighted precision, recall and F1 of predicted changed
 * regions against changed regions in the Final GD. Both empty counts as
 * agreement. (Intervals are assumed not to wrap past t = 1.)
 */
export function regionF1(predicted: ArcInterval[], actual: ArcInterval[]): { precision: number; recall: number; f1: number } {
  const p = measure(predicted);
  const a = measure(actual);
  if (p === 0 && a === 0) return { precision: 1, recall: 1, f1: 1 };
  if (p === 0 || a === 0) return { precision: p === 0 ? 0 : 0, recall: 0, f1: 0 };
  const o = overlap(predicted, actual);
  const precision = o / p;
  const recall = o / a;
  return { precision: round(precision), recall: round(recall), f1: round(precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)) };
}

/**
 * Regions with a measurable change in a Final GD. A non-MATCHED region has
 * no measured magnitude, but its change is known at region level (02 §4),
 * so it counts as changed.
 */
export function changedIntervals(delta: GeometryDelta, thresholdUm: number): ArcInterval[] {
  return delta.regions
    .filter((r) => r.correspondence !== 'MATCHED' || (r.displacement?.maxUm ?? 0) >= thresholdUm)
    .map((r) => r.t);
}

function interpolate(profile: DisplacementSample[], t: number): number {
  if (profile.length === 0) return 0;
  for (let i = 1; i < profile.length; i += 1) {
    const a = profile[i - 1]!;
    const b = profile[i]!;
    if (t >= a.t && t <= b.t) return a.lateralUm + ((b.lateralUm - a.lateralUm) * (t - a.t)) / Math.max(b.t - a.t, 1e-9);
  }
  return t < profile[0]!.t ? profile[0]!.lateralUm : profile[profile.length - 1]!.lateralUm;
}

/** T2: mean absolute error (μm) per region, only where both sides are MATCHED with profiles. */
export function localChangeError(prediction: PredictionResult, actual: GeometryDelta): Array<{ regionId: string; maeUm: number }> {
  const out: Array<{ regionId: string; maeUm: number }> = [];
  for (const real of actual.regions) {
    const pred = prediction.regions.find((r) => r.regionId === real.regionId);
    if (real.correspondence !== 'MATCHED' || !real.profile || !pred?.profile || pred.correspondence !== 'MATCHED') continue;
    const errors = real.profile.map((s) => Math.abs(interpolate(pred.profile!, s.t) - s.lateralUm));
    out.push({ regionId: real.regionId, maeUm: round(errors.reduce((s, e) => s + e, 0) / errors.length, 1) });
  }
  return out;
}

export interface CaseEvaluation {
  caseId: string;
  t1: { precision: number; recall: number; f1: number };
  t2: { regions: Array<{ regionId: string; maeUm: number }>; meanMaeUm: number | null };
}

export function evaluateCase(caseId: string, prediction: PredictionResult, actual: GeometryDelta, thresholdUm = 25): CaseEvaluation {
  const predicted = prediction.regions.filter((r) => r.changed).map((r) => r.t);
  const t2 = localChangeError(prediction, actual);
  return {
    caseId,
    t1: regionF1(predicted, changedIntervals(actual, thresholdUm)),
    t2: { regions: t2, meanMaeUm: t2.length === 0 ? null : round(t2.reduce((s, r) => s + r.maeUm, 0) / t2.length, 1) },
  };
}

/** Mean over cases (each case weighs one). */
export function summarizeByCase(evaluations: CaseEvaluation[]): { cases: number; meanF1: number | null; meanMaeUm: number | null } {
  const maes = evaluations.flatMap((e) => (e.t2.meanMaeUm === null ? [] : [e.t2.meanMaeUm]));
  return {
    cases: evaluations.length,
    meanF1: evaluations.length === 0 ? null : round(evaluations.reduce((s, e) => s + e.t1.f1, 0) / evaluations.length),
    meanMaeUm: maes.length === 0 ? null : round(maes.reduce((s, v) => s + v, 0) / maes.length, 1),
  };
}
