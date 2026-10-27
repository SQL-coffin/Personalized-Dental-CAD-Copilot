/**
 * Predictor interface (05 §7.5) and the non-learning baselines of 03 §5:
 *   - RegionAveragePredictor: P_self / P_pop — per-region historical average,
 *     no case similarity;
 *   - SimilarCaseRetrievalPredictor: M / G — average of the k most similar
 *     historical cases.
 * Whether a baseline is "personal" (P_self, M) or "general" (P_pop, G) is
 * decided by the history pool, not by the algorithm, so the comparison
 * changes one thing at a time (03 §5: same method, different pool).
 *
 * L (personal learning) is an interface placeholder: nothing is trained here.
 */
import { stableHash, type ArcInterval, type Correspondence, type DisplacementSample, type RegionDisplacement } from '@cadcopilot/contracts';
import type { CaseCovariates, CompletedCaseRow } from '@cadcopilot/data';
import type { HistoryView } from './history';
import type { ConditionId } from './registration';

export interface PredictionTarget {
  caseId: string;
  technicianId: string;
  patientPseudonym: string;
  covariates: CaseCovariates;
  /** Regions of the case on S_0, with their current correspondence state. */
  regions: Array<{ regionId: string; label: string; t: ArcInterval; correspondence: Correspondence }>;
}

export interface RegionPrediction {
  regionId: string;
  label: string;
  t: ArcInterval;
  correspondence: Correspondence;
  /** Expected to change by at least the noise threshold. */
  changed: boolean;
  /** Pointwise prediction, only for MATCHED regions (01 §5 rule 3). */
  displacement?: RegionDisplacement;
  profile?: DisplacementSample[];
  /** Historical cases agreeing with the predicted direction, out of those usable. */
  support: { agreeing: number; total: number };
}

export interface PredictionResult {
  predictorId: string;
  version: string;
  condition: ConditionId;
  paramsHash: string;
  regions: RegionPrediction[];
  /** Personal Preference Score: agreement with this history, with uncertainty. Not quality (I5). */
  preference: { score: number; interval: [number, number]; basis: string };
  neighbors: Array<{ caseId: string; similarity: number }>;
  historySize: number;
}

export interface PredictOptions {
  /**
   * Multiplier on predicted magnitudes. Used by the simulation to stand in
   * for a human revision request; it changes the parameter fingerprint.
   */
  magnitudeScale?: number;
}

export interface Predictor {
  readonly id: string;
  readonly version: string;
  readonly condition: ConditionId;
  /** Frozen before evaluation (05 §7.5). */
  readonly frozen: boolean;
  readonly params: Readonly<Record<string, number | string>>;
  predict(target: PredictionTarget, history: HistoryView, options?: PredictOptions): PredictionResult;
}

export class PredictorNotImplementedError extends Error {
  readonly info = { layer: 'research' as const, code: 'NOT_IMPLEMENTED', message: '', retryable: false };
  constructor(message: string) {
    super(message);
    this.name = 'PredictorNotImplementedError';
    this.info.message = message;
  }
}

// ---------------------------------------------------------------------------

