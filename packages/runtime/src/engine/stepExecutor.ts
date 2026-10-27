/**
 * Step executor: runs one plan step through the §6.5 state machine and the
 * §7.2 / §7.3 protocol. It is the only code that calls tools.
 *
 *   PROPOSED → Policy Gate ─┬─ deny ─────────────────────────────→ DENIED
 *                           ├─ needs approval → AWAITING_APPROVAL ─→ (human) ─→ AUTHORIZED / DENIED
 *                           └─ allow ──────────────────────────────→ AUTHORIZED
 *   AUTHORIZED → [E: base-version check] → [side effects: INTENT_RECORDED] → EXECUTING
 *   EXECUTING → SUCCEEDED | FAILED_NO_EFFECT (retry within max_attempts) | IN_DOUBT (reconcile first)
 *
 * On anything but success the task goes back to PLANNING and the agent
 * decides what to do next (§6.3).
 */
import type { ToolErrorCode } from '@cadcopilot/contracts';
import {
  AdapterError,
  type CandidateInput,
  type DisplayOutput,
  type PredictOutput,
  type StepRunResult,
  type ToolContext,
  type ToolDefinition,
  type ToolError,
  type ToolImplementation,
  type ToolRegistry,
  type ToolResult,
} from '@cadcopilot/agent-tools';
import { CancelSignal, RuntimeInvariantError } from './errors';
import type { PolicyGate } from './policyGate';
import type { TaskRun } from './taskRun';

const RETRYABLE: ReadonlySet<ToolErrorCode> = new Set(['TIMEOUT', 'TOOL_ERROR', 'NOT_EXECUTED']);

/** Simulated tool latency; side-effecting calls are not interruptible by a cancel. */
const LATENCY_MS = 500;

export interface ExecutorDeps {
  run: TaskRun;
  registry: ToolRegistry;
  policy: PolicyGate;
}

function candidateIdOf(input: unknown): string | undefined {
  return input && typeof input === 'object' && 'candidateId' in input ? String((input as CandidateInput).candidateId) : undefined;
}

function thrownToToolError(err: unknown, def: ToolDefinition): ToolError {
  if (err instanceof CancelSignal) throw err;
  if (err instanceof AdapterError) {
    const unknown = err.outcome === 'unknown' && def.sideEffects !== 'none';
    const code: ToolErrorCode =
      err.code === 'TIMEOUT' ? 'TIMEOUT' : err.code === 'NOT_IMPLEMENTED' || err.code === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : unknown ? 'TOOL_ERROR' : 'NOT_EXECUTED';
    return { code, message: err.message, effect: unknown ? 'unknown' : 'none' };
  }
  const message = err instanceof Error ? err.message : String(err);
  // §7.3: an unexpected error in a side-effecting tool leaves the outcome unknown.
  return { code: 'TOOL_ERROR', message, effect: def.sideEffects === 'none' ? 'none' : 'unknown' };
}

export class StepExecutor {
  constructor(private readonly deps: ExecutorDeps) {}

  private toolContext(stepId: string, attempt: number, approvalId?: string): ToolContext {
    const { run } = this.deps;
    return {
      taskId: run.snap.taskId,
      stepId,
      attempt,
      caseId: run.caseSummary?.caseId ?? null,
      technicianId: run.technicianId,
      asOf: run.snap.createdAt,
      ...(approvalId ? { approvalId } : {}),
      candidates: {
        get: (id) => {
          const e = run.candidateEntry(id);
          return e ? { candidateId: e.candidateId, candidateHash: e.candidateHash, proposal: e.proposal, ...(e.gate ? { gate: e.gate } : {}) } : undefined;
        },
      },
    };
  }

  /** DENIED, back to PLANNING. */
  private async deny(stepId: string, code: ToolErrorCode, message: string, humanDecision?: { decision: 'reject' | 'revise'; note?: string }): Promise<StepRunResult<never>> {
    const { run } = this.deps;
    run.finishAttempt(run.step(stepId), 'DENIED', { errorCode: code, errorMessage: message });
    await run.enterPlanning();
    return { kind: 'denied', code, message, ...(humanDecision ? { humanDecision } : {}) };
  }

