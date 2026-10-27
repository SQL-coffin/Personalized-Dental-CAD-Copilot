/**
 * Simulated Agent Runtime for the frontend prototype.
 *
 * It is NOT an implementation of docs/05: there is no Policy Gate, no
 * persistence, no real tools. It replays scripted scenarios (scenarios.ts)
 * through the contract types, enforcing the §6 transition tables so the UI
 * is exercised against realistic sequences. Everything it emits is marked
 * simulated.
 */
import {
  RuntimeClientError,
  TERMINAL_TASK_STATES,
  type ApprovalChannel,
  type ApprovalDecision,
  type ApprovalDecisionInput,
  type ApprovalRequest,
  type BlockedReport,
  type Candidate,
  type CaseSummary,
  type ConversationMessage,
  type CreateTaskInput,
  type DecisionRecord,
  type DeploymentInfo,
  type EventEnvelope,
  type EventType,
  type EvidenceRef,
  type HumanFeedbackChannel,
  type HumanFeedbackInput,
  type HumanResponseKind,
  type Plan,
  type PlanStep,
  type Receipt,
  type RunMode,
  type RuntimeClient,
  type RuntimePorts,
  type StepState,
  type TaskOutcome,
  type TaskSnapshot,
  type TaskState,
  type TaskSummary,
  type TaskUpdate,
  type ToolCallAttempt,
  type ToolErrorCode,
  type ToolRef,
  type Unsubscribe,
} from '@cadcopilot/contracts';
import {
  SIM_CASES,
  SIM_GATE_SET_VERSION,
  SIM_IDENTITY,
  SIM_POLICY_VERSION,
  SIM_REGISTRATION_VERSION,
  registeredToolsFor,
  simHash,
} from './fixtures';
import { defaultScenarioFor, findScenario, type ScenarioDef, type ScenarioId } from './scenarios';
import { instantScheduler, type Scheduler } from './scheduler';
import { TransitionError, isStepTransitionAllowed, isTaskTransitionAllowed } from './transitions';

export interface MockRuntimeOptions {
  mode?: RunMode;
  scheduler?: Scheduler;
  /** Number of initial getDeployment() calls that fail, to exercise the error state. */
  failDeploymentTimes?: number;
  /** Called for scenario errors that are not cancellations (they are also kept in internalErrors). */
  onInternalError?: (error: Error) => void;
}

/** Thrown inside a scenario when a cancel request is applied. */
class CancelSignal extends Error {}

interface Waiter<T> {
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

export interface ApprovalOutcome {
  decision: ApprovalDecision;
  note?: string;
}

export interface FeedbackOutcome {
  kind: HumanResponseKind;
  note?: string;
}

export type AttemptOutcome = 'ok' | 'timeout' | 'data_unavailable' | 'policy_denied';
export type StepResult = 'succeeded' | 'failed_no_effect' | 'data_unavailable' | 'denied';

export interface StepSpec {
  key: string;
  title: string;
  purpose: string;
  tool: ToolRef;
  maxAttempts?: number;
}

export interface WriteBehavior {
  baseChanged?: boolean;
  inDoubt?: boolean;
}

const now = () => new Date().toISOString();

const TERMINAL_STEP_STATES: StepState[] = ['SUCCEEDED', 'POSTCONDITION_FAILED', 'FAILED_NO_EFFECT', 'DENIED'];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The API scenarios use to drive one simulated task. */
export class TaskRun {
  readonly snap: TaskSnapshot;
  readonly caseInfo: CaseSummary | null;
  cadWriteApplied = false;

  private pending: EventEnvelope[] = [];
  private lastHash = 'sim:genesis';
  private approvalWaiters = new Map<string, Waiter<ApprovalOutcome>>();
  private feedbackWaiter: Waiter<FeedbackOutcome> | null = null;
  private idCounter = 0;

  constructor(
    private readonly rt: MockRuntime,
    snap: TaskSnapshot,
    caseInfo: CaseSummary | null,
  ) {
    this.snap = snap;
    this.caseInfo = caseInfo;
  }

  get mode(): RunMode {
    return this.snap.mode;
  }

  hasTool(toolId: string): boolean {
    return this.rt.deployment.registeredTools.some((t) => t.toolId === toolId);
  }

  nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${this.snap.taskId.replace('task-', '')}-${this.idCounter}`;
  }

  // -- time --------------------------------------------------------------

  /** Interruptible: a recorded cancel request takes effect here. */
  async sleep(ms: number): Promise<void> {
    this.throwIfCancelled();
    await this.rt.scheduler.sleep(ms);
    this.throwIfCancelled();
  }

  /** Used inside side-effect critical sections, which a cancel must not interrupt. */
  async sleepUninterruptible(ms: number): Promise<void> {
    await this.rt.scheduler.sleep(ms);
  }

  private throwIfCancelled(): void {
    if (this.snap.cancelRequested) throw new CancelSignal();
  }

  // -- events ------------------------------------------------------------

  emit(
    type: EventType,
    opts: { stepId?: string; note?: string; actor?: EventEnvelope['actor']; payloadRef?: string } = {},
  ): EventEnvelope {
    const seq = this.rt.nextSeq();
    const body = {
      eventId: `evt-sim-${seq}`,
      seq,
      prevHash: this.lastHash,
      timestamp: now(),
      actor: opts.actor ?? { type: 'system' as const, id: 'mock-runtime', version: '0.1.0-sim' },
      taskId: this.snap.taskId,
      ...(opts.stepId ? { stepId: opts.stepId } : {}),
      type,
      ...(opts.payloadRef ? { payloadRef: opts.payloadRef } : {}),
      schemaVersion: 'event-sim-0.1',
      ...(opts.note ? { note: opts.note } : {}),
    };
    const event: EventEnvelope = { ...body, hash: simHash(JSON.stringify(body)) };
    this.lastHash = event.hash;
    this.snap.seq = seq;
    this.rt.appendEvent(event);
    this.pending.push(event);
    return event;
  }

  publish(): void {
    this.snap.updatedAt = now();
    const events = this.pending;
    this.pending = [];
    this.rt.notify(this.snap, events);
  }

  // -- conversation ------------------------------------------------------

  private message(role: ConversationMessage['role'], text: string, refs: EvidenceRef[] = []): void {
    this.snap.messages.push({ messageId: this.nextId('msg'), role, text, createdAt: now(), refs });
    this.emit('MessagePosted', {
      actor:
        role === 'user'
          ? { type: 'human', id: SIM_IDENTITY.userId }
          : role === 'agent'
            ? { type: 'agent', id: 'research-engine-sim', version: '0.1.0-sim' }
            : { type: 'system', id: 'mock-runtime' },
    });
    this.publish();
  }

  say(text: string, refs: EvidenceRef[] = []): void {
    this.message('agent', text, refs);
  }

  notice(text: string): void {
    this.message('system', text);
  }

  userMessage(text: string): void {
    this.message('user', text);
  }

  // -- task state --------------------------------------------------------

  toTask(to: TaskState, blocked?: Omit<BlockedReport, 'since'>): void {
    const from = this.snap.state;
    const fromReason = this.snap.blocked?.reason;
    if (!isTaskTransitionAllowed(from, to, { fromReason, toReason: blocked?.reason })) {
      throw new TransitionError(`task ${from}${fromReason ? `(${fromReason})` : ''} → ${to}${blocked ? `(${blocked.reason})` : ''}`);
    }
    if (to === 'PLANNING') {
      this.snap.budget.rounds.used += 1;
      if (from !== 'CREATED') this.snap.budget.replans.used += 1;
    }
    this.snap.state = to;
    if (to === 'BLOCKED' && blocked) {
      this.snap.blocked = { ...blocked, since: now() };
      this.emit('TaskBlocked', { note: `BLOCKED(${blocked.reason})`, ...(blocked.stepId ? { stepId: blocked.stepId } : {}) });
    } else {
      delete this.snap.blocked;
      this.emit('TaskStateChanged', {
        note: `${from}${fromReason ? `(${fromReason})` : ''} → ${to}`,
      });
    }
    if (TERMINAL_TASK_STATES.includes(to)) {
      this.emit('CheckpointCreated', { note: `terminal checkpoint @${this.snap.seq}` });
    }
    this.publish();
  }

  /** §6.3 replan, guarded by max_replans (§13). */
  async replan(sayText: string, refs: EvidenceRef[] = []): Promise<void> {
    const { used, limit } = this.snap.budget.replans;
    if (used >= limit) {
      await this.blockForever({
        reason: 'budget',
        summary: `重新规划次数已用完（${used}/${limit}）`,
        completed: this.completedSteps(),
        requiredAction: '需要有权限的人员在部署配置中追加预算，或取消任务。本界面不提供追加预算的操作。',
        allowedResponses: [],
      });
    }
    this.toTask('PLANNING');
    this.say(sayText, refs);
    await this.sleep(400);
  }

  // -- plans and steps ---------------------------------------------------

  writePlan(specs: StepSpec[], reason?: string): Record<string, string> {
    const version = this.snap.plans.length + 1;
    for (const p of this.snap.plans) p.status = 'superseded';
    const plan: Plan = {
      planId: `plan-${this.snap.taskId}-v${version}`,
      version,
      status: 'active',
      createdAt: now(),
      ...(reason ? { reason } : {}),
      steps: specs.map((s, i) => ({
        stepId: `p${version}-${s.key}`,
        index: i + 1,
        title: s.title,
        purpose: s.purpose,
        tool: s.tool,
        state: null,
        attempts: [],
        maxAttempts: s.maxAttempts ?? (s.tool.sideEffects === 'none' ? 3 : 1),
      })),
    };
    this.snap.plans.push(plan);
    this.emit('PlanWritten', { note: `plan v${version}（${plan.steps.length} 个步骤）${reason ? `：${reason}` : ''}` });
    this.publish();
    return Object.fromEntries(specs.map((s) => [s.key, `p${version}-${s.key}`]));
  }

  step(stepId: string): PlanStep {
    for (const plan of this.snap.plans) {
      const found = plan.steps.find((s) => s.stepId === stepId);
      if (found) return found;
    }
    throw new Error(`unknown step ${stepId}`);
  }

  completedSteps(): string[] {
    return this.snap.plans.flatMap((p) => p.steps.filter((s) => s.state === 'SUCCEEDED').map((s) => s.title));
  }

  setStep(
    step: PlanStep,
    to: StepState,
    patch: Partial<Omit<ToolCallAttempt, 'attempt' | 'state'>> & { newAttempt?: boolean } = {},
  ): void {
    if (!isStepTransitionAllowed(step.state, to)) {
      throw new TransitionError(`step ${step.stepId} ${step.state ?? 'NEW'} → ${to}`);
    }
    const from = step.state;
    const { newAttempt, ...attemptPatch } = patch;
    if (newAttempt) {
      step.attempts.push({ attempt: step.attempts.length + 1, state: to, startedAt: now() });
    }
    const current = step.attempts[step.attempts.length - 1];
    if (current) Object.assign(current, attemptPatch, { state: to });
    step.state = to;
    this.emit('StepStateChanged', { stepId: step.stepId, note: `${from ?? '—'} → ${to}` });
    this.publish();
  }

  private finishAttempt(step: PlanStep, to: StepState, extra: Partial<ToolCallAttempt> = {}): void {
    const current = step.attempts[step.attempts.length - 1];
    const durationMs = current?.startedAt ? Date.now() - Date.parse(current.startedAt) : undefined;
    this.setStep(step, to, { finishedAt: now(), ...(durationMs !== undefined ? { durationMs } : {}), ...extra });
    this.emit('ToolCallRecorded', {
      stepId: step.stepId,
      actor: { type: 'tool', id: step.tool.toolId, version: step.tool.version },
      note: `attempt ${current?.attempt ?? 1}: ${to}${extra.errorCode ? ` (${extra.errorCode})` : ''}`,
      payloadRef: extra.output?.ref ?? `toolcall:${step.stepId}:${current?.attempt ?? 1}`,
    });
    this.publish();
  }

  private ioRefs(step: PlanStep, attempt: number) {
    const input = `in:${step.stepId}:${attempt}`;
    return {
      input: { ref: `evidence://sim/${input}`, hash: simHash(input) },
      output: { ref: `evidence://sim/out:${step.stepId}:${attempt}`, hash: simHash(`out:${step.stepId}:${attempt}`) },
    };
  }

  private async chargeToolCall(): Promise<void> {
    const { used, limit } = this.snap.budget.toolCalls;
    if (used >= limit) {
      await this.blockForever({
        reason: 'budget',
        summary: `工具调用次数已用完（${used}/${limit}）`,
        completed: this.completedSteps(),
        requiredAction:
          '预算上限由部署配置给出（05 §13），模型和本界面都不能修改。需要有权限的人员追加预算，或取消任务。',
        allowedResponses: [],
      });
    }
    this.snap.budget.toolCalls.used += 1;
  }

  /** Runs one step through PROPOSED → … → terminal, one entry per attempt outcome. */
  async runStep(
    stepId: string,
    outcomes: AttemptOutcome[] = ['ok'],
    opts: { durationMs?: number; outputSummary?: string; errorMessage?: string } = {},
  ): Promise<StepResult> {
    const step = this.step(stepId);
    let result: StepResult = 'failed_no_effect';
    for (let i = 0; i < outcomes.length && step.attempts.length < step.maxAttempts; i += 1) {
      const outcome = outcomes[i]!;
      await this.chargeToolCall();
      this.setStep(step, 'PROPOSED', { newAttempt: true });
      await this.sleep(150);
      const io = this.ioRefs(step, step.attempts.length);
      if (outcome === 'policy_denied') {
        this.finishAttempt(step, 'DENIED', {
          errorCode: 'POLICY_DENIED',
          errorMessage: opts.errorMessage ?? 'Policy Gate 拒绝了该调用',
        });
        return 'denied';
      }
      this.setStep(step, 'AUTHORIZED', { input: io.input });
      if (step.tool.sideEffects !== 'none') this.setStep(step, 'INTENT_RECORDED');
      this.setStep(step, 'EXECUTING');
      await this.sleep(opts.durationMs ?? 500);
      if (outcome === 'ok') {
        this.finishAttempt(step, 'SUCCEEDED', {
          output: io.output,
          ...(opts.outputSummary ? { outputSummary: opts.outputSummary } : {}),
        });
        return 'succeeded';
      }
      const errorCode: ToolErrorCode = outcome === 'timeout' ? 'TIMEOUT' : 'DATA_UNAVAILABLE';
      this.finishAttempt(step, 'FAILED_NO_EFFECT', {
        errorCode,
        errorMessage:
          opts.errorMessage ??
          (outcome === 'timeout' ? '调用超时；该工具无副作用，可以在 max_attempts 内重试' : '引用的证据不存在或校验失败'),
      });
      result = outcome === 'timeout' ? 'failed_no_effect' : 'data_unavailable';
      if (outcome === 'data_unavailable') return result;
    }
    return result;
  }

  // -- candidates & ledger -----------------------------------------------

  addCandidate(candidate: Candidate): void {
    this.snap.candidates.push(candidate);
    this.emit('CandidateRecorded', { note: `${candidate.candidateId}（${candidate.presentation}）`, payloadRef: `record://sim/${candidate.candidateId}` });
    this.publish();
  }

  addDecision(decision: DecisionRecord): void {
    this.snap.decisions.push(decision);
    this.emit('DecisionRecorded', {
      actor: { type: 'agent', id: 'research-engine-sim', version: '0.1.0-sim' },
      note: decision.decisionId,
      payloadRef: `record://sim/${decision.decisionId}`,
    });
    this.publish();
  }

  // -- approvals ---------------------------------------------------------

  async requestApproval(stepId: string, candidate: Candidate): Promise<ApprovalOutcome> {
    const step = this.step(stepId);
    const c = this.caseInfo!;
    await this.chargeToolCall();
    this.setStep(step, 'PROPOSED', { newAttempt: true });
    await this.sleep(150);
    const request: ApprovalRequest = {
      approvalRequestId: this.nextId('apreq'),
      taskId: this.snap.taskId,
      stepId,
      candidateId: candidate.candidateId,
      candidateHash: candidate.candidateHash,
      target: { caseId: c.caseId, sessionId: `sess-sim-${c.caseId.slice(-4)}`, object: 'margin_line', tooth: c.tooth },
      baseVersion: candidate.baseVersion,
      provenance: { ...candidate.provenance, executor: { id: step.tool.toolId, version: step.tool.version } },
      qualityGateRef: candidate.quality.gateRef,
      criteriaSetVersion: candidate.quality.criteriaSetVersion,
      policyVersion: SIM_POLICY_VERSION,
      requestedAt: now(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      status: 'pending',
    };
    this.snap.approvalRequests.push(request);
    step.approvalRequestId = request.approvalRequestId;
    this.setStep(step, 'AWAITING_APPROVAL');
    this.emit('ApprovalRequested', { stepId, note: request.approvalRequestId });
    this.toTask('BLOCKED', {
      reason: 'approval',
      summary: `写入 CAD 前需要你对候选 ${candidate.candidateId} 的明确批准`,
      completed: this.completedSteps(),
      requiredAction: '在「审阅与审批」中批准、拒绝或要求修改此候选。对话中的文字不构成审批。',
      allowedResponses: [],
      stepId,
    });
    return new Promise<ApprovalOutcome>((resolve, reject) => {
      this.approvalWaiters.set(request.approvalRequestId, { resolve, reject });
    });
  }

  findApproval(approvalRequestId: string): ApprovalRequest | undefined {
    return this.snap.approvalRequests.find((r) => r.approvalRequestId === approvalRequestId);
  }

  /** Called by the approval channel once the decision is recorded. */
  resolveApproval(approvalRequestId: string, outcome: ApprovalOutcome): void {
    this.approvalWaiters.get(approvalRequestId)?.resolve(outcome);
    this.approvalWaiters.delete(approvalRequestId);
  }

  /** After a reject / revise decision: the step ends DENIED and the task resumes to replan. */
  denyAfterDecision(stepId: string, decision: 'reject' | 'revise'): void {
    this.toTask('RUNNING');
    this.setStep(this.step(stepId), 'DENIED', {
      finishedAt: now(),
      errorMessage: decision === 'reject' ? '牙技师拒绝了该候选' : '牙技师要求修改方案',
    });
  }

  async executeApproved(stepId: string, request: ApprovalRequest, behavior: WriteBehavior = {}): Promise<'succeeded' | 'in_doubt' | 'base_changed'> {
    const step = this.step(stepId);
    this.toTask('RUNNING');
    this.setStep(step, 'AUTHORIZED', this.ioRefs(step, step.attempts.length));
    this.notice('执行前核对：读取目标对象及其依赖对象的当前版本，与审批绑定的基础版本比较。');
    await this.sleep(400);
    if (behavior.baseChanged) {
      request.status = 'invalidated';
      request.invalidationReason = `目标对象版本已从 ${request.baseVersion.versionId} 变为 ${bumpVersion(request.baseVersion.versionId)}（执行前核对不一致）`;
      this.emit('ApprovalInvalidated', { stepId, note: request.approvalRequestId });
      this.finishAttempt(step, 'DENIED', {
        errorCode: 'BASE_VERSION_CHANGED',
        errorMessage: request.invalidationReason,
      });
      if (this.caseInfo) this.caseInfo.currentVersion = { versionId: bumpVersion(request.baseVersion.versionId), contentHash: simHash(`${request.baseVersion.versionId}+1`) };
      return 'base_changed';
    }
    this.setStep(step, 'INTENT_RECORDED');
    request.status = 'consumed';
    this.emit('ApprovalRecorded', { stepId, note: `${request.approvalRequestId} consumed（一次性审批已消耗）` });
    this.setStep(step, 'EXECUTING');
    await this.sleepUninterruptible(700);
    if (behavior.inDoubt) {
      this.finishAttempt(step, 'IN_DOUBT', {
        errorCode: 'TIMEOUT',
        errorMessage: '写入请求超时，无法确定是否已生效。查清之前不会重试，也不会判定失败（05 §7.3）。',
      });
      this.notice('对账：读取 CAD 当前版本并与意图记录比较……');
      await this.sleepUninterruptible(500);
      this.notice('对账无法判断写入是否生效（模拟：CAD 返回的版本信息不完整）。需要人工确认。');
      return 'in_doubt';
    }
    this.cadWriteApplied = true;
    if (this.caseInfo) {
      this.caseInfo.currentVersion = { versionId: bumpVersion(request.baseVersion.versionId), contentHash: simHash(request.candidateHash) };
    }
    this.finishAttempt(step, 'SUCCEEDED', {
      outputSummary: `条件写入成功；新版本 ${this.caseInfo?.currentVersion.versionId ?? '?'}；写后读取一致`,
    });
    return 'succeeded';
  }

  /** Human reconciliation of an IN_DOUBT write (§7.3, §6.4 in_doubt). */
  resolveInDoubt(stepId: string, applied: boolean): void {
    const step = this.step(stepId);
    if (applied) {
      this.cadWriteApplied = true;
      this.setStep(step, 'SUCCEEDED', { reconciled: true, outputSummary: '经人工对账确认已生效' });
    } else {
      this.setStep(step, 'FAILED_NO_EFFECT', { reconciled: true, outputSummary: '经人工对账确认未生效' });
    }
    this.toTask('RUNNING');
  }

  // -- blocking ----------------------------------------------------------

  /** Enter BLOCKED and wait for an allowed human response (or cancel). */
  block(report: Omit<BlockedReport, 'since'>): Promise<FeedbackOutcome> {
    this.toTask('BLOCKED', report);
    return new Promise<FeedbackOutcome>((resolve, reject) => {
      this.feedbackWaiter = { resolve, reject };
    });
  }

  /** A block with no human response that the Runtime accepts; only cancel ends it. */
  async blockForever(report: Omit<BlockedReport, 'since'>): Promise<never> {
    await this.block({ ...report, allowedResponses: [] });
    throw new Error('unreachable: no response is accepted for this block');
  }

  resolveFeedback(outcome: FeedbackOutcome): void {
    this.feedbackWaiter?.resolve(outcome);
    this.feedbackWaiter = null;
  }

  // -- completion --------------------------------------------------------

  async complete(opts: { verify: string; outcome: TaskOutcome }): Promise<void> {
    // §6.3: RUNNING → VERIFYING only once every step of the plan is terminal.
    const active = this.snap.plans.find((p) => p.status === 'active');
    const open = active?.steps.filter((s) => !s.state || !TERMINAL_STEP_STATES.includes(s.state)) ?? [];
    if (open.length > 0) throw new TransitionError(`RUNNING → VERIFYING with open steps: ${open.map((s) => s.stepId).join(', ')}`);
    this.toTask('VERIFYING');
    this.notice(opts.verify);
    await this.sleep(400);
    this.toTask('RECORDING');
    await this.sleep(300);
    this.snap.outcome = opts.outcome;
    this.toTask('DONE');
    this.say(opts.outcome.summary);
  }

  // -- cancellation ------------------------------------------------------

  requestCancel(reason?: string): void {
    this.snap.cancelRequested = true;
    this.emit('CancelRequested', { actor: { type: 'human', id: SIM_IDENTITY.userId }, ...(reason ? { note: reason } : {}) });
    this.publish();
  }

  /** Wake any waiter so the scenario unwinds; called once a cancel request is recorded. */
  interruptWaiters(): void {
    const signal = new CancelSignal();
    for (const w of this.approvalWaiters.values()) w.reject(signal);
    this.approvalWaiters.clear();
    this.feedbackWaiter?.reject(signal);
    this.feedbackWaiter = null;
  }

  applyCancel(): void {
    for (const r of this.snap.approvalRequests) {
      if (r.status === 'pending') {
        r.status = 'invalidated';
        r.invalidationReason = '任务已取消';
        this.emit('ApprovalInvalidated', { stepId: r.stepId, note: r.approvalRequestId });
      }
    }
    const inDoubt = this.snap.plans.some((p) => p.steps.some((s) => s.state === 'IN_DOUBT'));
    const cadWrite: TaskOutcome['cadWrite'] = this.cadWriteApplied ? 'applied' : inDoubt ? 'unknown' : 'none';
    this.snap.outcome = {
      summary:
        cadWrite === 'applied'
          ? '任务已取消。取消前已完成的 CAD 写入不会被撤销；如需回滚，回滚本身是需要新审批的 E 级动作。'
          : cadWrite === 'unknown'
            ? '任务已取消。有一次写入结果不明，取消不会改变这一点：请在 CAD 中核对当前设计。'
            : '任务已取消。未写入 CAD；尚未完成的步骤不会再执行。',
      cadWrite,
    };
    delete this.snap.cancelRequested;
    this.toTask('CANCELLED');
  }

  isCancelSignal(err: unknown): boolean {
    return err instanceof CancelSignal;
  }
}

