/**
 * Research registration, as data (05 §5.3: hypotheses and experiment
 * configurations exist as registration records, never hard-coded logic).
 *
 * This is a DRAFT for structure only. Statuses, endpoints and thresholds are
 * decided and registered by the project lead (I6); agents may read but not
 * change them. Nothing here says a hypothesis holds.
 */

export type HypothesisId = 'H1' | 'H2' | 'H3' | 'H4';

/** 03 §5 experimental conditions. */
export type ConditionId = 'A0' | 'P_pop' | 'P_self' | 'G' | 'M' | 'L';

export interface ConditionDefinition {
  id: ConditionId;
  method: string;
  pool: 'none' | 'other_technicians' | 'same_technician';
  usesSimilarity: boolean;
  trains: boolean;
  implementation: 'baseline_available' | 'not_implemented' | 'not_applicable';
}

export type HypothesisStatus =
  /** Wording and comparison drafted; endpoint values still to be registered. */
  | 'draft'
  /** Waits on a decision recorded as an open question. */
  | 'pending_decision'
  /** The current assignment design cannot answer it cleanly (see design diagnostics). */
  | 'limited_by_design'
  | 'deferred';

export interface HypothesisRegistration {
  id: HypothesisId;
  title: string;
  comparison: string;
  primaryEndpoint: string;
  status: HypothesisStatus;
  note: string;
}

export interface MetricDefinition {
  id: 'T1_region_f1' | 'T2_local_change_mae_um';
  label: string;
  /** 03 §2: the analysis unit is the case (or patient), never a point or region. */
  unit: 'case';
  scope: string;
}

export interface Registration {
  registrationId: string;
  version: string;
  status: 'draft' | 'registered';
  owner: 'project_lead';
  hypotheses: HypothesisRegistration[];
  conditions: ConditionDefinition[];
  metrics: MetricDefinition[];
  split: { by: 'patient'; temporal: true };
  assignmentRule: { version: string; description: string; casesPerTechnician: 'to_be_confirmed' };
}

export const DRAFT_REGISTRATION: Registration = {
  registrationId: 'reg-draft',
  version: '0.1-draft',
  status: 'draft',
  owner: 'project_lead',
  hypotheses: [
    {
      id: 'H1',
      title: '操作可解释性',
      comparison: '仅轨迹 vs 融合数据（03 §4.2）',
      primaryEndpoint: '主要终点待决议（动作去向或修正意图）',
      status: 'pending_decision',
      note: '需要 C2 / C3 采集粒度。',
    },
    {
      id: 'H2',
      title: '经验可复用性',
      comparison: 'M vs P_self（同一牙技师的病例池）',
      primaryEndpoint: 'T1 区域 F1、T2 局部变化误差',
      status: 'draft',
      note: '只在牙技师自己的历史内比较，不跨牙技师；每位牙技师需要至少 2 个已确认病例。',
    },
    {
      id: 'H3',
      title: '个人适应性',
      comparison: 'M vs G；L vs M',
      primaryEndpoint: '同 H2',
      status: 'limited_by_design',
      note: '每个病例只由一位牙技师处理：M vs G 的差异同时包含个人偏好与病例构成，必须按病例协变量调整或检查平衡。',
    },
    {
      id: 'H4',
      title: '实际生产价值',
      comparison: '现有工作流 vs 辅助系统',
      primaryEndpoint: '主动编辑时间；Quality Validation 通过率',
      status: 'deferred',
      note: '需要前瞻性受控试验。',
    },
  ],
  conditions: [
    { id: 'A0', method: '不预测（AI 初始设计）', pool: 'none', usesSimilarity: false, trains: false, implementation: 'not_applicable' },
    { id: 'P_pop', method: '按区域的历史平均（其他牙技师）', pool: 'other_technicians', usesSimilarity: false, trains: false, implementation: 'baseline_available' },
    { id: 'P_self', method: '按区域的历史平均（本人）', pool: 'same_technician', usesSimilarity: false, trains: false, implementation: 'baseline_available' },
    { id: 'G', method: '相似病例检索（其他牙技师）', pool: 'other_technicians', usesSimilarity: true, trains: false, implementation: 'baseline_available' },
    { id: 'M', method: '相似病例检索（本人）', pool: 'same_technician', usesSimilarity: true, trains: false, implementation: 'baseline_available' },
    { id: 'L', method: '个人学习', pool: 'same_technician', usesSimilarity: false, trains: true, implementation: 'not_implemented' },
  ],
  metrics: [
    { id: 'T1_region_f1', label: 'T1 区域 F1', unit: 'case', scope: '预测区域 vs Final GD 中有可测变化的区域' },
    { id: 'T2_local_change_mae_um', label: 'T2 局部变化误差（μm）', unit: 'case', scope: '仅 MATCHED 区域' },
  ],
  split: { by: 'patient', temporal: true },
  assignmentRule: {
    version: 'assign-one-technician-per-case-v1',
    description: '每个病例只分配给一位牙技师；不同牙技师不处理同一病例；同一牙技师不重复处理同一病例；不默认使用重复分配或拉丁方设计。',
    casesPerTechnician: 'to_be_confirmed',
  },
};