const round = (v: number, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits;

function valueAt(profile: DisplacementSample[], t: number): number {
  if (profile.length === 0) return 0;
  if (t <= profile[0]!.t) return profile[0]!.lateralUm;
  for (let i = 1; i < profile.length; i += 1) {
    const a = profile[i - 1]!;
    const b = profile[i]!;
    if (t <= b.t) return a.lateralUm + ((b.lateralUm - a.lateralUm) * (t - a.t)) / Math.max(b.t - a.t, 1e-9);
  }
  return profile[profile.length - 1]!.lateralUm;
}

function peakOf(profile: DisplacementSample[]): number {
  return profile.reduce((best, s) => (Math.abs(s.lateralUm) > Math.abs(best) ? s.lateralUm : best), 0);
}

/** Wilson score interval (95%). */
export function wilsonInterval(successes: number, total: number): [number, number] {
  if (total === 0) return [0, 1];
  const z = 1.96;
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
  return [round(Math.max(0, centre - half), 2), round(Math.min(1, centre + half), 2)];
}

/** Similarity of two cases from their covariates, in [0, 1]. */
export function covariateSimilarity(a: CaseCovariates, b: CaseCovariates): number {
  const parts: Array<[number, boolean]> = [
    [2, a.toothClass === b.toothClass],
    [1, a.arch === b.arch],
    [1, a.prepType === b.prepType],
    [1.5, a.scanQuality === b.scanQuality],
  ];
  const total = parts.reduce((s, [w]) => s + w, 0);
  return round(parts.reduce((s, [w, eq]) => s + (eq ? w : 0), 0) / total, 3);
}

function aggregate(
  target: PredictionTarget,
  rows: ReadonlyArray<{ row: CompletedCaseRow; weight: number }>,
  thresholdUm: number,
  scale: number,
): { regions: RegionPrediction[]; agreeing: number; total: number } {
  let agreeing = 0;
  let total = 0;
  const regions = target.regions.map((region): RegionPrediction => {
    const usable = rows.flatMap(({ row, weight }) => {
      const r = row.finalDelta.regions.find((x) => x.regionId === region.regionId);
      return r && r.correspondence === 'MATCHED' && r.profile ? [{ profile: r.profile, weight }] : [];
    });
    const weightSum = usable.reduce((s, u) => s + u.weight, 0);
    const grid = Array.from({ length: 17 }, (_, i) => round(region.t[0] + ((region.t[1] - region.t[0]) * i) / 16, 4));
    const mean: DisplacementSample[] = grid.map((t) => ({
      t,
      lateralUm: weightSum === 0 ? 0 : round((usable.reduce((s, u) => s + u.weight * valueAt(u.profile, t), 0) / weightSum) * scale),
    }));
    const peak = peakOf(mean);
    const changed = Math.abs(peak) >= thresholdUm;
    const agree = usable.filter((u) => {
      const p = peakOf(u.profile);
      return changed ? Math.sign(p) === Math.sign(peak) && Math.abs(p) >= thresholdUm : Math.abs(p) < thresholdUm;
    }).length;
    const base = { regionId: region.regionId, label: region.label, t: region.t, correspondence: region.correspondence, changed, support: { agreeing: agree, total: usable.length } };
    if (region.correspondence !== 'MATCHED' || usable.length === 0) return base;
    agreeing += agree;
    total += usable.length;
    const magnitudes = mean.map((s) => Math.abs(s.lateralUm));
    return {
      ...base,
      displacement: {
        direction: peak === 0 ? 'uncertain' : peak < 0 ? 'apical' : 'coronal',
        maxUm: round(Math.max(...magnitudes), 0),
        meanUm: round(magnitudes.reduce((s, v) => s + v, 0) / magnitudes.length, 0),
      },
      profile: mean,
    };
  });
  return { regions, agreeing, total };
}

abstract class BaselinePredictor implements Predictor {
  readonly frozen = true;
  abstract readonly id: string;
  abstract readonly version: string;
  abstract readonly params: Readonly<Record<string, number | string>>;

  constructor(readonly condition: ConditionId) {}

  protected abstract weigh(target: PredictionTarget, history: HistoryView): Array<{ row: CompletedCaseRow; weight: number; similarity: number }>;

  predict(target: PredictionTarget, history: HistoryView, options: PredictOptions = {}): PredictionResult {
    const scale = options.magnitudeScale ?? 1;
    const weighted = this.weigh(target, history);
    const threshold = Number(this.params.noiseThresholdUm ?? 25);
    const { regions, agreeing, total } = aggregate(target, weighted, threshold, scale);
    return {
      predictorId: this.id,
      version: this.version,
      condition: this.condition,
      paramsHash: stableHash(JSON.stringify({ id: this.id, version: this.version, condition: this.condition, params: this.params, scale })),
      regions,
      preference: {
        score: total === 0 ? 0 : round(agreeing / total, 2),
        interval: wilsonInterval(agreeing, total),
        basis:
          weighted.length === 0
            ? '没有满足时间与患者边界的历史病例'
            : `与 ${history.cases.length} 个历史病例中的 ${weighted.length} 个比较（${this.condition}）`,
      },
      neighbors: weighted.map((w) => ({ caseId: w.row.caseId, similarity: w.similarity })),
      historySize: history.cases.length,
    };
  }
}

/** P_self / P_pop: every case in the pool counts equally; no similarity. */
export class RegionAveragePredictor extends BaselinePredictor {
  readonly id = 'baseline.region_average';
  readonly version = '0.1.0';
  readonly params = { noiseThresholdUm: 25 };

  protected weigh(_target: PredictionTarget, history: HistoryView) {
    return history.cases.map((row) => ({ row, weight: 1, similarity: 1 }));
  }
}

/** M / G: the k most similar cases in the pool, weighted by similarity. */
export class SimilarCaseRetrievalPredictor extends BaselinePredictor {
  readonly id = 'baseline.similar_case_retrieval';
  readonly version = '0.1.0';
  readonly params: Readonly<Record<string, number | string>>;
  private readonly k: number;

  constructor(condition: ConditionId, k = 5) {
    super(condition);
    this.k = k;
    this.params = { k, noiseThresholdUm: 25, similarity: 'covariates-v1' };
  }

  protected weigh(target: PredictionTarget, history: HistoryView) {
    return history.cases
      .map((row) => ({ row, similarity: covariateSimilarity(target.covariates, row.covariates) }))
      .sort((a, b) => b.similarity - a.similarity || b.row.confirmedAt.localeCompare(a.row.confirmedAt) || a.row.caseId.localeCompare(b.row.caseId))
      .slice(0, this.k)
      .map((x) => ({ ...x, weight: Math.max(x.similarity, 0.1) }));
  }
}

/** L: interface only. Personal learning is evaluated only after M shows value over P_self (03 §5). */
export class PersonalLearningPredictor implements Predictor {
  readonly id = 'learning.personal';
  readonly version = 'unimplemented';
  readonly condition: ConditionId = 'L';
  readonly frozen = false;
  readonly params = {};

  predict(): PredictionResult {
    throw new PredictorNotImplementedError('个人学习（L）尚未实现；需要先在评估中确认 M 相对 P_self 的收益（03 §5）');
  }
}