function bumpVersion(versionId: string): string {
  const m = /^v(\d+)$/.exec(versionId);
  return m ? `v${Number(m[1]) + 1}` : `${versionId}+1`;
}

export class MockRuntime {
  readonly scheduler: Scheduler;
  readonly deployment: DeploymentInfo;
  /** Errors thrown by a scenario that were not cancellations; tests assert this stays empty. */
  readonly internalErrors: Error[] = [];

  private runs = new Map<string, TaskRun>();
  private events = new Map<string, EventEnvelope[]>();
  private listeners = new Map<string, Set<(u: TaskUpdate) => void>>();
  private listListeners = new Set<(tasks: TaskSummary[]) => void>();
  private cases: CaseSummary[] = clone(SIM_CASES);
  private seq = 0;
  private taskCounter = 0;
  private receiptCounter = 0;
  private failDeploymentTimes: number;
  private nextScenario: ScenarioDef;
  private decisionsInFlight = new Set<string>();
  private readonly onInternalError: ((error: Error) => void) | undefined;

  constructor(opts: MockRuntimeOptions = {}) {
    const mode = opts.mode ?? 'assist-execute';
    this.onInternalError = opts.onInternalError;
    this.scheduler = opts.scheduler ?? instantScheduler;
    this.failDeploymentTimes = opts.failDeploymentTimes ?? 0;
    this.nextScenario = defaultScenarioFor(mode);
    this.deployment = {
      deploymentId: `deploy-sim-${mode}`,
      mode,
      simulated: true,
      cadConnected: false,
      policyVersion: SIM_POLICY_VERSION,
      gateCriteriaSetVersion: SIM_GATE_SET_VERSION,
      registeredTools: registeredToolsFor(mode),
      capabilities: {
        cancelTask: true,
        humanFeedback: true,
        approvals: mode === 'assist-execute',
        // 06 §1: research tasks never read case data.
        caseSelection: mode !== 'offline-research',
        caseRecords: false,
      },
      identity: SIM_IDENTITY,
      integrations: [],
    };
  }

