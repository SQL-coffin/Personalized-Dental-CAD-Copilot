/**
 * In-process Runtime host: implements every UI port on top of the engine.
 * It runs in the browser for the prototype; the same class can sit behind a
 * network transport later (docs/architecture: extension points).
 */
import {
  RuntimeClientError,
  TERMINAL_TASK_STATES,
  type ApprovalChannel,
  type ApprovalDecisionInput,
  type CaseRecordView,
  type CaseSummary,
  type CreateTaskInput,
  type DeploymentInfo,
  type EventEnvelope,
  type HumanFeedbackChannel,
  type HumanFeedbackInput,
  type Receipt,
  type RecordsClient,
  type RuntimeClient,
  type RuntimePorts,
  type TaskSnapshot,
  type TaskSummary,
  type TaskUpdate,
  type Unsubscribe,
} from '@cadcopilot/contracts';
import { ToolRegistry, type AgentTaskContext } from '@cadcopilot/agent-tools';
import { toCaseRecordView, toCaseSummary } from '@cadcopilot/data';
import { CancelSignal } from '../engine/errors';
import { PolicyGate } from '../engine/policyGate';
import { AgentSessionImpl } from '../engine/session';
import { TaskRun } from '../engine/taskRun';
import type { RuntimeEnvironment } from './environment';

