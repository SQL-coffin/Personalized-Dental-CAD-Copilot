/**
 * The AgentSession handed to an agent. Everything here delegates to TaskRun
 * or StepExecutor after the Policy Gate; nothing exposes policy, budget,
 * mode or approval records for writing (I3, I4).
 */
import type { EvidenceRef, TaskOutcome } from '@cadcopilot/contracts';
import type {
  AgentSession,
  AgentTaskContext,
  CandidateInfo,
  DecisionDraft,
  FeedbackOutcome,
  HumanFeedbackRequest,
  ModelProvider,
  PlanStepSpec,
  StepRunResult,
  ToolRegistry,
} from '@cadcopilot/agent-tools';
import { RuntimeInvariantError } from './errors';
import type { PolicyGate } from './policyGate';
import { StepExecutor } from './stepExecutor';
import type { TaskRun } from './taskRun';

export interface SessionDeps {
  run: TaskRun;
  registry: ToolRegistry;
  policy: PolicyGate;
  model: ModelProvider;
  systemPromptVersion: string;
}

export class AgentSessionImpl implements AgentSession {
  readonly context: AgentTaskContext;
  private readonly executor: StepExecutor;

  constructor(private readonly deps: SessionDeps, context: AgentTaskContext) {
    this.context = context;
    this.executor = new StepExecutor({ run: deps.run, registry: deps.registry, policy: deps.policy });
  }

  async say(text: string, refs: EvidenceRef[] = []): Promise<void> {
    const { run, model, policy } = this.deps;
    // Narration may mention case facts: treat it as de-identified structured data (§10.6).
    const egress = policy.checkEgress(model.egress, 'deidentified_structured');
    if (egress.verdict === 'deny') throw new RuntimeInvariantError(`model call refused: ${egress.message}`);
    const result = await model.complete({
      purpose: 'narrate',
      systemPromptVersion: this.deps.systemPromptVersion,
      messages: [{ role: 'user', text }],
      params: { temperature: 0 },
      egressCategory: 'deidentified_structured',
    });
    run.recordModelCall(result.record);
    run.say(result.text, refs);
  }

  think(ms: number): Promise<void> {
    return this.deps.run.sleep(ms);
  }

  async beginPlanning(): Promise<void> {
    const { run } = this.deps;
    if (run.snap.state === 'CREATED') run.toTask('PLANNING');
    else if (run.snap.state !== 'PLANNING') throw new RuntimeInvariantError(`beginPlanning in ${run.snap.state}`);
  }

  writePlan(steps: PlanStepSpec[], reason?: string): Record<string, string> {
    const { run, registry, policy } = this.deps;
    const check = policy.precheckPlan(steps.map((s) => s.toolId), (id) => registry.has(id));
    if (check.verdict === 'deny') throw new RuntimeInvariantError(check.message);
    return run.writePlan(
      steps.map((s) => {
        const def = registry.require(s.toolId).definition;
        const { toolId, version, kind, tier, sideEffects, deterministic, idempotent } = def;
        return {
          key: s.key,
          title: s.title,
          purpose: s.purpose,
          tool: { toolId, version, kind, tier, sideEffects, deterministic, idempotent },
          ...(s.maxAttempts ? { maxAttempts: s.maxAttempts } : {}),
        };
      }),
      reason,
    );
  }

  execute(): void {
    this.deps.run.toTask('RUNNING');
  }

  runStep<I, O>(stepId: string, input: I): Promise<StepRunResult<O>> {
    return this.executor.runStep<O>(stepId, input);
  }

  candidate(candidateId: string): CandidateInfo | undefined {
    return this.deps.run.candidateInfo(candidateId);
  }

  recordDecision(draft: DecisionDraft): string {
    return this.deps.run.addDecision(draft);
  }

  async requestHumanFeedback(request: HumanFeedbackRequest): Promise<FeedbackOutcome> {
    const { run } = this.deps;
    const outcome = await run.block({
      reason: 'human_feedback',
      summary: request.summary,
      completed: run.completedSteps(),
      requiredAction: request.requiredAction,
      allowedResponses: request.allowedResponses,
      ...(request.stepId ? { stepId: request.stepId } : {}),
    });
    await run.enterPlanning();
    return outcome;
  }

  async complete(outcome: TaskOutcome, verifyNote: string): Promise<void> {
    await this.deps.run.complete(outcome, verifyNote);
    await this.say(outcome.summary);
  }
}