  // -- prototype-only controls -------------------------------------------

  get scenarioId(): ScenarioId {
    return this.nextScenario.id;
  }

  setNextScenario(id: ScenarioId): void {
    const scenario = findScenario(id);
    if (!scenario.modes.includes(this.deployment.mode)) {
      throw new RuntimeClientError('INVALID_REQUEST', `场景 ${id} 不适用于 ${this.deployment.mode} 模式`);
    }
    this.nextScenario = scenario;
  }

  /** Separate objects per port, so UI code holding one cannot reach the others. */
  ports(): RuntimePorts {
    const runtime: RuntimeClient = {
      getDeployment: () => this.getDeployment(),
      listCases: () => this.listCases(),
      listTasks: () => this.listTasks(),
      getTask: (id) => this.getTask(id),
      listEvents: (id) => this.listEvents(id),
      createTask: (input) => this.createTask(input),
      postMessage: (id, text) => this.postMessage(id, text),
      cancelTask: (id, reason) => this.cancelTask(id, reason),
      subscribe: (id, l) => this.subscribe(id, l),
      subscribeTaskList: (l) => this.subscribeTaskList(l),
    };
    const approvals: ApprovalChannel = { submitDecision: (input) => this.submitDecision(input) };
    const feedback: HumanFeedbackChannel = { submit: (input) => this.submitFeedback(input) };
    return {
      runtime,
      approvals: this.deployment.capabilities.approvals ? approvals : null,
      feedback: this.deployment.capabilities.humanFeedback ? feedback : null,
      records: null,
    };
  }

