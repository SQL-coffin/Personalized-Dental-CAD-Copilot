/**
 * Policy Gate (05 §10.1): deterministic checks before every step and every
 * model call. No model is consulted; the configuration is fixed by the
 * deployment and cannot be changed through any agent-facing API (I3).
 */
import { isGatePassed, type ApprovalRequest, type EgressCategory, type QualityGateResult, type RunMode, type ToolErrorCode, type VersionRef } from '@cadcopilot/contracts';
import { TIERS_BY_MODE, type EgressDeclaration, type ToolDefinition } from '@cadcopilot/agent-tools';

export interface PolicyConfig {
  mode: RunMode;
  policyVersion: string;
  gateCriteriaSetVersion: string;
  /** §10.6 categories this deployment may send outside the Runtime. */
  egressAllowed: readonly EgressCategory[];
}

export type PolicyDecision =
  | { verdict: 'allow' }
  | { verdict: 'needs_approval' }
  | { verdict: 'deny'; code: ToolErrorCode; message: string };

export interface CandidateFacts {
  candidateId: string;
  candidateHash: string;
  gate?: QualityGateResult;
  hasGeometry: boolean;
}

export interface StepCheck {
  toolId: string;
  definition: ToolDefinition | undefined;
  candidate?: CandidateFacts;
  /** An approved, unconsumed request for this step and candidate, if any. */
  approval?: ApprovalRequest;
  now: number;
}

const allow: PolicyDecision = { verdict: 'allow' };
const deny = (code: ToolErrorCode, message: string): PolicyDecision => ({ verdict: 'deny', code, message });

export class PolicyGate {
  constructor(readonly config: PolicyConfig) {}

  /** §6.3 PLANNING → RUNNING pre-check: every planned tool is registered in this mode. */
  precheckPlan(toolIds: readonly string[], isRegistered: (toolId: string) => boolean): PolicyDecision {
    const missing = toolIds.filter((id) => !isRegistered(id));
    return missing.length ? deny('NOT_REGISTERED', `计划包含未注册的工具：${missing.join('、')}`) : allow;
  }

  checkEgress(egress: EgressDeclaration, category?: EgressCategory): PolicyDecision {
    if (!egress.sendsOutside) return allow;
    const categories = category ? [category] : egress.categories;
    if (categories.length === 0) return deny('POLICY_DENIED', '外发未声明数据类别，拒绝（05 §10.6）');
    const blocked = categories.filter((c) => !this.config.egressAllowed.includes(c));
    return blocked.length ? deny('POLICY_DENIED', `部署不允许外发以下数据类别：${blocked.join('、')}（05 §10.6）`) : allow;
  }

  checkStep(check: StepCheck): PolicyDecision {
    const def = check.definition;
    if (!def) return deny('NOT_REGISTERED', `工具 ${check.toolId} 未在 ${this.config.mode} 模式下注册`);
    if (!TIERS_BY_MODE[this.config.mode].includes(def.tier)) return deny('POLICY_DENIED', `${def.tier} 级工具不允许在 ${this.config.mode} 模式运行`);
    const egress = this.checkEgress(def.egress);
    if (egress.verdict !== 'allow') return egress;

    const c = check.candidate;
    switch (def.role) {
      case 'quality_gate':
      case 'display_hint':
        return c ? allow : deny('INVALID_INPUT', '找不到要处理的候选');
      case 'display_candidate': {
        if (!c) return deny('INVALID_INPUT', '找不到要展示的候选');
        // I12: fail closed — missing, failed, not evaluated or not evaluable all block display.
        if (!isGatePassed(c.gate)) return deny('POLICY_DENIED', '质量闸门未通过：候选不能以可采纳形式展示（05 §10.7）');
        if (!c.hasGeometry) return deny('POLICY_DENIED', '候选没有可展示的逐点几何（依据区域不是 MATCHED）');
        return allow;
      }
      case 'cad_write': {
        if (!c) return deny('INVALID_INPUT', '找不到要写入的候选');
        // Never ask a human to approve something the gate would not let through.
        if (!isGatePassed(c.gate) || !c.hasGeometry) return deny('POLICY_DENIED', '候选未通过质量闸门，禁止写入 CAD（05 §10.7）');
        if (!check.approval) return { verdict: 'needs_approval' };
        return this.checkApproval(check.approval, c, check.now);
      }
      default:
        return allow;
    }
  }

  /** §10.3 invalidation conditions that can be checked without reading CAD. */
  checkApproval(approval: ApprovalRequest, candidate: CandidateFacts, now: number): PolicyDecision {
    if (approval.status !== 'approved' || !approval.record) return deny('POLICY_DENIED', `审批状态为 ${approval.status}，不能执行`);
    if (approval.expiresAt && Date.parse(approval.expiresAt) <= now) return deny('POLICY_DENIED', '审批已过期');
    if (approval.candidateHash !== candidate.candidateHash) return deny('POLICY_DENIED', '候选哈希与审批不一致，审批作废');
    if (approval.policyVersion !== this.config.policyVersion) return deny('POLICY_DENIED', '策略版本已变化，审批作废');
    if (approval.criteriaSetVersion !== this.config.gateCriteriaSetVersion) return deny('POLICY_DENIED', '闸门标准集版本已变化，审批作废');
    return allow;
  }

  /** §10.3 pre-execution check: the target is still at the approved base version. */
  checkBaseVersion(approval: ApprovalRequest, current: VersionRef): PolicyDecision {
    if (current.versionId !== approval.baseVersion.versionId || current.contentHash !== approval.baseVersion.contentHash) {
      return deny('BASE_VERSION_CHANGED', `目标对象版本已从 ${approval.baseVersion.versionId} 变为 ${current.versionId}（执行前核对不一致）`);
    }
    return allow;
  }
}
