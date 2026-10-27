/**
 * UI ↔ Agent Runtime contract: ports.
 *
 * Three separate interfaces on purpose:
 *  - RuntimeClient: reads, task creation, conversation, cancellation.
 *  - ApprovalChannel: the §10.3 approval channel, independent of the model
 *    conversation (I4). Nothing sent through RuntimeClient.postMessage can
 *    produce an approval.
 *  - HumanFeedbackChannel: §6.4 human responses bound to a task and the
 *    reason it is blocked.
 *
 * A channel is null when the deployment does not offer it; the UI then hides
 * the corresponding controls instead of showing a control that cannot work.
 */
import type {
  ApprovalDecision,
  BlockedReason,
  CaseSummary,
  DeploymentInfo,
  EventEnvelope,
  HumanResponseKind,
  TaskSnapshot,
  TaskSummary,
} from './types';

export interface TaskUpdate {
  snapshot: TaskSnapshot;
  /** Events appended since the previous update, in seq order. */
  events: EventEnvelope[];
}

export type Unsubscribe = () => void;

/**
 * Acknowledgement that a request was received. It is NOT the outcome: the
 * authoritative result only appears in a later TaskSnapshot.
 */
export interface Receipt {
  receiptId: string;
  receivedAt: string;
}

export interface CreateTaskInput {
  prompt: string;
  caseId: string | null;
}

export interface RuntimeClient {
  getDeployment(): Promise<DeploymentInfo>;
  listCases(): Promise<CaseSummary[]>;
  listTasks(): Promise<TaskSummary[]>;
  getTask(taskId: string): Promise<TaskSnapshot>;
  listEvents(taskId: string): Promise<EventEnvelope[]>;
  createTask(input: CreateTaskInput): Promise<TaskSnapshot>;
  /** Conversation only. Carries no authority over task, policy or approvals (I4, I11). */
  postMessage(taskId: string, text: string): Promise<Receipt>;
  /** §6.3 human cancellation; takes effect when a later snapshot shows CANCELLED. */
  cancelTask(taskId: string, reason?: string): Promise<Receipt>;
  subscribe(taskId: string, listener: (update: TaskUpdate) => void): Unsubscribe;
  /** Fires when the task list changes (new task, state change). */
  subscribeTaskList(listener: (tasks: TaskSummary[]) => void): Unsubscribe;
}

export interface ApprovalDecisionInput {
  approvalRequestId: string;
  /** Echoed back so the Runtime can reject a decision made on stale data (§10.3). */
  candidateHash: string;
  baseVersionId: string;
  decision: ApprovalDecision;
  /** Required for 'revise'; optional for 'reject'; recorded as Evidence (04 §3). */
  note?: string;
}

export interface ApprovalChannel {
  submitDecision(input: ApprovalDecisionInput): Promise<Receipt>;
}

export interface HumanFeedbackInput {
  taskId: string;
  /** Must match the task's current block; a stale response is refused. */
  blockedReason: BlockedReason;
  kind: HumanResponseKind;
  note?: string;
}

export interface HumanFeedbackChannel {
  submit(input: HumanFeedbackInput): Promise<Receipt>;
}

export interface RuntimePorts {
  runtime: RuntimeClient;
  approvals: ApprovalChannel | null;
  feedback: HumanFeedbackChannel | null;
}