  // -- internals used by TaskRun -----------------------------------------

  nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  appendEvent(event: EventEnvelope): void {
    const list = this.events.get(event.taskId) ?? [];
    list.push(event);
    this.events.set(event.taskId, list);
  }

  notify(snapshot: TaskSnapshot, events: EventEnvelope[]): void {
    const update: TaskUpdate = { snapshot: clone(snapshot), events: clone(events) };
    for (const l of this.listeners.get(snapshot.taskId) ?? []) l(update);
    const summaries = this.summaries();
    for (const l of this.listListeners) l(summaries);
  }

  private receipt(): Receipt {
    this.receiptCounter += 1;
    return { receiptId: `rcpt-sim-${this.receiptCounter}`, receivedAt: now() };
  }

  private run(taskId: string): TaskRun {
    const run = this.runs.get(taskId);
    if (!run) throw new RuntimeClientError('NOT_FOUND', `任务 ${taskId} 不存在`);
    return run;
  }

  private summaries(): TaskSummary[] {
    return [...this.runs.values()]
      .map(({ snap }) => ({
        taskId: snap.taskId,
        title: snap.title,
        caseId: snap.caseId,
        state: snap.state,
        ...(snap.blocked ? { blockedReason: snap.blocked.reason } : {}),
        updatedAt: snap.updatedAt,
      }))
      .reverse();
  }

