/**
 * TaskRun: the single owner of one task's state.
 *
 * Every change goes through a transition check (§6.3, §6.5), is appended to
 * the hash-chained event log (§5.1), and is published as a fresh snapshot
 * projection (§6.1). Agents never see this class; they act through
 * AgentSession, which delegates here after the Policy Gate.
 */
import {
  TERMINAL_STEP_STATES,
  TERMINAL_TASK_STATES,
  isGatePassed,
  stableHash,
  type ApprovalDecision,
  type ApprovalRequest,
  type BlockedReport,
  type Candidate,
  type CaseSummary,
  type ConversationMessage,
  type EventEnvelope,
  type EventType,
  type EvidenceRef,
  type Identity,
  type Plan,
  type PlanStep,
  type QualityGateResult,
  type StepState,
  type TaskOutcome,
  type TaskSnapshot,
  type TaskState,
  type ToolCallAttempt,
  type ToolRef,
} from '@cadcopilot/contracts';
import type { CandidateInfo, CandidateProposal, DecisionDraft, FeedbackOutcome, ModelCallRecord, ToolDefinition } from '@cadcopilot/agent-tools';
import { CancelSignal } from './errors';
import type { Scheduler } from './scheduler';
import { TransitionError, isStepTransitionAllowed, isTaskTransitionAllowed } from './transitions';

export interface ApprovalOutcome {
  decision: ApprovalDecision;
  note?: string;
}

export interface TaskRunDeps {
  scheduler: Scheduler;
  nextSeq(): number;
  appendEvent(event: EventEnvelope): void;
  notify(snapshot: TaskSnapshot, events: EventEnvelope[]): void;
  /** The signed-in human, recorded as actor of human events. */
  identity: Identity;
  agentActor: { id: string; version: string };
  policyVersion: string;
  gateCriteriaSetVersion: string;
  requiredCriteria: readonly string[];
}

export interface PlannedStepSpec {
  key: string;
  title: string;
  purpose: string;
  tool: ToolRef;
  maxAttempts?: number;
}

interface CandidateEntry {
  candidateId: string;
  candidateHash: string;
  proposal: CandidateProposal;
  gate?: QualityGateResult;
  createdAt: string;
}

interface Waiter<T> {
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

const now = () => new Date().toISOString();

export class TaskRun {
  readonly snap: TaskSnapshot;
  readonly caseSummary: CaseSummary | null;
  readonly technicianId: string | null;
  readonly sessionId: string | null;
  cadWriteApplied = false;

  private pending: EventEnvelope[] = [];
  private lastHash = 'sim:genesis';
  private idCounter = 0;
  private candidates = new Map<string, CandidateEntry>();
  private approvalWaiters = new Map<string, Waiter<ApprovalOutcome>>();
  private feedbackWaiter: Waiter<FeedbackOutcome> | null = null;

  constructor(
    private readonly deps: TaskRunDeps,
    snap: TaskSnapshot,
    context: { caseSummary: CaseSummary | null; technicianId: string | null; sessionId: string | null },
  ) {
    this.snap = snap;
    this.caseSummary = context.caseSummary;
    this.technicianId = context.technicianId;
    this.sessionId = context.sessionId;
  }

  nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${this.snap.taskId.replace('task-', '')}-${this.idCounter}`;
  }

  // -- time --------------------------------------------------------------

  /** Interruptible: a recorded cancel request takes effect here. */
  async sleep(ms: number): Promise<void> {
    this.throwIfCancelled();
    await this.deps.scheduler.sleep(ms);
    this.throwIfCancelled();
  }

  /** Inside side-effect critical sections, which a cancel must not interrupt. */
  async sleepUninterruptible(ms: number): Promise<void> {
    await this.deps.scheduler.sleep(ms);
  }

  throwIfCancelled(): void {
    if (this.snap.cancelRequested) throw new CancelSignal();
  }

  // -- events ------------------------------------------------------------

  emit(type: EventType, opts: { stepId?: string; note?: string; actor?: EventEnvelope['actor']; payloadRef?: string } = {}): EventEnvelope {
    const seq = this.deps.nextSeq();
    const body = {
      eventId: `evt-${seq}`,
      seq,
      prevHash: this.lastHash,
      timestamp: now(),
      actor: opts.actor ?? { type: 'system' as const, id: 'runtime', version: '0.2.0' },
      taskId: this.snap.taskId,
      ...(opts.stepId ? { stepId: opts.stepId } : {}),
      type,
      ...(opts.payloadRef ? { payloadRef: opts.payloadRef } : {}),
      schemaVersion: 'event-0.2',
      ...(opts.note ? { note: opts.note } : {}),
    };
    const event: EventEnvelope = { ...body, hash: stableHash(JSON.stringify(body)) };
    this.lastHash = event.hash;
    this.snap.seq = seq;
    this.deps.appendEvent(event);
    this.pending.push(event);
    return event;
  }

  publish(): void {
    this.snap.updatedAt = now();
    const events = this.pending;
    this.pending = [];
    this.deps.notify(this.snap, events);
  }

  private humanActor(): EventEnvelope['actor'] {
    return { type: 'human', id: this.deps.identity.userId };
  }

  // -- conversation ------------------------------------------------------

  private message(role: ConversationMessage['role'], text: string, refs: EvidenceRef[] = []): void {
    this.snap.messages.push({ messageId: this.nextId('msg'), role, text, createdAt: now(), refs });
    this.emit('MessagePosted', {
      actor:
        role === 'user'
          ? this.humanActor()
          : role === 'agent'
            ? { type: 'agent', id: this.deps.agentActor.id, version: this.deps.agentActor.version }
            : { type: 'system', id: 'runtime' },
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

  recordModelCall(record: ModelCallRecord): void {
    this.snap.modelCalls.push({
      callId: record.callId,
      purpose: record.purpose,
      providerId: record.providerId,
      modelId: record.modelId,
      modelVersion: record.modelVersion,
      systemPromptVersion: record.systemPromptVersion,
      inputHash: record.inputHash,
      outputHash: record.outputHash,
      simulated: record.simulated,
      at: record.finishedAt,
    });
    this.emit('ModelCallRecorded', {
      actor: { type: 'tool', id: record.providerId, version: record.modelVersion },
      note: `${record.purpose}: ${record.modelId}${record.simulated ? '（脚本，未调用模型）' : ''}`,
      payloadRef: record.outputRef,
    });
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
      this.emit('TaskStateChanged', { note: `${from}${fromReason ? `(${fromReason})` : ''} → ${to}` });
    }
    if (TERMINAL_TASK_STATES.includes(to)) this.emit('CheckpointCreated', { note: `terminal checkpoint @${this.snap.seq}` });
    this.publish();
  }

  /** Back to PLANNING after a denial, failure or human request (§6.3), within max_replans (§13). */
  async enterPlanning(): Promise<void> {
    if (this.snap.state === 'PLANNING') return;
    const { used, limit } = this.snap.budget.replans;
    if (used >= limit) {
      await this.blockForever({
        reason: 'budget',
        summary: `重新规划次数已用完（${used}/${limit}）`,
        completed: this.completedSteps(),
        requiredAction: '预算上限由部署配置给出（05 §13），模型和本界面都不能修改。需要有权限的人员追加预算，或取消任务。',
        allowedResponses: [],
      });
    }
    this.toTask('PLANNING');
  }

  // -- plans and steps ---------------------------------------------------

  writePlan(specs: PlannedStepSpec[], reason?: string): Record<string, string> {
    if (this.snap.state !== 'PLANNING') throw new TransitionError(`plan can only be written in PLANNING (task is ${this.snap.state})`);
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

  activePlan(): Plan | undefined {
    return this.snap.plans.find((p) => p.status === 'active');
  }

  step(stepId: string): PlanStep {
    for (const plan of this.snap.plans) {
      const found = plan.steps.find((s) => s.stepId === stepId);
      if (found) return found;
    }
    throw new TransitionError(`unknown step ${stepId}`);
  }

  completedSteps(): string[] {
    return this.snap.plans.flatMap((p) => p.steps.filter((s) => s.state === 'SUCCEEDED').map((s) => s.title));
  }

  setStep(step: PlanStep, to: StepState, patch: Partial<Omit<ToolCallAttempt, 'attempt' | 'state'>> & { newAttempt?: boolean } = {}): void {
    if (!isStepTransitionAllowed(step.state, to)) throw new TransitionError(`step ${step.stepId} ${step.state ?? 'NEW'} → ${to}`);
    const from = step.state;
    const { newAttempt, ...attemptPatch } = patch;
    if (newAttempt) step.attempts.push({ attempt: step.attempts.length + 1, state: to, startedAt: now() });
    const current = step.attempts[step.attempts.length - 1];
    if (current) Object.assign(current, attemptPatch, { state: to });
    step.state = to;
    this.emit('StepStateChanged', { stepId: step.stepId, note: `${from ?? '—'} → ${to}` });
    this.publish();
  }

  /** Terminal (or in-doubt) state of an attempt plus its §7.2 ToolCall record. */
  finishAttempt(step: PlanStep, to: StepState, extra: Partial<ToolCallAttempt> = {}): void {
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

  ioRefs(step: PlanStep, input: unknown) {
    const attempt = step.attempts.length;
    const inputText = JSON.stringify(input ?? null);
    return {
      input: { ref: `evidence://${this.snap.taskId}/${step.stepId}/${attempt}/in`, hash: stableHash(inputText) },
      outputRef: (output: unknown) => ({
        ref: `evidence://${this.snap.taskId}/${step.stepId}/${attempt}/out`,
        hash: stableHash(JSON.stringify(output ?? null)),
      }),
    };
  }

  async chargeToolCall(): Promise<void> {
    const { used, limit } = this.snap.budget.toolCalls;
    if (used >= limit) {
      await this.blockForever({
        reason: 'budget',
        summary: `工具调用次数已用完（${used}/${limit}）`,
        completed: this.completedSteps(),
        requiredAction: '预算上限由部署配置给出（05 §13），模型和本界面都不能修改。需要有权限的人员追加预算，或取消任务。',
        allowedResponses: [],
      });
    }
    this.snap.budget.toolCalls.used += 1;
  }

  // -- candidates (05 §5.3: only from registered candidate sources) --------

  registerCandidate(proposal: CandidateProposal): string {
    const candidateId = this.nextId('cand');
    const candidateHash = stableHash(JSON.stringify({ base: proposal.baseVersion, geometry: proposal.geometry, params: proposal.provenance.paramsHash }));
    this.candidates.set(candidateId, { candidateId, candidateHash, proposal, createdAt: now() });
    this.emit('CandidateRecorded', { note: `${candidateId}（已登记，未展示）`, payloadRef: `record://${this.snap.taskId}/${candidateId}` });
    this.publish();
    return candidateId;
  }

  attachGate(candidateId: string, gate: QualityGateResult): void {
    const entry = this.candidates.get(candidateId);
    if (!entry) throw new TransitionError(`unknown candidate ${candidateId}`);
    entry.gate = gate;
  }

  candidateEntry(candidateId: string): CandidateEntry | undefined {
    return this.candidates.get(candidateId);
  }

  candidateInfo(candidateId: string): CandidateInfo | undefined {
    const e = this.candidates.get(candidateId);
    if (!e) return undefined;
    return {
      candidateId: e.candidateId,
      candidateHash: e.candidateHash,
      proposal: e.proposal,
      ...(e.gate ? { gate: e.gate } : {}),
      adoptable: isGatePassed(e.gate) && !!e.proposal.geometry,
    };
  }

  /** §10.7: diagnostic releases never carry geometry or pointwise displacement. */
  releaseCandidate(candidateId: string, presentation: 'adoptable' | 'diagnostic', hint?: string): void {
    const e = this.candidates.get(candidateId);
    if (!e) throw new TransitionError(`unknown candidate ${candidateId}`);
    if (presentation === 'adoptable' && (!isGatePassed(e.gate) || !e.proposal.geometry)) {
      throw new TransitionError(`candidate ${candidateId} cannot be released as adoptable`);
    }
    const quality: QualityGateResult = e.gate ?? {
      gateRef: 'gate://none',
      criteriaSetVersion: this.deps.gateCriteriaSetVersion,
      requiredCriteria: [...this.deps.requiredCriteria],
      results: [],
      passed: false,
      evaluatedAt: now(),
    };
    const released: Candidate = {
      candidateId: e.candidateId,
      candidateHash: e.candidateHash,
      caseId: e.proposal.caseId,
      object: 'margin_line',
      baseVersion: e.proposal.baseVersion,
      provenance: e.proposal.provenance,
      regions:
        presentation === 'adoptable'
          ? e.proposal.regions
          : e.proposal.regions.map(({ displacement: _hidden, ...region }) => region),
      preference: e.proposal.preference,
      quality,
      presentation,
      ...(presentation === 'adoptable' && e.proposal.geometry ? { geometry: e.proposal.geometry } : {}),
      ...(hint ? { hint } : {}),
      createdAt: e.createdAt,
    };
    this.snap.candidates = [...this.snap.candidates.filter((c) => c.candidateId !== candidateId), released];
    this.emit('CandidateRecorded', { note: `${candidateId}（${presentation === 'adoptable' ? '可采纳' : '仅诊断'}，已展示）` });
    this.publish();
  }

  // -- ledger --------------------------------------------------------------

  addDecision(draft: DecisionDraft): string {
    const decisionId = this.nextId('dec');
    this.snap.decisions.push({ ...draft, decisionId, taskId: this.snap.taskId, caseId: this.caseSummary?.caseId ?? null, createdAt: now() });
    this.emit('DecisionRecorded', {
      actor: { type: 'agent', id: this.deps.agentActor.id, version: this.deps.agentActor.version },
      note: decisionId,
      payloadRef: `record://${this.snap.taskId}/${decisionId}`,
    });
    this.publish();
    return decisionId;
  }

  // -- approvals (§10.3) -----------------------------------------------------

  createApprovalRequest(step: PlanStep, entry: CandidateEntry, def: ToolDefinition): ApprovalRequest {
    const c = this.caseSummary;
    if (!c || !entry.gate) throw new TransitionError('approval needs a case and a gated candidate');
    const request: ApprovalRequest = {
      approvalRequestId: this.nextId('apreq'),
      taskId: this.snap.taskId,
      stepId: step.stepId,
      candidateId: entry.candidateId,
      candidateHash: entry.candidateHash,
      target: { caseId: c.caseId, sessionId: this.sessionId ?? 'none', object: 'margin_line', tooth: c.tooth },
      baseVersion: { ...entry.proposal.baseVersion, scope: def.baseScope ?? entry.proposal.baseVersion.scope },
      provenance: { ...entry.proposal.provenance, executor: { id: def.toolId, version: def.version } },
      qualityGateRef: entry.gate.gateRef,
      criteriaSetVersion: entry.gate.criteriaSetVersion,
      policyVersion: this.deps.policyVersion,
      requestedAt: now(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      status: 'pending',
    };
    this.snap.approvalRequests.push(request);
    step.approvalRequestId = request.approvalRequestId;
    this.emit('ApprovalRequested', { stepId: step.stepId, note: request.approvalRequestId });
    return request;
  }

  findApproval(approvalRequestId: string): ApprovalRequest | undefined {
    return this.snap.approvalRequests.find((r) => r.approvalRequestId === approvalRequestId);
  }

  /** An approved, not yet consumed request for this step and candidate. */
  approvedFor(stepId: string, candidateHash: string | undefined): ApprovalRequest | undefined {
    return this.snap.approvalRequests.find((r) => r.stepId === stepId && r.candidateHash === candidateHash && r.status === 'approved');
  }

  waitForApproval(approvalRequestId: string): Promise<ApprovalOutcome> {
    return new Promise<ApprovalOutcome>((resolve, reject) => {
      this.approvalWaiters.set(approvalRequestId, { resolve, reject });
    });
  }

  resolveApproval(approvalRequestId: string, outcome: ApprovalOutcome): void {
    this.approvalWaiters.get(approvalRequestId)?.resolve(outcome);
    this.approvalWaiters.delete(approvalRequestId);
  }

  /** One-time approval is used up when the intent record is written (§6.6). */
  consumeApproval(request: ApprovalRequest): void {
    request.status = 'consumed';
    this.emit('ApprovalRecorded', { stepId: request.stepId, note: `${request.approvalRequestId} consumed（一次性审批已消耗）` });
  }

  invalidateApproval(request: ApprovalRequest, reason: string): void {
    request.status = 'invalidated';
    request.invalidationReason = reason;
    this.emit('ApprovalInvalidated', { stepId: request.stepId, note: request.approvalRequestId });
  }

  // -- blocking ------------------------------------------------------------

  /** Enter BLOCKED and wait for an allowed human response (or cancel). */
  block(report: Omit<BlockedReport, 'since'>): Promise<FeedbackOutcome> {
    this.toTask('BLOCKED', report);
    return new Promise<FeedbackOutcome>((resolve, reject) => {
      this.feedbackWaiter = { resolve, reject };
    });
  }

  /** A block no human response can lift; only cancellation ends it. */
  async blockForever(report: Omit<BlockedReport, 'since'>): Promise<never> {
    await this.block({ ...report, allowedResponses: [] });
    throw new TransitionError('unreachable: no response is accepted for this block');
  }

  resolveFeedback(outcome: FeedbackOutcome): void {
    this.feedbackWaiter?.resolve(outcome);
    this.feedbackWaiter = null;
  }

  // -- completion ----------------------------------------------------------

  async complete(outcome: TaskOutcome, verifyNote: string): Promise<void> {
    // §6.3: RUNNING → VERIFYING only once every step of the plan is terminal.
    const open = this.activePlan()?.steps.filter((s) => !s.state || !TERMINAL_STEP_STATES.includes(s.state)) ?? [];
    if (open.length > 0) throw new TransitionError(`RUNNING → VERIFYING with open steps: ${open.map((s) => s.stepId).join(', ')}`);
    this.toTask('VERIFYING');
    this.notice(verifyNote);
    await this.sleep(400);
    this.toTask('RECORDING');
    await this.sleep(300);
    this.snap.outcome = outcome;
    this.toTask('DONE');
  }

  // -- cancellation and faults --------------------------------------------

  requestCancel(reason?: string): void {
    this.snap.cancelRequested = true;
    this.emit('CancelRequested', { actor: this.humanActor(), ...(reason ? { note: reason } : {}) });
    this.publish();
  }

  /** Wake any waiter so the agent unwinds; called once a cancel request is recorded. */
  interruptWaiters(): void {
    const signal = new CancelSignal();
    for (const w of this.approvalWaiters.values()) w.reject(signal);
    this.approvalWaiters.clear();
    this.feedbackWaiter?.reject(signal);
    this.feedbackWaiter = null;
  }

  applyCancel(): void {
    for (const r of this.snap.approvalRequests) if (r.status === 'pending' || r.status === 'approved') this.invalidateApproval(r, '任务已取消');
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

  /**
   * Runtime fault handling. §6.3 has no transition for an internal error, so
   * the prototype records the fault and ends the task as FAILED without the
   * transition check (listed as an open item in docs/architecture).
   */
  markFault(error: Error): void {
    if (TERMINAL_TASK_STATES.includes(this.snap.state)) return;
    this.snap.outcome = { summary: `Runtime 内部错误，任务终止：${error.message}`, cadWrite: this.cadWriteApplied ? 'applied' : 'none' };
    delete this.snap.blocked;
    this.snap.state = 'FAILED';
    this.emit('TaskStateChanged', { note: `RUNTIME_FAULT → FAILED: ${error.message}` });
    this.publish();
  }
}