  async runStep<O>(stepId: string, input: unknown): Promise<StepRunResult<O>> {
    const { run, registry, policy } = this.deps;
    const step = run.step(stepId);
    if (run.snap.state !== 'RUNNING') throw new RuntimeInvariantError(`runStep(${stepId}) needs RUNNING, task is ${run.snap.state}`);
    if (run.activePlan()?.steps.every((s) => s.stepId !== stepId)) throw new RuntimeInvariantError(`step ${stepId} is not in the active plan`);
    const impl: ToolImplementation | undefined = registry.get(step.tool.toolId);

    for (;;) {
      await run.chargeToolCall();
      run.setStep(step, 'PROPOSED', { newAttempt: true });
      await run.sleep(150);

      const candidateId = candidateIdOf(input);
      const entry = candidateId ? run.candidateEntry(candidateId) : undefined;
      const facts = entry
        ? { candidateId: entry.candidateId, candidateHash: entry.candidateHash, ...(entry.gate ? { gate: entry.gate } : {}), hasGeometry: !!entry.proposal.geometry }
        : undefined;
      let approval = run.approvedFor(stepId, entry?.candidateHash);
      let decision = policy.checkStep({ toolId: step.tool.toolId, definition: impl?.definition, ...(facts ? { candidate: facts } : {}), ...(approval ? { approval } : {}), now: Date.now() });

      if (decision.verdict === 'needs_approval' && entry && impl) {
        const request = run.createApprovalRequest(step, entry, impl.definition);
        run.setStep(step, 'AWAITING_APPROVAL');
        run.toTask('BLOCKED', {
          reason: 'approval',
          summary: `写入 CAD 前需要你对候选 ${entry.candidateId} 的明确批准`,
          completed: run.completedSteps(),
          requiredAction: '在「审阅与审批」中批准、拒绝或要求修改此候选。对话中的文字不构成审批。',
          allowedResponses: [],
          stepId,
        });
        const outcome = await run.waitForApproval(request.approvalRequestId);
        run.toTask('RUNNING');
        if (outcome.decision !== 'approve') {
          return this.deny(stepId, 'POLICY_DENIED', outcome.decision === 'reject' ? '牙技师拒绝了该候选' : '牙技师要求修改方案', {
            decision: outcome.decision,
            ...(outcome.note ? { note: outcome.note } : {}),
          });
        }
        approval = request;
        decision = policy.checkStep({ toolId: step.tool.toolId, definition: impl.definition, ...(facts ? { candidate: facts } : {}), approval, now: Date.now() });
      }
      if (decision.verdict === 'deny') {
        if (approval) run.invalidateApproval(approval, decision.message);
        return this.deny(stepId, decision.code, decision.message);
      }
      if (!impl || decision.verdict !== 'allow') throw new RuntimeInvariantError(`policy left ${stepId} without a decision`);

      const def = impl.definition;
      const io = run.ioRefs(step, input);
      run.setStep(step, 'AUTHORIZED', { input: io.input });
      const ctx = this.toolContext(stepId, step.attempts.length, approval?.record?.approvalId);

      if (def.role === 'cad_write' && approval) {
        run.notice('执行前核对：读取目标对象及其依赖对象的当前版本，与审批绑定的基础版本比较。');
        await run.sleep(400);
        let check;
        try {
          const current = await impl.readBase!(input, ctx);
          check = policy.checkBaseVersion(approval, current);
        } catch (err) {
          check = { verdict: 'deny' as const, code: 'DATA_UNAVAILABLE' as const, message: `无法读取目标当前版本，不能执行：${thrownToToolError(err, def).message}` };
        }
        if (check.verdict === 'deny') {
          run.invalidateApproval(approval, check.message);
          return this.deny(stepId, check.code, check.message);
        }
      }

      if (def.sideEffects !== 'none') {
        run.setStep(step, 'INTENT_RECORDED');
        if (approval) run.consumeApproval(approval);
      }
      run.setStep(step, 'EXECUTING');
      let result: ToolResult<unknown>;
      if (def.sideEffects === 'none') {
        await run.sleep(LATENCY_MS);
        result = await impl.execute(input, ctx).catch((err): ToolResult<unknown> => ({ ok: false, error: thrownToToolError(err, def) }));
        run.throwIfCancelled();
      } else {
        await run.sleepUninterruptible(LATENCY_MS);
        result = await impl.execute(input, ctx).catch((err): ToolResult<unknown> => ({ ok: false, error: thrownToToolError(err, def) }));
      }

      if (result.ok) {
        const produced = this.applyRole(def, input, result.output);
        run.finishAttempt(step, 'SUCCEEDED', { output: io.outputRef(result.output), ...(result.summary ? { outputSummary: result.summary } : {}) });
        if (def.role === 'cad_write') run.cadWriteApplied = true;
        return { kind: 'succeeded', output: result.output as O, ...(produced ? { candidateId: produced } : {}) };
      }

      const error = result.error;
      let reconciledNotApplied = false;

      if (error.effect === 'unknown' && def.sideEffects !== 'none') {
        // §7.3: outcome unknown — reconcile before anything else; never retry blindly.
        run.finishAttempt(step, 'IN_DOUBT', { errorCode: error.code, errorMessage: `${error.message}。查清之前不会重试，也不会判定失败（05 §7.3）。` });
        run.notice('对账：读取目标当前状态并与意图记录比较……');
        await run.sleepUninterruptible(400);
        const verdict = impl.reconcile ? await impl.reconcile(input, ctx).catch(() => 'unknown' as const) : 'unknown';
        let applied: boolean;
        if (verdict === 'unknown') {
          run.notice('对账无法判断这次调用是否生效，需要人工确认。');
          const fb = await run.block({
            reason: 'in_doubt',
            summary: '有副作用的调用结果不明，自动对账无法判断是否已生效。查清之前不会重试。',
            completed: run.completedSteps(),
            requiredAction: '请在 CAD 中查看当前 margin line，确认这次写入是否已生效。',
            allowedResponses: ['reconcile_applied', 'reconcile_not_applied'],
            stepId,
          });
          applied = fb.kind === 'reconcile_applied';
          run.setStep(step, applied ? 'SUCCEEDED' : 'FAILED_NO_EFFECT', { reconciled: true, outputSummary: applied ? '经人工对账确认已生效' : '经人工对账确认未生效' });
          run.toTask('RUNNING');
        } else {
          applied = verdict === 'applied';
          run.setStep(step, applied ? 'SUCCEEDED' : 'FAILED_NO_EFFECT', { reconciled: true, outputSummary: applied ? '经对账确认已生效' : '经对账确认未生效' });
        }
        if (applied) {
          if (def.role === 'cad_write') run.cadWriteApplied = true;
          return { kind: 'succeeded', output: undefined as O, reconciled: true };
        }
        reconciledNotApplied = true;
        if (approval) run.notice('已记录未生效。原审批已在写入意图记录时消耗，重试需要新的审批。');
      } else if (error.code === 'BASE_VERSION_CHANGED') {
        // §7.3: a conditional write refused for a version change was not executed
        // (FAILED_NO_EFFECT) and also counts as a base version change: the
        // approval is void and a new candidate must be generated.
        run.finishAttempt(step, 'FAILED_NO_EFFECT', { errorCode: error.code, errorMessage: error.message });
        if (approval) run.invalidateApproval(approval, error.message);
        await run.enterPlanning();
        return { kind: 'failed', code: 'BASE_VERSION_CHANGED', message: error.message };
      } else {
        run.finishAttempt(step, 'FAILED_NO_EFFECT', { errorCode: error.code, errorMessage: error.message });
        if (error.code === 'DATA_UNAVAILABLE') {
          // §7.3: missing evidence blocks the task; never continue on a guess (I9).
          const fb = await run.block({
            reason: 'missing_evidence',
            summary: `${error.message}，不能凭推测继续（I9）`,
            completed: run.completedSteps(),
            requiredAction: '请说明应使用哪个设计版本（或在 CAD 中重新导出后说明），系统将按你的说明改写计划；也可以取消任务。',
            allowedResponses: ['replan'],
            stepId,
          });
          await run.enterPlanning();
          return { kind: 'replan_requested', note: fb.note ?? '' };
        }
      }

      const retryable = reconciledNotApplied || RETRYABLE.has(error.code);
      if (retryable && step.attempts.length < step.maxAttempts) continue;
      await run.enterPlanning();
      return { kind: 'failed', code: error.code, message: error.message };
    }
  }

  /** Runtime-side effects of a successful call, by tool role. Returns a new candidate ID if one was registered. */
  private applyRole(def: ToolDefinition, input: unknown, output: unknown): string | undefined {
    const { run } = this.deps;
    const candidateId = candidateIdOf(input);
    switch (def.role) {
      case 'candidate_source':
        return run.registerCandidate((output as PredictOutput).proposal);
      case 'quality_gate':
        if (candidateId) run.attachGate(candidateId, output as never);
        return undefined;
      case 'display_candidate':
        if (candidateId) run.releaseCandidate(candidateId, 'adoptable');
        return undefined;
      case 'display_hint':
        if (candidateId) run.releaseCandidate(candidateId, 'diagnostic', (output as DisplayOutput & { hint?: string }).hint);
        return undefined;
      default:
        return undefined;
    }
  }
}
