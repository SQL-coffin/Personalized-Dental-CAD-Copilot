import type {
  ApprovalRequestStatus,
  BlockedReason,
  Correspondence,
  CoronalApical,
  HumanResponseKind,
  QualityResultValue,
  RunMode,
  SideEffects,
  StepState,
  TaskState,
  Tier,
  ToolErrorCode,
} from '@cadcopilot/contracts';

export type Tone = 'neutral' | 'active' | 'waiting' | 'success' | 'danger' | 'muted';

export const TASK_STATE_LABEL: Record<TaskState, string> = {
  CREATED: '已创建',
  PLANNING: '规划中',
  RUNNING: '执行中',
  VERIFYING: '验证中',
  RECORDING: '记录中',
  BLOCKED: '已暂停',
  DONE: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
};

export function taskTone(state: TaskState): Tone {
  switch (state) {
    case 'DONE':
      return 'success';
    case 'FAILED':
      return 'danger';
    case 'CANCELLED':
      return 'muted';
    case 'BLOCKED':
      return 'waiting';
    case 'CREATED':
      return 'neutral';
    default:
      return 'active';
  }
}

export const BLOCKED_REASON_LABEL: Record<BlockedReason, string> = {
  approval: '等待审批',
  human_feedback: '等待人工反馈',
  missing_evidence: '证据缺失',
  conflict: '存在未解决的冲突',
  budget: '预算耗尽',
  drift: '版本发生变化',
  in_doubt: '写入结果不明',
};

export const STEP_STATE_LABEL: Record<StepState, string> = {
  PROPOSED: '已提出',
  AWAITING_APPROVAL: '等待审批',
  AUTHORIZED: '已通过策略检查',
  INTENT_RECORDED: '已写意图记录',
  EXECUTING: '执行中',
  IN_DOUBT: '结果不明',
  SUCCEEDED: '已完成',
  POSTCONDITION_FAILED: '后置条件未通过',
  FAILED_NO_EFFECT: '失败（无副作用）',
  DENIED: '已拒绝',
};

export function stepStateTone(state: StepState): Tone {
  switch (state) {
    case 'SUCCEEDED':
      return 'success';
    case 'AWAITING_APPROVAL':
      return 'waiting';
    case 'IN_DOUBT':
    case 'POSTCONDITION_FAILED':
    case 'FAILED_NO_EFFECT':
    case 'DENIED':
      return 'danger';
    default:
      return 'active';
  }
}

export const TIER_LABEL: Record<Tier, string> = {
  R: '只读',
  S: '建议',
  E: '确认后执行',
};

export const MODE_LABEL: Record<RunMode, string> = {
  'offline-research': '离线研究',
  shadow: '影子运行（不展示）',
  assist: '辅助：只给建议',
  'assist-execute': '辅助：批准后执行',
};

export const SIDE_EFFECTS_LABEL: Record<SideEffects, string> = {
  none: '无副作用',
  writes_store: '写入记录存储',
  displays: '向牙技师展示',
  writes_cad: '写入 CAD',
};

export const CORRESPONDENCE_LABEL: Record<Correspondence, string> = {
  MATCHED: '已匹配',
  AMBIGUOUS: '对应不明确',
  UNMATCHED: '未匹配',
};

export const DIRECTION_LABEL: Record<CoronalApical, string> = {
  coronal: '向冠方',
  apical: '向龈方',
  uncertain: '方向不确定',
};

export const QUALITY_RESULT_LABEL: Record<QualityResultValue, string> = {
  pass: '通过',
  fail: '未通过',
  not_evaluated: '未评价',
};

export const ERROR_CODE_LABEL: Record<ToolErrorCode, string> = {
  INVALID_INPUT: '输入无效',
  POLICY_DENIED: '被策略拒绝',
  NEEDS_APPROVAL: '需要审批',
  BASE_VERSION_CHANGED: '基础版本已变化',
  DATA_UNAVAILABLE: '证据不可用',
  TIMEOUT: '超时',
  TOOL_ERROR: '工具错误',
  NOT_EXECUTED: '未执行',
  POSTCONDITION_FAILED: '后置条件未通过',
  NOT_REGISTERED: '工具未注册',
};

export const RESPONSE_LABEL: Record<HumanResponseKind, string> = {
  continue: '继续',
  replan: '改写计划',
  reconcile_applied: '我已在 CAD 中核对：写入已生效',
  reconcile_not_applied: '我已在 CAD 中核对：写入未生效',
};

export const APPROVAL_STATUS_LABEL: Record<ApprovalRequestStatus, string> = {
  pending: '等待决定',
  approved: '已批准，尚未执行',
  rejected: '已拒绝',
  consumed: '已批准并已用于执行',
  invalidated: '已作废',
  expired: '已过期',
  revoked: '已撤销',
};
