import type { ApprovalRequest, Candidate, DeploymentInfo, TaskSnapshot } from '../../runtime/contract';
import { APPROVAL_STATUS_LABEL } from './labels';
import { candidateView } from './quality';

export interface ApprovalAvailability {
  canDecide: boolean;
  /** Why a decision cannot be made right now. */
  reasons: string[];
}

/**
 * Whether the approve / reject / revise controls may be used. Every check is
 * conjunctive; the Runtime repeats its own checks when the decision arrives.
 */
export function approvalAvailability(args: {
  request: ApprovalRequest;
  candidate: Candidate | undefined;
  task: TaskSnapshot;
  deployment: DeploymentInfo;
  hasChannel: boolean;
  now?: number;
}): ApprovalAvailability {
  const { request, candidate, task, deployment, hasChannel } = args;
  const now = args.now ?? Date.now();
  const reasons: string[] = [];

  if (!hasChannel || !deployment.capabilities.approvals) reasons.push('当前部署没有审批通道');
  if (deployment.mode !== 'assist-execute') reasons.push('当前运行模式不允许写入 CAD');
  const step = task.plans.flatMap((p) => p.steps).find((s) => s.stepId === request.stepId);
  const registered = step && deployment.registeredTools.some((t) => t.toolId === step.tool.toolId && t.tier === 'E');
  if (!registered) reasons.push('写入工具未在当前部署中注册');
  if (request.status !== 'pending') reasons.push(`审批请求状态：${APPROVAL_STATUS_LABEL[request.status]}`);
  if (request.expiresAt && Date.parse(request.expiresAt) <= now) reasons.push('审批请求已过期');
  if (task.state !== 'BLOCKED' || task.blocked?.reason !== 'approval') reasons.push('任务当前不在等待审批');
  if (task.cancelRequested) reasons.push('任务正在取消');
  if (!candidate) reasons.push('找不到审批请求对应的候选');
  else {
    if (candidate.candidateHash !== request.candidateHash) reasons.push('候选与审批请求不一致');
    if (candidate.baseVersion.versionId !== request.baseVersion.versionId) reasons.push('候选的基础版本与审批请求不一致');
    if (!candidateView(candidate).adoptable) reasons.push('候选未通过质量闸门');
  }
  if (!deployment.identity.authenticated && !deployment.simulated) reasons.push('审批需要经过身份验证的牙技师');

  return { canDecide: reasons.length === 0, reasons };
}
