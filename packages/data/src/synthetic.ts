/**
 * Synthetic dataset for the prototype. Nothing here comes from a real CAD
 * system or a real patient.
 *
 * Generative assumptions (exported as `generator`, shown in the UI):
 *   final displacement in a region =
 *       technician tendency (synthetic)
 *     + case effect from covariates (scan quality, tooth class, prep type)
 *     + noise.
 * Case mix is deliberately unbalanced between technicians, so a naive
 * comparison of technicians mixes personal tendency with case differences.
 * That is the situation the research diagnostics must flag (ADR-0003).
 *
 * The number of cases per technician is a demo parameter. The study's case
 * counts are still to be confirmed and are not decided here.
 */
import type { ArcInterval, CaptureLevel, DisplacementSample } from '@cadcopilot/contracts';
import { InMemoryDataStore } from './memoryStore';
import type {
  CaseCovariates,
  CaseId,
  CaseRecord,
  GeometryDelta,
  RegionDelta,
  Technician,
  TechnicianId,
  ToothClass,
} from './model';

export const ASSIGNMENT_RULE_VERSION = 'assign-one-technician-per-case-v1';
export const FRAME_VERSION = 'frame-sim-0.1';
export const SEGMENTATION_RULE_VERSION = 'ce-seg-sim-0.1';

/** Margin line regions used by the synthetic data. The real anatomical partition is still undecided. */
export const MARGIN_REGIONS: ReadonlyArray<{ regionId: string; label: string; t: ArcInterval }> = [
  { regionId: 'r-db', label: '远中颊侧', t: [0.32, 0.48] },
  { regionId: 'r-l', label: '舌侧', t: [0.7, 0.8] },
];

export interface SyntheticDatasetOptions {
  seed?: number;
  /** Demo parameter only; not a study design decision. */
  historicalCasesPerTechnician?: number;
  technicianCount?: number;
  /** Reference "now"; historical cases are dated before it. */
  now?: string;
}

export interface SyntheticDataset {
  store: InMemoryDataStore;
  technicians: Technician[];
  /** The technician the simulated UI user acts as. */
  currentTechnicianId: TechnicianId;
  /** Open (unconfirmed) cases, per technician. */
  openCases: Record<TechnicianId, CaseId[]>;
  generator: {
    seed: number;
    historicalCasesPerTechnician: number;
    description: string;
    technicianTendencyUm: Record<TechnicianId, Record<string, number>>;
    caseEffects: string[];
    noiseSdUm: number;
  };
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function pick<T>(rng: () => number, weighted: Array<[T, number]>): T {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let x = rng() * total;
  for (const [value, w] of weighted) {
    x -= w;
    if (x <= 0) return value;
  }
  return weighted[weighted.length - 1]![0];
}

/** Non-cryptographic FNV-1a, enough to give synthetic content stable hash-like IDs. */
export function syntheticHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `sim:${h.toString(16).padStart(8, '0')}`;
}

const round = (v: number, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Smooth bump over [t1, t2] with signed peak (negative = apical). */
export function bumpProfile(t: ArcInterval, peakUm: number, n = 16): DisplacementSample[] {
  const [t1, t2] = t;
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = i / n;
    return { t: round(t1 + (t2 - t1) * x, 4), lateralUm: round(peakUm * Math.sin(Math.PI * x) ** 2) };
  });
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

const TEETH: Record<ToothClass, string[]> = {
  molar: ['16', '17', '26', '27', '36', '37', '46', '47'],
  premolar: ['14', '15', '24', '25', '34', '35', '44', '45'],
  canine: ['13', '23', '33', '43'],
  incisor: ['11', '12', '21', '22'],
};

const BASE_TENDENCY: Array<Record<string, number>> = [
  { 'r-db': -90, 'r-l': 30 },
  { 'r-db': -25, 'r-l': 55 },
  { 'r-db': -55, 'r-l': -5 },
];

