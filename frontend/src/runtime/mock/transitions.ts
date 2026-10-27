/**
 * Transition tables copied from docs/05 §6.3 (task) and §6.5 (step).
 *
 * Used only by the mock runtime so that simulated flows cannot demonstrate a
 * transition the contract forbids. A real Runtime enforces its own tables;
 * the UI never consults these.
 */
import type { BlockedReason, StepState, TaskState } from '../contract';

const ACTIVE: TaskState[] = ['PLANNING', 'RUNNING', 'VERIFYING', 'RECORDING'];

export function isTaskTransitionAllowed(
  from: TaskState,
  to: TaskState,
  ctx: { fromReason?: BlockedReason; toReason?: BlockedReason } = {},
): boolean {
  if (to === 'CANCELLED') return from !== 'DONE' && from !== 'FAILED' && from !== 'CANCELLED';

  if (to === 'BLOCKED') {
    const r = ctx.toReason;
    if (!r) return false;
    // "任何活动状态 → BLOCKED(missing_evidence / conflict / budget / drift)"
    if (['missing_evidence', 'conflict', 'budget', 'drift'].includes(r)) return ACTIVE.includes(from);
    if (r === 'approval' || r === 'in_doubt') return from === 'RUNNING';
    // RECORDING → BLOCKED(human_feedback) per §6.3; RUNNING → BLOCKED(human_feedback)
    // per §7.3 (repeated POLICY_DENIED, side-effect postcondition failure) and 06 §3.
    if (r === 'human_feedback') return from === 'RECORDING' || from === 'RUNNING';
    return false;
  }

  if (from === 'BLOCKED') {
    const r = ctx.fromReason;
    if (r === 'approval' || r === 'in_doubt') return to === 'RUNNING';
    return to === 'PLANNING';
  }

  const table: Partial<Record<TaskState, TaskState[]>> = {
    CREATED: ['PLANNING'],
    PLANNING: ['RUNNING'],
    RUNNING: ['RUNNING', 'VERIFYING', 'PLANNING'],
    VERIFYING: ['RECORDING', 'PLANNING', 'FAILED'],
    RECORDING: ['PLANNING', 'DONE'],
  };
  return table[from]?.includes(to) ?? false;
}

const STEP_TABLE: Record<StepState | 'NEW', StepState[]> = {
  NEW: ['PROPOSED'],
  PROPOSED: ['DENIED', 'AWAITING_APPROVAL', 'AUTHORIZED'],
  AWAITING_APPROVAL: ['AUTHORIZED', 'DENIED'],
  // AUTHORIZED → DENIED: E-tier base version check failed (§6.5 diagram).
  AUTHORIZED: ['EXECUTING', 'INTENT_RECORDED', 'DENIED'],
  INTENT_RECORDED: ['EXECUTING'],
  EXECUTING: ['SUCCEEDED', 'POSTCONDITION_FAILED', 'FAILED_NO_EFFECT', 'IN_DOUBT'],
  IN_DOUBT: ['SUCCEEDED', 'POSTCONDITION_FAILED', 'FAILED_NO_EFFECT'],
  // New attempt within max_attempts.
  FAILED_NO_EFFECT: ['PROPOSED'],
  SUCCEEDED: [],
  POSTCONDITION_FAILED: [],
  DENIED: [],
};

export function isStepTransitionAllowed(from: StepState | null, to: StepState): boolean {
  return STEP_TABLE[from ?? 'NEW'].includes(to);
}

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}