const now = () => new Date().toISOString();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InProcessRuntime {
  readonly registry: ToolRegistry;
  readonly policy: PolicyGate;
  /** Agent errors that were not cancellations; tests assert this stays empty. */
  readonly internalErrors: Error[] = [];

  private runs = new Map<string, TaskRun>();
  private events = new Map<string, EventEnvelope[]>();
  private listeners = new Map<string, Set<(u: TaskUpdate) => void>>();
  private listListeners = new Set<(tasks: TaskSummary[]) => void>();
  private seq = 0;
  private taskCounter = 0;
  private receiptCounter = 0;
  private failDeploymentTimes: number;
  private decisionsInFlight = new Set<string>();

  constructor(private readonly env: RuntimeEnvironment) {
    this.registry = ToolRegistry.forMode(env.config.mode, env.tools);
    this.policy = new PolicyGate({
      mode: env.config.mode,
      policyVersion: env.config.policyVersion,
      gateCriteriaSetVersion: env.config.gateCriteriaSetVersion,
      egressAllowed: env.config.egressAllowed,
    });
    this.failDeploymentTimes = env.failDeploymentTimes ?? 0;
  }

  get deployment(): DeploymentInfo {
    const c = this.env.config;
    const approvals = this.registry.definitions().some((d) => d.tier === 'E');
    const caseWork = c.mode !== 'offline-research';
    return {
      deploymentId: c.deploymentId,
      mode: c.mode,
      simulated: c.simulated,
      cadConnected: c.cadConnected,
      policyVersion: c.policyVersion,
      gateCriteriaSetVersion: c.gateCriteriaSetVersion,
      registeredTools: this.registry.refs(),
      capabilities: {
        cancelTask: true,
        humanFeedback: true,
        approvals,
        // 06 §1: research tasks never touch case data.
        caseSelection: caseWork,
        caseRecords: caseWork,
      },
      identity: c.identity,
      integrations: c.integrations,
    };
  }

  /** Separate objects per port, so code holding one cannot reach the others. */
  ports(): RuntimePorts {
    const deployment = this.deployment;
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
    const records: RecordsClient = {
      getCaseRecord: (caseId) => this.getCaseRecord(caseId),
      subscribeCase: (caseId, listener) => this.env.data.onChange((change) => change.caseId === caseId && listener()),
    };
    return {
      runtime,
      approvals: deployment.capabilities.approvals ? approvals : null,
      feedback: deployment.capabilities.humanFeedback ? feedback : null,
      records: deployment.capabilities.caseRecords ? records : null,
    };
  }

  // -- engine wiring -------------------------------------------------------

  private appendEvent(event: EventEnvelope): void {
    const list = this.events.get(event.taskId) ?? [];
    list.push(event);
    this.events.set(event.taskId, list);
  }

  private notify(snapshot: TaskSnapshot, events: EventEnvelope[]): void {
    const update: TaskUpdate = { snapshot: clone(snapshot), events: clone(events) };
    for (const l of this.listeners.get(snapshot.taskId) ?? []) l(update);
    const summaries = this.summaries();
    for (const l of this.listListeners) l(summaries);
  }

  private receipt(): Receipt {
    this.receiptCounter += 1;
    return { receiptId: `rcpt-${this.receiptCounter}`, receivedAt: now() };
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

  /** Only the case's assigned technician may work on it (ADR-0003). */
  private requireAssigned(caseId: string): void {
    const assignment = this.env.data.getAssignment(caseId);
    if (!this.env.data.getCase(caseId)) throw new RuntimeClientError('NOT_FOUND', `病例 ${caseId} 不存在`);
    if (assignment?.technicianId !== this.env.config.identity.userId) {
      throw new RuntimeClientError('FORBIDDEN', `病例 ${caseId} 未分配给当前牙技师；每个病例只由负责的牙技师处理`);
    }
  }

  // -- RuntimeClient ---------------------------------------------------------

  async getDeployment(): Promise<DeploymentInfo> {
    await this.env.scheduler.sleep(300);
    if (this.failDeploymentTimes > 0) {
      this.failDeploymentTimes -= 1;
      throw new RuntimeClientError('UNAVAILABLE', '无法连接 Agent Runtime（模拟故障）', true);
    }
    return clone(this.deployment);
  }

  /** Open cases assigned to the signed-in technician. */
  async listCases(): Promise<CaseSummary[]> {
    if (!this.deployment.capabilities.caseSelection) return [];
    const data = this.env.data;
    return data
      .listCases({ technicianId: this.env.config.identity.userId })
      .map((c) => toCaseSummary(data, c.caseId))
      .filter((s) => s.status === 'open');
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
    const { config, data } = this.env;
    let caseSummary: CaseSummary | null = null;
    if (this.deployment.capabilities.caseSelection) {
      if (!input.caseId) throw new RuntimeClientError('INVALID_REQUEST', '请选择一个病例');
      this.requireAssigned(input.caseId);
      caseSummary = toCaseSummary(data, input.caseId);
    } else if (input.caseId) {
      throw new RuntimeClientError('INVALID_REQUEST', '当前模式的任务不能关联病例数据');
    }

    this.taskCounter += 1;
    const taskId = `task-${String(this.taskCounter).padStart(3, '0')}`;
    const createdAt = now();
    const context: AgentTaskContext = {
      taskId,
      prompt,
      mode: config.mode,
      caseSummary,
      technicianId: caseSummary ? config.identity.userId : null,
      asOf: createdAt,
      registeredToolIds: this.registry.definitions().map((d) => d.toolId),
    };
    const setup = this.env.setupTask(context);
    const budget = { ...config.budget, ...setup.budget };
    const snap: TaskSnapshot = {
      taskId,
      title: prompt.length > 28 ? `${prompt.slice(0, 28)}…` : prompt,
      prompt,
      caseId: caseSummary?.caseId ?? null,
      mode: config.mode,
      state: 'CREATED',
      createdAt,
      updatedAt: createdAt,
      seq: 0,
      plans: [],
      messages: [],
      candidates: [],
      decisions: [],
      approvalRequests: [],
      modelCalls: [],
      budget: {
        rounds: { used: 0, limit: budget.rounds },
        replans: { used: 0, limit: budget.replans },
        toolCalls: { used: 0, limit: budget.toolCalls },
      },
      versions: {
        policy: config.policyVersion,
        gateCriteriaSet: config.gateCriteriaSetVersion,
        registration: config.registrationVersion,
        models: [`${this.env.model.modelId}@${this.env.model.modelVersion}${this.env.model.simulated ? '（脚本，未调用模型）' : ''}`],
      },
      simulated: config.simulated,
    };
    const sessionId = caseSummary ? (data.listSessions(caseSummary.caseId).at(-1)?.sessionId ?? null) : null;
    const run = new TaskRun(
      {
        scheduler: this.env.scheduler,
        nextSeq: () => ++this.seq,
        appendEvent: (e) => this.appendEvent(e),
        notify: (s, e) => this.notify(s, e),
        identity: config.identity,
        agentActor: { id: setup.agent.agentId, version: setup.agent.version },
        policyVersion: config.policyVersion,
        gateCriteriaSetVersion: config.gateCriteriaSetVersion,
        requiredCriteria: config.requiredGateCriteria,
      },
      snap,
      { caseSummary, technicianId: context.technicianId, sessionId },
    );
    this.runs.set(taskId, run);
    run.emit('TaskCreated', { actor: { type: 'human', id: config.identity.userId }, ...(setup.label ? { note: setup.label } : {}) });
    run.userMessage(prompt);
    const session = new AgentSessionImpl(
      { run, registry: this.registry, policy: this.policy, model: this.env.model, systemPromptVersion: config.systemPromptVersion },
      context,
    );
    void this.drive(run, () => setup.agent.run(session));
    return clone(snap);
  }

  private async drive(run: TaskRun, body: () => Promise<void>): Promise<void> {
    await this.env.scheduler.sleep(0);
    try {
      await body();
    } catch (err) {
      if (err instanceof CancelSignal) {
        run.applyCancel();
        return;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      this.internalErrors.push(error);
      run.markFault(error);
    }
  }

  async postMessage(taskId: string, text: string): Promise<Receipt> {
    const run = this.run(taskId);
    if (!text.trim()) throw new RuntimeClientError('INVALID_REQUEST', '消息不能为空');
    if (TERMINAL_TASK_STATES.includes(run.snap.state)) throw new RuntimeClientError('CONFLICT', '任务已结束，不能再发送消息');
    run.userMessage(text.trim());
    const receipt = this.receipt();
    void this.env.scheduler.sleep(300).then(() => {
      run.notice(
        '消息已保存为对话上下文。它不会改变任务、权限、预算或审批状态：需要批准或拒绝时请使用「审阅与审批」面板，需要恢复被阻塞的任务时请使用阻塞提示中的操作。',
      );
    });
    return receipt;
  }

  async cancelTask(taskId: string, reason?: string): Promise<Receipt> {
    const run = this.run(taskId);
    if (TERMINAL_TASK_STATES.includes(run.snap.state)) throw new RuntimeClientError('CONFLICT', '任务已处于终止状态，不能取消');
    if (run.snap.cancelRequested) throw new RuntimeClientError('CONFLICT', '取消请求已在处理中');
    run.requestCancel(reason);
    const receipt = this.receipt();
    // A blocked agent is waiting on a human; wake it so the cancel is applied.
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

  // -- RecordsClient -----------------------------------------------------------

  async getCaseRecord(caseId: string): Promise<CaseRecordView> {
    this.requireAssigned(caseId);
    return toCaseRecordView(this.env.data, caseId);
  }

  // -- ApprovalChannel (§10.3) -------------------------------------------------

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
    if (input.decision === 'revise' && !input.note?.trim()) throw new RuntimeClientError('INVALID_REQUEST', '要求修改方案时必须说明修改意见');
    const identity = this.env.config.identity;
    if (input.decision === 'approve' && !identity.authenticated && !this.env.config.simulated) {
      throw new RuntimeClientError('UNAUTHENTICATED', '审批需要经过身份验证的牙技师');
    }
    if (request.target.caseId) this.requireAssigned(request.target.caseId);
    this.decisionsInFlight.add(request.approvalRequestId);
    const receipt = this.receipt();
    void this.env.scheduler.sleep(300).then(() => {
      this.decisionsInFlight.delete(request.approvalRequestId);
      if (request.status !== 'pending') return; // cancelled meanwhile
      const note = input.note?.trim();
      request.status = input.decision === 'approve' ? 'approved' : 'rejected';
      request.record = {
        approvalId: `apr-${request.approvalRequestId.slice('apreq-'.length)}`,
        approver: identity,
        decision: input.decision === 'approve' ? 'approve' : 'reject',
        ...(note ? { note } : {}),
        decidedAt: now(),
        uses: 1,
        ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
      };
      run.emit('ApprovalRecorded', { stepId: request.stepId, actor: { type: 'human', id: identity.userId }, note: `${request.record.approvalId}: ${input.decision}` });
      run.notice(
        input.decision === 'approve'
          ? `审批记录 ${request.record.approvalId} 已写入审批存储${this.env.config.simulated ? '（模拟）' : ''}。审批只授权这一次写入，不代表放行最终设计。`
          : input.decision === 'revise'
            ? `已记录：拒绝候选 ${request.candidateId}，并附修改意见。`
            : `已记录：拒绝候选 ${request.candidateId}。被拒绝的建议会单独存档。`,
      );
      run.resolveApproval(request.approvalRequestId, { decision: input.decision, ...(note ? { note } : {}) });
    });
    return receipt;
  }

  // -- HumanFeedbackChannel (§6.4) -----------------------------------------------

  async submitFeedback(input: HumanFeedbackInput): Promise<Receipt> {
    const run = this.run(input.taskId);
    const blocked = run.snap.blocked;
    if (run.snap.state !== 'BLOCKED' || !blocked || blocked.reason !== input.blockedReason) {
      throw new RuntimeClientError('CONFLICT', '任务当前不处于该阻塞状态');
    }
    if (!blocked.allowedResponses.includes(input.kind)) throw new RuntimeClientError('INVALID_REQUEST', '当前阻塞状态不接受这种回应');
    if (input.kind === 'replan' && !input.note?.trim()) throw new RuntimeClientError('INVALID_REQUEST', '改写计划时必须说明要求');
    const receipt = this.receipt();
    void this.env.scheduler.sleep(300).then(() => {
      const note = input.note?.trim();
      run.emit('HumanFeedbackRecorded', { actor: { type: 'human', id: this.env.config.identity.userId }, note: `${input.blockedReason}: ${input.kind}` });
      run.notice(`已记录人工回应（${input.kind}）${note ? `：「${note}」` : ''}。`);
      run.resolveFeedback({ kind: input.kind, ...(note ? { note } : {}) });
    });
    return receipt;
  }
}