/** Per technician: weights for scan quality and tooth class (deliberately unbalanced). */
const CASE_MIX: Array<{ scan: Array<[CaseCovariates['scanQuality'], number]>; tooth: Array<[ToothClass, number]> }> = [
  { scan: [['poor', 5], ['fair', 3], ['good', 2]], tooth: [['molar', 6], ['premolar', 3], ['canine', 1]] },
  { scan: [['poor', 1], ['fair', 3], ['good', 6]], tooth: [['molar', 2], ['premolar', 5], ['incisor', 3]] },
  { scan: [['poor', 2], ['fair', 4], ['good', 4]], tooth: [['molar', 4], ['premolar', 4], ['canine', 2]] },
];

const NOISE_SD_UM = 18;

function caseEffect(c: CaseCovariates, regionId: string): number {
  let e = 0;
  if (regionId === 'r-db') {
    if (c.scanQuality === 'poor') e -= 35;
    if (c.scanQuality === 'fair') e -= 15;
    if (c.toothClass === 'molar') e -= 15;
  }
  if (regionId === 'r-l' && c.prepType === 'knife_edge') e += 20;
  return e;
}

function covariatesFor(toothClass: ToothClass, tooth: string, prepType: CaseCovariates['prepType'], scanQuality: CaseCovariates['scanQuality']): CaseCovariates {
  const quadrant = Number(tooth[0]);
  return {
    restoration: prepType === 'shoulder' ? '氧化锆单冠' : '全瓷单冠',
    tooth,
    arch: quadrant === 1 || quadrant === 2 ? 'maxillary' : 'mandibular',
    toothClass,
    prepType,
    scanQuality,
  };
}

function isoDays(base: string, days: number): string {
  return new Date(Date.parse(base) + days * 86_400_000).toISOString();
}

interface Ctx {
  store: InMemoryDataStore;
  rng: () => number;
}

/** S_0 plus `edits` technician versions in one C3/C2 session; returns the last version ID. */
function recordEditing(
  ctx: Ctx,
  rec: CaseRecord,
  technicianId: TechnicianId,
  at: string,
  edits: number,
  captureLevel: CaptureLevel,
  regionPlan: RegionDelta[],
): { lastVersion: string; actionIds: string[]; sessionId: string } {
  const { store } = ctx;
  store.appendVersion({
    caseId: rec.caseId,
    versionId: 'v0',
    object: 'margin_line',
    parent: null,
    contentHash: syntheticHash(`${rec.caseId}:v0`),
    geometryRef: `evidence://sim/${rec.caseId}/v0`,
    origin: { kind: 'ai_initial' },
    createdAt: at,
  });
  const sessionId = `sess-${rec.caseId.replace('case-', '')}-1`;
  store.openSession({ sessionId, caseId: rec.caseId, technicianId, captureLevel, startedAt: at });
  const actionIds: string[] = [];
  let prev = 'v0';
  for (let i = 1; i <= edits; i += 1) {
    const versionId = `v${i}`;
    const when = new Date(Date.parse(at) + i * 90_000).toISOString();
    store.appendVersion({
      caseId: rec.caseId,
      versionId,
      object: 'margin_line',
      parent: prev,
      contentHash: syntheticHash(`${rec.caseId}:${versionId}`),
      geometryRef: `evidence://sim/${rec.caseId}/${versionId}`,
      origin: { kind: 'technician_edit', technicianId, sessionId },
      createdAt: when,
    });
    const region = regionPlan[(i - 1) % regionPlan.length] ?? regionPlan[0];
    const actionId = `act-${i}`;
    store.appendAction({
      actionId,
      caseId: rec.caseId,
      sessionId,
      episodeId: 'ce-1',
      object: 'margin_line',
      tool: 'margin_line.drag_control_point',
      fromVersion: prev,
      toVersion: versionId,
      regions: region ? [{ label: region.label, t: region.t }] : [],
      captureLevel,
      actor: { kind: 'technician', technicianId },
      at: when,
    });
    actionIds.push(actionId);
    prev = versionId;
  }
  return { lastVersion: prev, actionIds, sessionId };
}

