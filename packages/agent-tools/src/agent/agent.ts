/**
 * Agent ↔ Runtime boundary.
 *
 * An agent (05's Research Engine, or a scripted stand-in) proposes: plans,
 * tool calls with inputs, narration, decision records. The Runtime disposes:
 * it runs every call through the Policy Gate, asks for approvals, retries,
 * reconciles, blocks, and owns all task state. An agent holds nothing but an
 * AgentSession, so it has no path to change policy, budget, mode or approval
 * records (I3, I4).
 */
import type {
  CaseSummary,
  DecisionRecord,
  EvidenceRef,
  HumanResponseKind,
  QualityGateResult,
  RunMode,
  TaskOutcome,
  ToolErrorCode,
} from '@cadcopilot/contracts';
import type { CandidateProposal } from '../tools/io';

export interface AgentTaskContext {
  readonly taskId: string;
  readonly prompt: string;
  readonly mode: RunMode;
  /** The case, as the UI sees it; null for research tasks. */
  readonly caseSummary: CaseSummary | null;
  /** The case's assigned technician, on whose behalf the task runs. */
  readonly technicianId: string | null;
  /** Memory boundary: history must predate this instant (§8.3). */
  readonly asOf: string;
  readonly registeredToolIds: readonly string[];
}

export interface PlanStepSpec {
  key: string;
  title: string;
  purpose: string;
  toolId: string;
  maxAttempts?: number;
}

/**
 * Outcome of one plan step after the Runtime has applied every rule. On
 * anything but 'succeeded' the task is back in PLANNING (§6.3) and the agent
 * must write a new plan or finish.
 */
export type StepRunResult<O = unknown> =
  | { kind: 'succeeded'; output: O; candidateId?: string; reconciled?: boolean }
  /** Policy Gate refusal or a human rejection of an approval request. */
  | { kind: 'denied'; code: ToolErrorCode; message: string; humanDecision?: { decision: 'reject' | 'revise'; note?: string } }
  /** No effect and no retries left. */
  | { kind: 'failed'; code: ToolErrorCode; message: string }
  /** The Runtime blocked (e.g. missing evidence) and a human asked for a new plan. */
  | { kind: 'replan_requested'; note: string };

export interface HumanFeedbackRequest {
  summary: string;
  requiredAction: string;
  allowedResponses: Array<Extract<HumanResponseKind, 'continue' | 'replan'>>;
  stepId?: string;
}

export interface FeedbackOutcome {
  kind: HumanResponseKind;
  note?: string;
}

export interface CandidateInfo {
  candidateId: string;
  candidateHash: string;
  proposal: CandidateProposal;
  gate?: QualityGateResult;
  /** Gate passed (fail-closed) and pointwise geometry exists. */
  adoptable: boolean;
}

export type DecisionDraft = Omit<DecisionRecord, 'decisionId' | 'taskId' | 'caseId' | 'createdAt'>;

export interface AgentSession {
  readonly context: AgentTaskContext;
  /** Narration through the model provider; recorded, non-authoritative (§9.2). */
  say(text: string, refs?: EvidenceRef[]): Promise<void>;
  /** Simulated deliberation time; a recorded cancel takes effect here. */
  think(ms: number): Promise<void>;
  /** Enter PLANNING at the start (no-op when the Runtime already moved the task there). */
  beginPlanning(): Promise<void>;
  writePlan(steps: PlanStepSpec[], reason?: string): Record<string, string>;
  /** PLANNING → RUNNING after the Policy Gate's plan pre-check. */
  execute(): void;
  runStep<I, O>(stepId: string, input: I): Promise<StepRunResult<O>>;
  candidate(candidateId: string): CandidateInfo | undefined;
  recordDecision(draft: DecisionDraft): string;
  /** RUNNING → BLOCKED(human_feedback); resolves once a human responds, with the task in PLANNING. */
  requestHumanFeedback(request: HumanFeedbackRequest): Promise<FeedbackOutcome>;
  /** RUNNING → VERIFYING → RECORDING → DONE. */
  complete(outcome: TaskOutcome, verifyNote: string): Promise<void>;
}

export interface Agent {
  readonly agentId: string;
  readonly version: string;
  run(session: AgentSession): Promise<void>;
}