  // -- RuntimeClient -----------------------------------------------------

  async getDeployment(): Promise<DeploymentInfo> {
    await this.scheduler.sleep(300);
    if (this.failDeploymentTimes > 0) {
      this.failDeploymentTimes -= 1;
      throw new RuntimeClientError('UNAVAILABLE', '无法连接 Agent Runtime（模拟故障）', true);
    }
    return clone(this.deployment);
  }

  async listCases(): Promise<CaseSummary[]> {
    return this.deployment.capabilities.caseSelection ? clone(this.cases) : [];
  }

  async listTasks(): Promise<TaskSummary[]> {
    return this.summaries();
  }

  async getTask(taskId: string): Promise<TaskSnapshot> {
    return clone(this.run(taskId).snap);
  }

  async listEvents(taskId: string): Promise<EventEnvelope[]> {
    this.run(taskId);
    return clone(this.events.get(taskId) ?? []);
  }

  async createTask(input: CreateTaskInput): Promise<TaskSnapshot> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new RuntimeClientError('INVALID_REQUEST', '任务描述不能为空');
    let caseInfo: CaseSummary | null = null;
    if (this.deployment.capabilities.caseSelection) {
      if (!input.caseId) throw new RuntimeClientError('INVALID_REQUEST', '请选择一个病例');
      caseInfo = this.cases.find((c) => c.caseId === input.caseId) ?? null;
      if (!caseInfo) throw new RuntimeClientError('NOT_FOUND', `病例 ${input.caseId} 不存在`);
    } else if (input.caseId) {
      throw new RuntimeClientError('INVALID_REQUEST', '当前模式的任务不能关联病例数据');
    }
    this.taskCounter += 1;
    const taskId = `task-sim-${String(this.taskCounter).padStart(3, '0')}`;
    const scenario = this.nextScenario;
    const snap: TaskSnapshot = {
      taskId,
      title: prompt.length > 28 ? `${prompt.slice(0, 28)}…` : prompt,
      prompt,
      caseId: caseInfo?.caseId ?? null,
      mode: this.deployment.mode,
      state: 'CREATED',
      createdAt: now(),
      updatedAt: now(),
      seq: 0,
      plans: [],
      messages: [],
      candidates: [],
      decisions: [],
      approvalRequests: [],
      modelCalls: [],
      budget: {
        rounds: { used: 0, limit: 6 },
        replans: { used: 0, limit: 4 },
        toolCalls: { used: 0, limit: scenario.toolCallLimit ?? 40 },
      },
      versions: {
        policy: SIM_POLICY_VERSION,
        gateCriteriaSet: SIM_GATE_SET_VERSION,
        registration: SIM_REGISTRATION_VERSION,
        models: ['research-engine-sim@0.1.0（脚本，非模型）'],
      },
      simulated: true,
    };
    const run = new TaskRun(this, snap, caseInfo);
    this.runs.set(taskId, run);
    run.emit('TaskCreated', { actor: { type: 'human', id: SIM_IDENTITY.userId }, note: `scenario=${scenario.id}` });
    run.userMessage(prompt);
    void this.start(run, scenario);
    return clone(snap);
  }

  private async start(run: TaskRun, scenario: ScenarioDef): Promise<void> {
    await this.scheduler.sleep(0);
    try {
      await scenario.run(run);
    } catch (err) {
      if (run.isCancelSignal(err)) {
        run.applyCancel();
        return;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      this.internalErrors.push(error);
      this.onInternalError?.(error);
    }
  }

  async postMessage(taskId: string, text: string): Promise<Receipt> {
    const run = this.run(taskId);
    if (!text.trim()) throw new RuntimeClientError('INVALID_REQUEST', '消息不能为空');
    if (TERMINAL_TASK_STATES.includes(run.snap.state)) {
      throw new RuntimeClientError('CONFLICT', '任务已结束，不能再发送消息');
    }
    run.userMessage(text.trim());
    const receipt = this.receipt();
    void this.scheduler.sleep(300).then(() => {
      run.say(
        '已收到。你的消息会作为对话上下文保存，但不会改变任务、权限、预算或审批状态。需要批准或拒绝时，请使用「审阅与审批」面板；需要恢复被阻塞的任务时，请使用阻塞提示中的操作。',
      );
    });
    return receipt;
  }

  async cancelTask(taskId: string, reason?: string): Promise<Receipt> {
    const run = this.run(taskId);
    if (TERMINAL_TASK_STATES.includes(run.snap.state)) {
      throw new RuntimeClientError('CONFLICT', '任务已处于终止状态，不能取消');
    }
    if (run.snap.cancelRequested) throw new RuntimeClientError('CONFLICT', '取消请求已在处理中');
    run.requestCancel(reason);
    const receipt = this.receipt();
    // A blocked scenario is waiting on a human; wake it so the cancel is applied.
    if (run.snap.state === 'BLOCKED') run.interruptWaiters();
    return receipt;
  }

  subscribe(taskId: string, listener: (u: TaskUpdate) => void): Unsubscribe {
    const set = this.listeners.get(taskId) ?? new Set();
    set.add(listener);
    this.listeners.set(taskId, set);
    return () => set.delete(listener);
  }

  subscribeTaskList(listener: (tasks: TaskSummary[]) => void): Unsubscribe {
    this.listListeners.add(listener);
    return () => this.listListeners.delete(listener);
  }

  // -- ApprovalChannel ---------------------------------------------------

  async submitDecision(input: ApprovalDecisionInput): Promise<Receipt> {
    const run = [...this.runs.values()].find((r) => r.findApproval(input.approvalRequestId));
    const request = run?.findApproval(input.approvalRequestId);
    if (!run || !request) throw new RuntimeClientError('NOT_FOUND', '审批请求不存在');
    if (request.status !== 'pending' || this.decisionsInFlight.has(request.approvalRequestId)) {
      throw new RuntimeClientError('CONFLICT', '该审批请求已不再等待决定');
    }
    if (input.candidateHash !== request.candidateHash || input.baseVersionId !== request.baseVersion.versionId) {
      throw new RuntimeClientError('CONFLICT', '候选或基础版本与审批请求不一致，请刷新后重试');
    }
    if (input.decision === 'revise' && !input.note?.trim()) {
      throw new RuntimeClientError('INVALID_REQUEST', '要求修改方案时必须说明修改意见');
    }
    if (input.decision === 'approve' && !this.deployment.identity.authenticated && !this.deployment.simulated) {
      throw new RuntimeClientError('UNAUTHENTICATED', '审批需要经过身份验证的牙技师');
    }
    this.decisionsInFlight.add(request.approvalRequestId);
    const receipt = this.receipt();
    void this.scheduler.sleep(300).then(() => {
      this.decisionsInFlight.delete(request.approvalRequestId);
      if (request.status !== 'pending') return; // cancelled meanwhile
      const note = input.note?.trim();
      request.status = input.decision === 'approve' ? 'approved' : 'rejected';
      request.record = {
        approvalId: `apr-${request.approvalRequestId.slice('apreq-'.length)}`,
        approver: this.deployment.identity,
        decision: input.decision === 'approve' ? 'approve' : 'reject',
        ...(note ? { note } : {}),
        decidedAt: now(),
        uses: 1,
        ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
      };
      run.emit('ApprovalRecorded', {
        stepId: request.stepId,
        actor: { type: 'human', id: this.deployment.identity.userId },
        note: `${request.record.approvalId}: ${input.decision}`,
      });
      run.notice(
        input.decision === 'approve'
          ? `审批记录 ${request.record.approvalId} 已写入审批存储（模拟）。审批只授权这一次写入，不代表放行最终设计。`
          : input.decision === 'revise'
            ? `已记录：拒绝候选 ${request.candidateId}，并附修改意见。`
            : `已记录：拒绝候选 ${request.candidateId}。被拒绝的建议会单独存档。`,
      );
      run.resolveApproval(request.approvalRequestId, { decision: input.decision, ...(note ? { note } : {}) });
    });
    return receipt;
  }

  // -- HumanFeedbackChannel ----------------------------------------------

  async submitFeedback(input: HumanFeedbackInput): Promise<Receipt> {
    const run = this.run(input.taskId);
    const blocked = run.snap.blocked;
    if (run.snap.state !== 'BLOCKED' || !blocked || blocked.reason !== input.blockedReason) {
      throw new RuntimeClientError('CONFLICT', '任务当前不处于该阻塞状态');
    }
    if (!blocked.allowedResponses.includes(input.kind)) {
      throw new RuntimeClientError('INVALID_REQUEST', '当前阻塞状态不接受这种回应');
    }
    if (input.kind === 'replan' && !input.note?.trim()) {
      throw new RuntimeClientError('INVALID_REQUEST', '改写计划时必须说明要求');
    }
    const receipt = this.receipt();
    void this.scheduler.sleep(300).then(() => {
      const note = input.note?.trim();
      run.emit('HumanFeedbackRecorded', {
        actor: { type: 'human', id: this.deployment.identity.userId },
        note: `${input.blockedReason}: ${input.kind}`,
      });
      run.notice(`已记录人工回应（${input.kind}）${note ? `：「${note}」` : ''}。`);
      run.resolveFeedback({ kind: input.kind, ...(note ? { note } : {}) });
    });
    return receipt;
  }
}