function finalRegions(ctx: Ctx, cov: CaseCovariates, tendency: Record<string, number>): RegionDelta[] {
  return MARGIN_REGIONS.map((r) => {
    const peak = round((tendency[r.regionId] ?? 0) + caseEffect(cov, r.regionId) + gaussian(ctx.rng) * NOISE_SD_UM, 0);
    const ambiguous = r.regionId === 'r-db' && cov.scanQuality === 'poor' && ctx.rng() < 0.3;
    if (ambiguous) return { regionId: r.regionId, label: r.label, t: r.t, correspondence: 'AMBIGUOUS' as const };
    const profile = bumpProfile(r.t, peak);
    const magnitudes = profile.map((s) => Math.abs(s.lateralUm));
    return {
      regionId: r.regionId,
      label: r.label,
      t: r.t,
      correspondence: 'MATCHED' as const,
      displacement: {
        direction: peak === 0 ? ('uncertain' as const) : peak < 0 ? ('apical' as const) : ('coronal' as const),
        maxUm: round(Math.max(...magnitudes), 0),
        meanUm: round(magnitudes.reduce((s, v) => s + v, 0) / magnitudes.length, 0),
      },
      profile,
    };
  });
}

export function buildSyntheticDataset(options: SyntheticDatasetOptions = {}): SyntheticDataset {
  const seed = options.seed ?? 20261027;
  const perTech = options.historicalCasesPerTechnician ?? 6;
  const techCount = options.technicianCount ?? 3;
  const now = options.now ?? '2026-10-27T00:00:00.000Z';
  const ctx: Ctx = { store: new InMemoryDataStore(), rng: mulberry32(seed) };
  const { store, rng } = ctx;

  const technicians: Technician[] = Array.from({ length: techCount }, (_, i) => ({
    technicianId: `tech-sim-${String(i + 1).padStart(2, '0')}`,
    pseudonym: `模拟牙技师 ${String(i + 1).padStart(2, '0')}`,
  }));
  const tendency: Record<TechnicianId, Record<string, number>> = {};
  technicians.forEach((t, i) => {
    store.addTechnician(t);
    tendency[t.technicianId] = BASE_TENDENCY[i] ?? { 'r-db': round(-100 + rng() * 120, 0), 'r-l': round(-20 + rng() * 80, 0) };
  });

  // Historical, confirmed cases: each assigned to exactly one technician.
  technicians.forEach((tech, ti) => {
    const mix = CASE_MIX[ti % CASE_MIX.length]!;
    for (let j = 1; j <= perTech; j += 1) {
      const toothClass = pick(rng, mix.tooth);
      const teeth = TEETH[toothClass];
      const tooth = teeth[Math.floor(rng() * teeth.length)]!;
      const prepType = pick<CaseCovariates['prepType']>(rng, [['chamfer', 5], ['shoulder', 3], ['knife_edge', 2]]);
      const cov = covariatesFor(toothClass, tooth, prepType, pick(rng, mix.scan));
      const caseId = `case-sim-h${ti + 1}${String(j).padStart(2, '0')}`;
      // One historical case shares a patient with an open case, to exercise
      // patient-level exclusion in history queries (05 §8.3).
      const patientPseudonym = ti === 0 && j === 1 ? 'pt-sim-a1' : `pt-sim-${ti + 1}${String(j).padStart(2, '0')}`;
      const createdAt = isoDays('2026-05-04T08:00:00.000Z', Math.round(((j - 1) / Math.max(1, perTech)) * 140 + ti * 3));
      const rec: CaseRecord = { caseId, patientPseudonym, designObject: 'margin_line', covariates: cov, createdAt, source: 'synthetic' };
      store.addCase(rec);
      store.assign({ caseId, technicianId: tech.technicianId, assignedAt: createdAt, ruleVersion: ASSIGNMENT_RULE_VERSION });
      const regions = finalRegions(ctx, cov, tendency[tech.technicianId]!);
      const edits = 2 + Math.floor(rng() * 2);
      const { lastVersion, actionIds, sessionId } = recordEditing(ctx, rec, tech.technicianId, createdAt, edits, 'C3', regions);
      store.appendEpisode({
        episodeId: 'ce-1',
        caseId,
        sessionId,
        technicianId: tech.technicianId,
        object: 'margin_line',
        startVersion: 'v0',
        endVersion: lastVersion,
        actionIds,
        segmentationRuleVersion: SEGMENTATION_RULE_VERSION,
      });
      const delta: GeometryDelta = {
        deltaId: 'gd-final',
        caseId,
        gdType: 'final',
        object: 'margin_line',
        fromVersion: 'v0',
        toVersion: lastVersion,
        regions,
        frameVersion: FRAME_VERSION,
        computedBy: { tool: 'geometry.final_delta', version: '0.1.0-sim' },
        computedAt: isoDays(createdAt, 1),
      };
      store.appendDelta(delta);
      store.appendOutcome({
        outcomeId: 'out-1',
        caseId,
        versionId: lastVersion,
        geometryConfirmed: { confirmed: true, at: isoDays(createdAt, 1), by: tech.technicianId },
        independentReview: { status: 'none' },
        manufactured: 'unknown',
        postAdjustment: 'unknown',
        criteriaResults: [],
        evaluationValidity: 'evaluable',
        qualityResult: 'not_evaluated',
        recordedAt: isoDays(createdAt, 1),
      });
    }
  });

  // Open cases: work in progress, not yet confirmed.
  const openSpecs: Array<{ caseId: string; patient: string; tech: number; cov: CaseCovariates; edits: number; capture: CaptureLevel; daysAgo: number }> = [
    { caseId: 'case-sim-0001', patient: 'pt-sim-a1', tech: 0, cov: covariatesFor('molar', '46', 'chamfer', 'good'), edits: 2, capture: 'C3', daysAgo: 7 },
    { caseId: 'case-sim-0002', patient: 'pt-sim-b7', tech: 0, cov: covariatesFor('molar', '36', 'shoulder', 'fair'), edits: 1, capture: 'C2', daysAgo: 5 },
    { caseId: 'case-sim-0003', patient: 'pt-sim-c3', tech: 0, cov: covariatesFor('molar', '16', 'chamfer', 'poor'), edits: 0, capture: 'C1', daysAgo: 3 },
    { caseId: 'case-sim-0004', patient: 'pt-sim-d2', tech: 1, cov: covariatesFor('premolar', '24', 'chamfer', 'good'), edits: 1, capture: 'C3', daysAgo: 4 },
    { caseId: 'case-sim-0005', patient: 'pt-sim-e5', tech: 2, cov: covariatesFor('molar', '37', 'knife_edge', 'fair'), edits: 1, capture: 'C3', daysAgo: 2 },
  ];
  const openCases: Record<TechnicianId, CaseId[]> = Object.fromEntries(technicians.map((t) => [t.technicianId, []]));
  for (const spec of openSpecs) {
    const tech = technicians[spec.tech];
    if (!tech) continue;
    const createdAt = isoDays(now, -spec.daysAgo);
    const rec: CaseRecord = {
      caseId: spec.caseId,
      patientPseudonym: spec.patient,
      designObject: 'margin_line',
      covariates: spec.cov,
      createdAt,
      source: 'synthetic',
    };
    store.addCase(rec);
    store.assign({ caseId: spec.caseId, technicianId: tech.technicianId, assignedAt: createdAt, ruleVersion: ASSIGNMENT_RULE_VERSION });
    const plan = MARGIN_REGIONS.map((r) => ({ regionId: r.regionId, label: r.label, t: r.t, correspondence: 'MATCHED' as const }));
    recordEditing(ctx, rec, tech.technicianId, createdAt, spec.edits, spec.capture, plan);
    openCases[tech.technicianId]!.push(spec.caseId);
  }

  return {
    store,
    technicians,
    currentTechnicianId: technicians[0]!.technicianId,
    openCases,
    generator: {
      seed,
      historicalCasesPerTechnician: perTech,
      description:
        '最终位移 = 牙技师倾向（合成）+ 病例协变量效应（扫描质量、牙位类别、预备体类型）+ 噪声；各牙技师的病例构成有意不平衡。',
      technicianTendencyUm: tendency,
      caseEffects: ['扫描质量差：远中颊侧 −35 μm；一般：−15 μm', '磨牙：远中颊侧 −15 μm', '刃状预备体：舌侧 +20 μm'],
      noiseSdUm: NOISE_SD_UM,
    },
  };
}
