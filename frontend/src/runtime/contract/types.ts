/**
 * UI ↔ Agent Runtime contract: data shapes.
 *
 * Derived from docs/05-agent-runtime-spec.md v0.2 (PR #3, branch
 * claude/sharp-hawking-4p3e5y) and docs/02-data-specification.md. Section
 * references (§) point to 05 unless noted. Enumerations that 05 defines are
 * copied verbatim; shapes 05 leaves open are marked "frontend proposal" and
 * must be confirmed when the real Runtime API is designed.
 *
 * This module contains types only. No runtime behaviour lives here.
 */

// ---------------------------------------------------------------------------
// Deployment (§4, §10.1, §10.2)
// ---------------------------------------------------------------------------

/** §4. Chosen by deployment config; neither the model nor the UI can switch it. */
export type RunMode = 'offline-research' | 'shadow' | 'assist' | 'assist-execute';

/** 04 §2 permission tiers. */
export type Tier = 'R' | 'S' | 'E';

/** §7.1 `kind`. */
export type ToolKind = 'geometry' | 'data' | 'predictor' | 'llm' | 'adapter' | 'io' | 'research';

/** §7.1 `side_effects`. */
export type SideEffects = 'none' | 'writes_store' | 'displays' | 'writes_cad';

/** Subset of §7.1 registration info that the UI needs to explain a step. */
export interface ToolRef {
  toolId: string;
  version: string;
  kind: ToolKind;
  tier: Tier;
  sideEffects: SideEffects;
  deterministic: boolean;
  idempotent: boolean;
}

export interface Identity {
  userId: string;
  displayName: string;
  /** I4 / §10.3: approvals must come from an authenticated human. */
  authenticated: boolean;
}

/**
 * Which interactive features the connected Runtime actually offers. The UI
 * renders a control only when the matching capability is true, so it never
 * exposes an action the backend cannot perform. (frontend proposal)
 */
export interface RuntimeCapabilities {
  /** §6.3 "任何非终止状态 → CANCELLED（人工取消）". */
  cancelTask: boolean;
  /** §6.4 human responses that unblock a task (feedback, replan, reconcile). */
  humanFeedback: boolean;
  /** §10.3 approval channel; only meaningful when an E-tier tool is registered. */
  approvals: boolean;
  /** Selecting an existing pseudonymised case from the Record Store. */
  caseSelection: boolean;
}

export interface DeploymentInfo {
  deploymentId: string;
  mode: RunMode;
  /** True for the mock adapter and any synthetic test deployment (§14). */
  simulated: boolean;
  /** Whether a real CAD adapter is connected. */
  cadConnected: boolean;
  policyVersion: string;
  /** §10.7 registered gate criteria set. */
  gateCriteriaSetVersion: string;
  /** §4: tools not allowed in this mode are not registered at all. */
  registeredTools: ToolRef[];
  capabilities: RuntimeCapabilities;
  identity: Identity;
}

// ---------------------------------------------------------------------------
// Cases (02 §1, §6.5)
// ---------------------------------------------------------------------------

/** 02 §6.5 capture levels. */
export type CaptureLevel = 'C0' | 'C1' | 'C2' | 'C3';

/**
 * A pseudonymised case the user may attach to a task. Patient identity never
 * reaches the UI (04 §1.2); only pseudonymous IDs do.
 */
export interface CaseSummary {
  caseId: string;
  patientPseudonym: string;
  restoration: string;
  /** FDI tooth number. */
  tooth: string;
  designObject: 'margin_line';
  currentVersion: VersionRef;
  captureLevel: CaptureLevel;
  /** Synthetic fixture rather than real (pseudonymised) patient data. */
  synthetic: boolean;
}

export interface VersionRef {
  versionId: string;
  contentHash: string;
}

// ---------------------------------------------------------------------------
// Task and step state (§6)
// ---------------------------------------------------------------------------

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

export const TERMINAL_TASK_STATES: readonly TaskState[] = ['DONE', 'FAILED', 'CANCELLED'];

/** §6.4 */
export type BlockedReason =
  | 'approval'
  | 'human_feedback'
  | 'missing_evidence'
  | 'conflict'
  | 'budget'
  | 'drift'
  | 'in_doubt';

