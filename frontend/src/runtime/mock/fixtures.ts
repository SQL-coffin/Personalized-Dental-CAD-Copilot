/**
 * Synthetic fixtures for the mock runtime. Every ID carries "sim" so that a
 * screenshot can never be mistaken for real case data.
 */
import type {
  CandidateRegion,
  CaseSummary,
  DisplacementSample,
  GateCriterionResult,
  Identity,
  RunMode,
  Tier,
  ToolRef,
} from '../contract';

/** Non-cryptographic FNV-1a, enough to give simulated refs stable hash-like values. */
export function simHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `sim:${h.toString(16).padStart(8, '0')}`;
}

export const SIM_POLICY_VERSION = 'policy-sim-0.2';
export const SIM_GATE_SET_VERSION = 'gate-set-sim-0.1';
export const SIM_REGISTRATION_VERSION = 'registration-sim-0.1';

export const SIM_IDENTITY: Identity = {
  userId: 'tech-sim-01',
  displayName: '模拟牙技师 01',
  authenticated: false,
};

const tool = (
  toolId: string,
  kind: ToolRef['kind'],
  tier: Tier,
  sideEffects: ToolRef['sideEffects'],
  opts: Partial<Pick<ToolRef, 'deterministic' | 'idempotent' | 'version'>> = {},
): ToolRef => ({
  toolId,
  version: opts.version ?? '0.1.0-sim',
  kind,
  tier,
  sideEffects,
  deterministic: opts.deterministic ?? true,
  idempotent: opts.idempotent ?? true,
});

export const TOOLS = {
  readDesign: tool('cad.read_design_version', 'adapter', 'R', 'none'),
  correspondence: tool('geometry.correspondence', 'geometry', 'R', 'none'),
  queryHistory: tool('memory.query_history', 'data', 'R', 'none'),
  predictor: tool('predictor.personal_retrieval', 'predictor', 'S', 'writes_store', {
    version: 'frozen-sim-2026-10',
  }),
  qualityGate: tool('geometry.quality_gate', 'geometry', 'R', 'none'),
  displayCandidate: tool('assist.display_candidate', 'io', 'S', 'displays'),
  displayRegionHint: tool('assist.display_region_hint', 'io', 'S', 'displays'),
  recordDecision: tool('ledger.record_decision', 'data', 'S', 'writes_store'),
  writeMarginLine: tool('cad.write_margin_line', 'adapter', 'E', 'writes_cad', { idempotent: false }),
  researchSearch: tool('research.search', 'research', 'R', 'none', { deterministic: false }),
  researchFetch: tool('research.fetch_public_page', 'research', 'R', 'none', { deterministic: false }),
  researchInspect: tool('research.inspect_challenge', 'research', 'R', 'none'),
  researchPause: tool('research.pause_for_human', 'research', 'R', 'none'),
} satisfies Record<string, ToolRef>;

/** §4: a tool whose tier the mode does not allow is not registered at all. */
export function registeredToolsFor(mode: RunMode): ToolRef[] {
  const assistTools = [
    TOOLS.readDesign,
    TOOLS.correspondence,
    TOOLS.queryHistory,
    TOOLS.predictor,
    TOOLS.qualityGate,
    TOOLS.displayCandidate,
    TOOLS.displayRegionHint,
    TOOLS.recordDecision,
  ];
  switch (mode) {
    case 'offline-research':
      return [TOOLS.researchSearch, TOOLS.researchFetch, TOOLS.researchInspect, TOOLS.researchPause];
    case 'shadow':
      return assistTools;
    case 'assist':
      return assistTools;
    case 'assist-execute':
      return [...assistTools, TOOLS.writeMarginLine];
  }
}

export const SIM_CASES: CaseSummary[] = [
  {
    caseId: 'case-sim-0001',
    patientPseudonym: 'pt-sim-a1',
    restoration: '全瓷单冠',
    tooth: '46',
    designObject: 'margin_line',
    currentVersion: { versionId: 'v12', contentHash: 'sha256:sim9f2c41' },
    captureLevel: 'C3',
    synthetic: true,
  },
  {
    caseId: 'case-sim-0002',
    patientPseudonym: 'pt-sim-b7',
    restoration: '氧化锆单冠',
    tooth: '36',
    designObject: 'margin_line',
    currentVersion: { versionId: 'v7', contentHash: 'sha256:sim03ab7e' },
    captureLevel: 'C2',
    synthetic: true,
  },
  {
    caseId: 'case-sim-0003',
    patientPseudonym: 'pt-sim-c3',
    restoration: '全瓷单冠',
    tooth: '16',
    designObject: 'margin_line',
    currentVersion: { versionId: 'v4', contentHash: 'sha256:sim77d0e5' },
    captureLevel: 'C1',
    synthetic: true,
  },
];

/** Smooth bump between t1 and t2 with peak `peakUm` (negative = apical). */
export function bumpProfile(t1: number, t2: number, peakUm: number, n = 24): DisplacementSample[] {
  const samples: DisplacementSample[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = t1 + ((t2 - t1) * i) / n;
    const x = (t - t1) / (t2 - t1);
    samples.push({ t: round(t, 4), lateralUm: round(peakUm * Math.sin(Math.PI * x) ** 2, 1) });
  }
  return samples;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function regionsFor(variant: 'matched' | 'ambiguous'): CandidateRegion[] {
  return [
    {
      regionId: 'r-db',
      label: '远中颊侧',
      t: [0.32, 0.48],
      correspondence: variant === 'matched' ? 'MATCHED' : 'AMBIGUOUS',
      ...(variant === 'matched'
        ? { displacement: { direction: 'apical' as const, maxUm: 120, meanUm: 64 } }
        : {}),
    },
    {
      regionId: 'r-l',
      label: '舌侧',
      t: [0.7, 0.8],
      correspondence: 'MATCHED',
      displacement: { direction: 'coronal', maxUm: 35, meanUm: 18 },
    },
  ];
}

export const GATE_CRITERIA = ['closed_curve', 'self_intersection', 'surface_fit', 'correspondence_validity'];

export function gateResults(variant: 'pass' | 'surface_fit_fail' | 'ambiguous'): GateCriterionResult[] {
  const base: GateCriterionResult[] = [
    { criterionId: 'closed_curve', label: '曲线闭合', evaluationValidity: 'evaluable', qualityResult: 'pass' },
    { criterionId: 'self_intersection', label: '无自交', evaluationValidity: 'evaluable', qualityResult: 'pass' },
    {
      criterionId: 'surface_fit',
      label: '表面贴合（点到面距离 P95）',
      evaluationValidity: 'evaluable',
      qualityResult: 'pass',
      detail: 'P95 = 18 μm（模拟阈值 40 μm）',
    },
    {
      criterionId: 'correspondence_validity',
      label: '依据区域的曲线对应',
      evaluationValidity: 'evaluable',
      qualityResult: 'pass',
      detail: '依据区域均为 MATCHED',
    },
  ];
  if (variant === 'surface_fit_fail') {
    base[2] = {
      ...base[2]!,
      qualityResult: 'fail',
      detail: 'P95 = 63 μm，超过模拟阈值 40 μm',
    };
  }
  if (variant === 'ambiguous') {
    base[3] = {
      ...base[3]!,
      evaluationValidity: 'not_evaluable',
      qualityResult: 'not_evaluated',
      detail: '远中颊侧区域两条对应路径位置不一致（02 §6.3），标为 AMBIGUOUS',
    };
  }
  return base;
}
