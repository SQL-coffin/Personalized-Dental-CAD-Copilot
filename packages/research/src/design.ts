/**
 * Design diagnostics for the confirmed assignment rule (ADR-0003): every case
 * goes to exactly one technician, no case is shared or repeated.
 *
 * Under that rule technicians and cases are nested. A difference between two
 * technicians is a difference between two sets of cases as well, so it can
 * never be read directly as personal preference. These diagnostics say which
 * analyses the data can support, which are confounded, and which are not
 * available at all. They decide nothing about case counts.
 */
import { listCompletedCases, type CaseCovariates, type DataStoreReader } from '@cadcopilot/data';

type Covariate = 'scanQuality' | 'toothClass' | 'prepType';
const COVARIATES: Covariate[] = ['scanQuality', 'toothClass', 'prepType'];

export interface TechnicianCaseMix {
  technicianId: string;
  completedCases: number;
  openCases: number;
  patients: number;
  covariates: Record<Covariate, Record<string, number>>;
}

export interface DesignNote {
  analysis: string;
  status: 'available' | 'confounded' | 'not_available';
  reason: string;
}

export interface DesignDiagnostics {
  /** Cases without an assignment (the store already refuses double assignment). */
  unassignedCases: string[];
  technicians: TechnicianCaseMix[];
  /** Covariate values whose share differs strongly between technicians. */
  imbalance: Array<{ covariate: Covariate; value: string; maxShareDifference: number }>;
  notes: DesignNote[];
  casesPerTechnician: 'to_be_confirmed';
}

const IMBALANCE_THRESHOLD = 0.3;

export function diagnoseDesign(store: DataStoreReader): DesignDiagnostics {
  const completed = listCompletedCases(store);
  const assignments = store.listAssignments();
  const assigned = new Set(assignments.map((a) => a.caseId));
  const unassignedCases = store.listCases().filter((c) => !assigned.has(c.caseId)).map((c) => c.caseId);

  const technicians: TechnicianCaseMix[] = store.listTechnicians().map((t) => {
    const mine = completed.filter((r) => r.technicianId === t.technicianId);
    const openCases = assignments.filter((a) => a.technicianId === t.technicianId).length - mine.length;
    const covariates = Object.fromEntries(
      COVARIATES.map((c) => [c, mine.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.covariates[c]]: (acc[r.covariates[c]] ?? 0) + 1 }), {})]),
    ) as Record<Covariate, Record<string, number>>;
    return { technicianId: t.technicianId, completedCases: mine.length, openCases, patients: new Set(mine.map((r) => r.patientPseudonym)).size, covariates };
  });

  const withCases = technicians.filter((t) => t.completedCases > 0);
  const imbalance: DesignDiagnostics['imbalance'] = [];
  for (const c of COVARIATES) {
    const values = new Set(withCases.flatMap((t) => Object.keys(t.covariates[c])));
    for (const value of values) {
      const shares = withCases.map((t) => (t.covariates[c][value] ?? 0) / t.completedCases);
      const diff = Math.round((Math.max(...shares) - Math.min(...shares)) * 100) / 100;
      if (withCases.length > 1 && diff >= IMBALANCE_THRESHOLD) imbalance.push({ covariate: c, value, maxShareDifference: diff });
    }
  }

  const enough = technicians.filter((t) => t.completedCases >= 2).map((t) => t.technicianId);
  const tooFew = technicians.filter((t) => t.completedCases < 2).map((t) => t.technicianId);
  const imbalanceText = imbalance.length
    ? `当前数据中病例构成不平衡：${imbalance.map((i) => `${i.covariate}=${i.value}（差 ${i.maxShareDifference}）`).join('；')}。`
    : '';

  const notes: DesignNote[] = [
    {
      analysis: '同一病例的跨牙技师比较（例如标准病例设计）',
      status: 'not_available',
      reason: '每个病例只分配给一位牙技师，数据中不存在两位牙技师处理同一病例的情况。',
    },
    {
      analysis: '同一牙技师重复处理同一病例（个人内一致性）',
      status: 'not_available',
      reason: '同一牙技师不会重复处理同一病例。',
    },
    {
      analysis: '个人检索 vs 个人先验（M vs P_self）',
      status: enough.length > 0 ? 'available' : 'not_available',
      reason:
        enough.length > 0
          ? `只在同一牙技师自己的历史内比较，不跨人。可用于：${enough.join('、')}${tooFew.length ? `；不足 2 个已确认病例：${tooFew.join('、')}` : ''}。`
          : '没有牙技师拥有至少 2 个已确认病例。',
    },
    {
      analysis: '个人 vs 通用（M vs G）及牙技师之间的修正量比较',
      status: withCases.length > 1 ? 'confounded' : 'not_available',
      reason:
        withCases.length > 1
          ? `牙技师与病例嵌套：差异同时包含个人偏好与病例构成，不能直接解释为个人偏好；需要按病例协变量调整或检查平衡。${imbalanceText}`
          : '只有一位牙技师有已确认病例。',
    },
    {
      analysis: '每位牙技师的病例数',
      status: 'not_available',
      reason: '病例数尚未确认；当前数字来自合成数据的演示参数，不是研究设计。',
    },
  ];

  return { unassignedCases, technicians, imbalance, notes, casesPerTechnician: 'to_be_confirmed' };
}

/** For callers that only have covariates: a readable key for grouping cases. */
export function covariateKey(c: CaseCovariates): string {
  return `${c.toothClass}/${c.prepType}/${c.scanQuality}`;
}