/** §6.5. Note: there is no step-level "cancelled"; see ui/presenters for display. */
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

/** §7.3 error codes the Runtime reports for a step attempt. */
export type ToolErrorCode =
  | 'INVALID_INPUT'
  | 'POLICY_DENIED'
  | 'NEEDS_APPROVAL'
  | 'BASE_VERSION_CHANGED'
  | 'DATA_UNAVAILABLE'
  | 'TIMEOUT'
  | 'TOOL_ERROR'
  | 'NOT_EXECUTED'
  | 'POSTCONDITION_FAILED'
  | 'NOT_REGISTERED';

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

/** §5.1 content-addressed reference. */
export interface ContentRef {
  ref: string;
  hash: string;
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

// ---------------------------------------------------------------------------
// Candidates, preference and quality (§10.7, 01 §5, 02 §9, §12.1)
// ---------------------------------------------------------------------------

/** 02 §9 */
export type Correspondence = 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED';

/** 02 §10.4: direction is decided by the reference axis, may be uncertain. */
export type CoronalApical = 'coronal' | 'apical' | 'uncertain';

export interface RegionDisplacement {
  direction: CoronalApical;
  maxUm: number;
  meanUm: number;
}

export interface CandidateRegion {
  regionId: string;
  label: string;
  /** 02 §6.3 normalised arc length on S_0, [t1, t2]. */
  t: [number, number];
  correspondence: Correspondence;
  /** Only present for MATCHED regions (01 §5 rule 3). */
  displacement?: RegionDisplacement;
}

/** 01 §5 Preference: Personal Preference Score with uncertainty. Never merged with quality (I5). */
export interface PreferenceEstimate {
  score: number;
  interval: [number, number];
  basis: string;
  predictor: { id: string; version: string };
}

/** 02 §12.1 */
export type EvaluationValidity = 'evaluable' | 'not_evaluable';
export type QualityResultValue = 'pass' | 'fail' | 'not_evaluated';

export interface GateCriterionResult {
  criterionId: string;
  label: string;
  evaluationValidity: EvaluationValidity;
  qualityResult: QualityResultValue;
  detail?: string;
}

/** §10.7 runtime quality gate outcome for one candidate. */
export interface QualityGateResult {
  gateRef: string;
  criteriaSetVersion: string;
  /** Every criterion in the registered set; a missing result counts as not passed. */
  requiredCriteria: string[];
  results: GateCriterionResult[];
  /** Runtime's verdict. The UI re-checks it fail-closed (ui/presenters/quality). */
  passed: boolean;
  evaluatedAt: string;
}

export interface Provenance {
  predictor: { id: string; version: string };
  geometryEngine: { id: string; version: string };
  executor?: { id: string; version: string };
  paramsHash: string;
}

export interface DisplacementSample {
  t: number;
  /** Lateral component d·b in μm; + coronal, − apical (02 §10). */
  lateralUm: number;
}

/** Candidate geometry; the Runtime only releases it for gate-passed candidates. */
export interface CandidateGeometry {
  kind: 'margin_line_displacement';
  frameVersion: string;
  samples: DisplacementSample[];
}

export interface Candidate {
  candidateId: string;
  candidateHash: string;
  caseId: string;
  object: 'margin_line';
  baseVersion: VersionRef & { scope: string[] };
  provenance: Provenance;
  regions: CandidateRegion[];
  preference: PreferenceEstimate;
  quality: QualityGateResult;
  /** Runtime's display classification (§10.7 table). */
  presentation: 'adoptable' | 'diagnostic';
  /** Absent unless presentation is 'adoptable'. */
  geometry?: CandidateGeometry;
  /** Region-level hint shown when no adoptable geometry is available. */
  hint?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Decision Ledger (§11)
// ---------------------------------------------------------------------------

export interface EvidenceRef {
  ref: string;
  label: string;
  stance?: 'supports' | 'opposes';
}

export interface DecisionRecord {
  decisionId: string;
  taskId: string;
  caseId: string | null;
  observations: EvidenceRef[];
  hypothesis: string;
  evidence: EvidenceRef[];
  alternatives: { label: string; whyNot: string }[];
  candidateId?: string;
  /** Rationale summary; each claim should cite a record (§11). Not evidence itself. */
  rationale: string;
  uncertainty: string;
  /** "无法可靠判断" is a first-class outcome (README principles, §11). */
  outcome: string;
  unableToJudge: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Approvals (§10.3)
// ---------------------------------------------------------------------------

export type ApprovalRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'consumed'
  | 'invalidated'
  | 'expired'
  | 'revoked';

export interface ApprovalRecord {
  approvalId: string;
  approver: Identity;
  decision: 'approve' | 'reject';
  note?: string;
  decidedAt: string;
  /** E tier: always 1 (§10.3). */
  uses: 1;
  expiresAt?: string;
}

/** An approval the Runtime is waiting for; mirrors the §10.3 approval scope. */
export interface ApprovalRequest {
  approvalRequestId: string;
  taskId: string;
  stepId: string;
  candidateId: string;
  candidateHash: string;
  target: { caseId: string; sessionId: string; object: 'margin_line'; tooth: string };
  baseVersion: VersionRef & { scope: string[] };
  provenance: Provenance;
  qualityGateRef: string;
  criteriaSetVersion: string;
  policyVersion: string;
  requestedAt: string;
  expiresAt?: string;
  status: ApprovalRequestStatus;
  invalidationReason?: string;
  record?: ApprovalRecord;
}

// ---------------------------------------------------------------------------
// Conversation (§9.2, I4, I11)
// ---------------------------------------------------------------------------

/**
 * Conversation text is data, never authority: "已批准" typed into chat does not
 * create an approval (I4, AT-08).
 */
export interface ConversationMessage {
  messageId: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  createdAt: string;
  /** Agent statements without refs are shown as 未核实 (§9.2). */
  refs: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Budget, versions, outcome (§13, §9.3)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Events (§5.1)
// ---------------------------------------------------------------------------

/** Event type names are a frontend proposal; 05 does not enumerate them yet. */
export type EventType =
  | 'TaskCreated'
  | 'TaskStateChanged'
  | 'PlanWritten'
  | 'StepStateChanged'
  | 'ToolCallRecorded'
  | 'CandidateRecorded'
  | 'DecisionRecorded'
  | 'ApprovalRequested'
  | 'ApprovalRecorded'
  | 'ApprovalInvalidated'
  | 'HumanFeedbackRecorded'
  | 'TaskBlocked'
  | 'CancelRequested'
  | 'MessagePosted'
  | 'CheckpointCreated';

/** §5.1 event envelope. Events never embed patient data; payloads are refs. */
export interface EventEnvelope {
  eventId: string;
  seq: number;
  prevHash: string;
  hash: string;
  timestamp: string;
  actor: { type: 'human' | 'agent' | 'tool' | 'system' | 'evaluation'; id: string; version?: string };
  taskId: string;
  stepId?: string;
  type: EventType;
  payloadRef?: string;
  schemaVersion: string;
  /** Short non-patient description for the diagnostics view. */
  note?: string;
}

// ---------------------------------------------------------------------------
// Task snapshot
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Human responses (§6.4, §10.3)
// ---------------------------------------------------------------------------

/**
 * Human responses that resolve a BLOCKED task (§6.4 解除条件). The Runtime
 * lists which ones it accepts in BlockedReport.allowedResponses.
 */
export type HumanResponseKind =
  /** Continue after an out-of-band human action (e.g. verification, drift review). */
  | 'continue'
  /** Return to PLANNING with a human-written instruction. */
  | 'replan'
  /** In-doubt step: human checked CAD and confirms the write took effect. */
  | 'reconcile_applied'
  /** In-doubt step: human checked CAD and confirms the write did not take effect. */
  | 'reconcile_not_applied';

export type ApprovalDecision = 'approve' | 'reject' | 'revise';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type RuntimeClientErrorCode =
  | 'UNAVAILABLE'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_REQUEST';

/** Transport / request-level error raised by a RuntimeClient implementation. */
export class RuntimeClientError extends Error {
  readonly code: RuntimeClientErrorCode;
  readonly retryable: boolean;

  constructor(code: RuntimeClientErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'RuntimeClientError';
    this.code = code;
    this.retryable = retryable;
  }
}
