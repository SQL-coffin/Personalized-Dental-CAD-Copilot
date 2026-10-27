/** Task and step state (§6), budget (§13), versions (§9.3) and the task snapshot. */
import type { ApprovalRequest } from './approvals';
import type { Candidate } from './candidates';
import type { ToolRef } from './deployment';
import type { ToolErrorCode } from './errors';
import type { ConversationMessage, HumanResponseKind } from './interaction';
import type { DecisionRecord } from './ledger';
import type { RunMode } from './vocabulary';

/** §6.2 */
export type TaskState =
  | 'CREATED'
  | 'PLANNING'
  | 'RUNNING'
  | 'VERIFYING'
  | 'RECORDING'
  | 'BLOCKED'
  | 'DONE'
  | 'FAILED'
  | 'CANCELLED';

/** §6.4 */
export type BlockedReason =
  | 'approval'
  | 'human_feedback'
  | 'missing_evidence'
  | 'conflict'
  | 'budget'
  | 'drift'
  | 'in_doubt';

/** §6.5. Note: there is no step-level "cancelled". */
export type StepState =
  | 'PROPOSED'
  | 'AWAITING_APPROVAL'
  | 'AUTHORIZED'
  | 'INTENT_RECORDED'
  | 'EXECUTING'
  | 'IN_DOUBT'
  | 'SUCCEEDED'
  | 'POSTCONDITION_FAILED'
  | 'FAILED_NO_EFFECT'
  | 'DENIED';

/** §5.1 content-addressed reference. */
export interface ContentRef {
  ref: string;
  hash: string;
}

/** §7.2 step 7 ToolCall record (one per attempt). */
export interface ToolCallAttempt {
  attempt: number;
  state: StepState;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  input?: ContentRef;
  output?: ContentRef;
  errorCode?: ToolErrorCode;
  errorMessage?: string;
  /** Short non-patient description of the output, e.g. a status field. */
  outputSummary?: string;
  /** §7.3: result established by reconciliation rather than a direct reply. */
  reconciled?: boolean;
}

export interface PlanStep {
  stepId: string;
  index: number;
  title: string;
  purpose: string;
  tool: ToolRef;
  /** null = written in the plan but not yet proposed (not started). */
  state: StepState | null;
  attempts: ToolCallAttempt[];
  maxAttempts: number;
  approvalRequestId?: string;
}

export interface Plan {
  planId: string;
  version: number;
  /** A new plan version supersedes the remaining steps of the previous one. */
  status: 'active' | 'superseded';
  createdAt: string;
  /** Why the plan was (re)written, e.g. after a DENIED step (§6.3). */
  reason?: string;
  steps: PlanStep[];
}

/** §6.4 "每次进入 BLOCKED 时生成简短报告：原因、已完成的内容、需要谁做什么". */
export interface BlockedReport {
  reason: BlockedReason;
  since: string;
  summary: string;
  completed: string[];
  requiredAction: string;
  /** Which human responses the Runtime will accept for this block. */
  allowedResponses: HumanResponseKind[];
  /** Step that caused the block, if any. */
  stepId?: string;
}

export interface BudgetStatus {
  rounds: { used: number; limit: number };
  replans: { used: number; limit: number };
  toolCalls: { used: number; limit: number };
}

export interface VersionInfo {
  policy: string;
  gateCriteriaSet: string;
  registration: string;
  models: string[];
}

export interface TaskOutcome {
  summary: string;
  /** What was actually written to CAD, if anything. */
  cadWrite: 'none' | 'applied' | 'unknown';
}

/** §7.4 record of one model call, summarised for diagnostics. */
export interface ModelCallSummary {
  callId: string;
  purpose: string;
  providerId: string;
  modelId: string;
  modelVersion: string;
  systemPromptVersion: string;
  inputHash: string;
  outputHash: string;
  /** True when no model was called (scripted provider). */
  simulated: boolean;
  at: string;
}

/**
 * The Runtime's projection of one task's event log (§6.1). The UI renders it
 * and never re-derives task state on its own.
 */
export interface TaskSnapshot {
  taskId: string;
  title: string;
  prompt: string;
  caseId: string | null;
  mode: RunMode;
  state: TaskState;
  blocked?: BlockedReport;
  /** Set while a cancel request is recorded but not yet applied. */
  cancelRequested?: boolean;
  createdAt: string;
  updatedAt: string;
  seq: number;
  plans: Plan[];
  messages: ConversationMessage[];
  candidates: Candidate[];
  decisions: DecisionRecord[];
  approvalRequests: ApprovalRequest[];
  modelCalls: ModelCallSummary[];
  budget: BudgetStatus;
  versions: VersionInfo;
  outcome?: TaskOutcome;
  simulated: boolean;
}

export interface TaskSummary {
  taskId: string;
  title: string;
  caseId: string | null;
  state: TaskState;
  blockedReason?: BlockedReason;
  updatedAt: string;
}
