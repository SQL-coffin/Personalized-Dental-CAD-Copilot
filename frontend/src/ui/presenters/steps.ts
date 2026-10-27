import type { Plan, PlanStep, TaskSnapshot } from '../../runtime/contract';
import { STEP_STATE_LABEL, stepStateTone, type Tone } from './labels';

export interface StepDisplay {
  label: string;
  tone: Tone;
}

const TERMINAL = new Set(['SUCCEEDED', 'POSTCONDITION_FAILED', 'FAILED_NO_EFFECT', 'DENIED']);

/**
 * How a step reads in the timeline. The contract has no step-level
 * "cancelled"; a step that never finished in a cancelled task or superseded
 * plan is shown as not run rather than relabelled.
 */
export function stepDisplay(step: PlanStep, plan: Plan, task: Pick<TaskSnapshot, 'state'>): StepDisplay {
  if (step.state === null) {
    if (plan.status === 'superseded') return { label: '未执行（计划已修订）', tone: 'muted' };
    if (task.state === 'CANCELLED') return { label: '未执行（任务已取消）', tone: 'muted' };
    if (task.state === 'FAILED') return { label: '未执行', tone: 'muted' };
    return { label: '待执行', tone: 'neutral' };
  }
  if (step.state === 'IN_DOUBT') {
    // Never hide an in-doubt side effect, whatever happened to the task.
    return { label: STEP_STATE_LABEL.IN_DOUBT, tone: 'danger' };
  }
  if (!TERMINAL.has(step.state)) {
    if (task.state === 'CANCELLED') return { label: '未完成（任务已取消）', tone: 'muted' };
    if (plan.status === 'superseded') return { label: '未完成（计划已修订）', tone: 'muted' };
  }
  if (step.state === 'FAILED_NO_EFFECT' && step.attempts.length < step.maxAttempts && task.state === 'RUNNING') {
    return { label: '失败（无副作用），可重试', tone: 'waiting' };
  }
  return { label: STEP_STATE_LABEL[step.state], tone: stepStateTone(step.state) };
}

export function activePlan(task: Pick<TaskSnapshot, 'plans'>): Plan | undefined {
  return task.plans.find((p) => p.status === 'active');
}

export function planProgress(plan: Plan): { done: number; total: number } {
  return { done: plan.steps.filter((s) => s.state === 'SUCCEEDED').length, total: plan.steps.length };
}
