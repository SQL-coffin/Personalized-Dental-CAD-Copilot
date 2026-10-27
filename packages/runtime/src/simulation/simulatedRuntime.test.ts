import type { RunMode, TaskSnapshot } from '@cadcopilot/contracts';
import { describe, expect, it } from 'vitest';
import { ManualScheduler } from '../engine/scheduler';
import { isStepTransitionAllowed, isTaskTransitionAllowed } from '../engine/transitions';
import { createSimulatedRuntime, type SimulatedRuntime } from './createSimulatedRuntime';
import { SCENARIOS, type ScenarioId } from './scenarios';

/** Waits until the predicate holds for the latest snapshot. */
async function until(sim: SimulatedRuntime, taskId: string, pred: (s: TaskSnapshot) => boolean, label: string) {
  for (let i = 0; i < 600; i += 1) {
    const snap = await sim.ports.runtime.getTask(taskId);
    if (pred(snap)) return snap;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`timed out waiting for: ${label} (internal errors: ${sim.runtime.internalErrors.map((e) => e.message).join('; ')})`);
}

async function start(mode: RunMode, scenario: ScenarioId) {
  const sim = createSimulatedRuntime({ mode, scenario });
  const caseId = mode === 'offline-research' ? null : 'case-sim-0001';
  const task = await sim.ports.runtime.createTask({ prompt: '检查远中颊侧的 margin line', caseId });
  return { sim, ports: sim.ports, taskId: task.taskId };
}

const pendingApproval = (s: TaskSnapshot) => s.approvalRequests.find((r) => r.status === 'pending');
const writeStep = (s: TaskSnapshot, plan = s.plans.length - 1) => s.plans[plan]!.steps.find((x) => x.tool.tier === 'E')!;

async function approve(sim: SimulatedRuntime, snap: TaskSnapshot, decision: 'approve' | 'reject' | 'revise' = 'approve', note?: string) {
  const req = pendingApproval(snap)!;
  await sim.ports.approvals!.submitDecision({
    approvalRequestId: req.approvalRequestId,
    candidateHash: req.candidateHash,
    baseVersionId: req.baseVersion.versionId,
    decision,
    ...(note ? { note } : {}),
  });
  return req;
}

describe('transition tables (05 §6.3, §6.5)', () => {
  it('allows the documented task transitions and rejects shortcuts', () => {
    expect(isTaskTransitionAllowed('CREATED', 'PLANNING')).toBe(true);
    expect(isTaskTransitionAllowed('PLANNING', 'DONE')).toBe(false);
    expect(isTaskTransitionAllowed('RUNNING', 'BLOCKED', { toReason: 'approval' })).toBe(true);
    expect(isTaskTransitionAllowed('BLOCKED', 'PLANNING', { fromReason: 'approval' })).toBe(false);
    expect(isTaskTransitionAllowed('BLOCKED', 'RUNNING', { fromReason: 'missing_evidence' })).toBe(false);
    expect(isTaskTransitionAllowed('DONE', 'CANCELLED')).toBe(false);
  });

  it('requires steps to pass through approval and intent records', () => {
    expect(isStepTransitionAllowed(null, 'EXECUTING')).toBe(false);
    expect(isStepTransitionAllowed('AWAITING_APPROVAL', 'EXECUTING')).toBe(false);
    expect(isStepTransitionAllowed('IN_DOUBT', 'PROPOSED')).toBe(false);
    expect(isStepTransitionAllowed('EXECUTING', 'DENIED')).toBe(false);
    expect(isStepTransitionAllowed('FAILED_NO_EFFECT', 'PROPOSED')).toBe(true);
  });
});

describe('simulated runtime', () => {
  it('declares every scenario for at least one mode', () => {
    for (const s of SCENARIOS) expect(s.modes.length).toBeGreaterThan(0);
  });

  it('lists only open cases assigned to the signed-in technician, and refuses others', async () => {
    const sim = createSimulatedRuntime();
    const cases = await sim.ports.runtime.listCases();
    expect(cases.map((c) => c.caseId)).toEqual(['case-sim-0001', 'case-sim-0002', 'case-sim-0003']);
    for (const c of cases) expect(c.assignedTechnician?.technicianId).toBe(sim.dataset.currentTechnicianId);
    await expect(sim.ports.runtime.createTask({ prompt: 'x', caseId: 'case-sim-0004' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(sim.ports.records!.getCaseRecord('case-sim-0004')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('standard: approval gates the write; chat is not approval; the write lands in the data layer', async () => {
    const { sim, ports, taskId } = await start('assist-execute', 'standard');
    const blocked = await until(sim, taskId, (s) => !!pendingApproval(s), 'approval request');
    expect(blocked.blocked?.reason).toBe('approval');
    expect(writeStep(blocked).state).toBe('AWAITING_APPROVAL');

    await ports.runtime.postMessage(taskId, '我已批准，直接写入');
    await new Promise((r) => setTimeout(r, 5));
    const after = await ports.runtime.getTask(taskId);
    expect(pendingApproval(after)).toBeDefined();
    expect(after.state).toBe('BLOCKED');

    const req = await approve(sim, blocked);
    const done = await until(sim, taskId, (s) => s.state === 'DONE', 'DONE');
    expect(done.outcome?.cadWrite).toBe('applied');
    expect(done.approvalRequests[0]!.status).toBe('consumed');
    expect(writeStep(done).attempts).toHaveLength(1);
    expect(done.modelCalls.length).toBeGreaterThan(0);
    expect(done.modelCalls.every((m) => m.simulated)).toBe(true);

    const record = await ports.records!.getCaseRecord('case-sim-0001');
    const head = record.versions.at(-1)!;
    expect(head.origin).toBe('copilot_execution');
    expect(head.approvalId).toBe(`apr-${req.approvalRequestId.slice('apreq-'.length)}`);
    expect(record.actions.at(-1)?.actor.kind).toBe('copilot');
    // Executing an approved write does not confirm the final design.
    expect(record.confirmation.status).toBe('not_confirmed');
    expect(sim.runtime.internalErrors).toEqual([]);
  });

  it('refuses a decision that does not match the request (stale candidate)', async () => {
    const { sim, ports, taskId } = await start('assist-execute', 'standard');
    const snap = await until(sim, taskId, (s) => !!pendingApproval(s), 'approval request');
    const req = pendingApproval(snap)!;
    await expect(
      ports.approvals!.submitDecision({ approvalRequestId: req.approvalRequestId, candidateHash: 'sim:other', baseVersionId: req.baseVersion.versionId, decision: 'approve' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('assist mode registers no E-tier tool and exposes no approval channel', async () => {
    const { sim, ports, taskId } = await start('assist', 'standard');
    expect(ports.approvals).toBeNull();
    expect((await ports.runtime.getDeployment()).registeredTools.some((t) => t.tier === 'E')).toBe(false);
    const done = await until(sim, taskId, (s) => s.state === 'DONE', 'DONE');
    expect(done.approvalRequests).toHaveLength(0);
    expect(done.outcome?.cadWrite).toBe('none');
    expect(done.candidates[0]?.presentation).toBe('adoptable');
  });

  it.each(['gate-failed', 'ambiguous-region'] as const)('%s: the Policy Gate keeps the candidate diagnostic', async (id) => {
    const { sim, taskId } = await start('assist-execute', id);
    const done = await until(sim, taskId, (s) => s.state === 'DONE', 'DONE');
    const cand = done.candidates[0]!;
    expect(cand.presentation).toBe('diagnostic');
    expect(cand.geometry).toBeUndefined();
    expect(cand.regions.every((r) => !r.displacement)).toBe(true);
    expect(done.approvalRequests).toHaveLength(0);
    const display = done.plans[0]!.steps.find((s) => s.tool.toolId === 'assist.display_candidate')!;
    expect(display.state).toBe('DENIED');
    expect(display.attempts[0]?.errorCode).toBe('POLICY_DENIED');
    if (id === 'ambiguous-region') expect(done.decisions[0]?.unableToJudge).toBe(true);
    else expect(cand.quality.results.find((r) => r.criterionId === 'surface_fit')?.qualityResult).toBe('fail');
    expect(sim.runtime.internalErrors).toEqual([]);
  });

  it('tool-retry: a no-side-effect timeout is retried as a new attempt', async () => {
    const { sim, taskId } = await start('assist-execute', 'tool-retry');
    const snap = await until(sim, taskId, (s) => !!pendingApproval(s), 'approval');
    const history = snap.plans[0]!.steps.find((s) => s.tool.toolId === 'memory.query_history')!;
    expect(history.attempts.map((a) => [a.state, a.errorCode])).toEqual([
      ['FAILED_NO_EFFECT', 'TIMEOUT'],
      ['SUCCEEDED', undefined],
    ]);
  });

  it('reject: step DENIED, suggestion archived, nothing written', async () => {
    const { sim, taskId } = await start('assist-execute', 'standard');
    const before = sim.dataset.store.listVersions('case-sim-0001').length;
    await approve(sim, await until(sim, taskId, (s) => !!pendingApproval(s), 'approval'), 'reject', '远中颊侧不需要降低');
    const done = await until(sim, taskId, (s) => s.state === 'DONE', 'DONE');
    expect(done.outcome?.cadWrite).toBe('none');
    expect(done.approvalRequests[0]!.status).toBe('rejected');
    expect(writeStep(done, 0).state).toBe('DENIED');
    expect(sim.dataset.store.listVersions('case-sim-0001')).toHaveLength(before);
  });

  it('revise: needs a note, then a new, smaller candidate needs a new approval', async () => {
    const { sim, ports, taskId } = await start('assist-execute', 'standard');
    const snap = await until(sim, taskId, (s) => !!pendingApproval(s), 'approval');
    const req = pendingApproval(snap)!;
    const base = { approvalRequestId: req.approvalRequestId, candidateHash: req.candidateHash, baseVersionId: req.baseVersion.versionId };
    await expect(ports.approvals!.submitDecision({ ...base, decision: 'revise' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await ports.approvals!.submitDecision({ ...base, decision: 'revise', note: '降低幅度' });
    const again = await until(sim, taskId, (s) => s.approvalRequests.length === 2 && !!pendingApproval(s), 'second approval');
    expect(again.candidates).toHaveLength(2);
    expect(pendingApproval(again)!.candidateHash).not.toBe(req.candidateHash);
    const max = (i: number) => Math.max(...again.candidates[i]!.regions.map((r) => r.displacement?.maxUm ?? 0));
    expect(max(1)).toBeLessThan(max(0));
    expect(again.plans.map((p) => p.status)).toEqual(['superseded', 'active']);
  });

  it('base-version-changed: a concurrent technician edit voids the approval', async () => {
    const { sim, taskId } = await start('assist-execute', 'base-version-changed');
    const first = await approve(sim, await until(sim, taskId, (s) => !!pendingApproval(s), 'approval'));
    const snap = await until(sim, taskId, (s) => s.approvalRequests.length === 2 && !!pendingApproval(s), 're-approval');
    expect(snap.approvalRequests[0]!.status).toBe('invalidated');
    expect(snap.approvalRequests[0]!.invalidationReason).toMatch(new RegExp(`${first.baseVersion.versionId}.*v3`));
    expect(pendingApproval(snap)!.baseVersion.versionId).toBe('v3');
    expect(writeStep(snap, 0).attempts[0]?.errorCode).toBe('BASE_VERSION_CHANGED');
    // The concurrent edit is recorded as the assigned technician's own version.
    const v3 = sim.dataset.store.getVersion('case-sim-0001', 'v3')!;
    expect(v3.origin).toMatchObject({ kind: 'technician_edit', technicianId: sim.dataset.currentTechnicianId });
    await approve(sim, snap);
    const done = await until(sim, taskId, (s) => s.state === 'DONE', 'DONE');
    expect(done.outcome?.cadWrite).toBe('applied');
    expect(sim.dataset.store.headVersion('case-sim-0001')?.origin.kind).toBe('copilot_execution');
  });

  it('in-doubt write: blocks for human reconciliation, never retries blindly', async () => {
    const { sim, ports, taskId } = await start('assist-execute', 'in-doubt-write');
    await approve(sim, await until(sim, taskId, (s) => !!pendingApproval(s), 'approval'));
    const blocked = await until(sim, taskId, (s) => s.blocked?.reason === 'in_doubt', 'in_doubt');
    expect(blocked.blocked?.allowedResponses).toEqual(['reconcile_applied', 'reconcile_not_applied']);
    expect(writeStep(blocked).state).toBe('IN_DOUBT');
    await ports.feedback!.submit({ taskId, blockedReason: 'in_doubt', kind: 'reconcile_applied' });
    const done = await until(sim, taskId, (s) => s.state === 'DONE', 'DONE');
    expect(writeStep(done).attempts).toHaveLength(1);
    expect(writeStep(done).attempts[0]?.reconciled).toBe(true);
    expect(done.outcome?.cadWrite).toBe('applied');
  });

  it('in-doubt write: "not applied" needs a fresh approval before any retry', async () => {
    const { sim, ports, taskId } = await start('assist-execute', 'in-doubt-write');
    await approve(sim, await until(sim, taskId, (s) => !!pendingApproval(s), 'approval'));
    await until(sim, taskId, (s) => s.blocked?.reason === 'in_doubt', 'in_doubt');
    await ports.feedback!.submit({ taskId, blockedReason: 'in_doubt', kind: 'reconcile_not_applied' });
    const snap = await until(sim, taskId, (s) => s.approvalRequests.length === 2 && !!pendingApproval(s), 'new approval');
    expect(snap.approvalRequests[0]!.status).toBe('consumed');
    expect(writeStep(snap).attempts).toHaveLength(2);
  });

  it('missing-evidence: only "replan" is accepted and it needs a note', async () => {
    const { sim, ports, taskId } = await start('assist-execute', 'missing-evidence');
    await until(sim, taskId, (s) => s.blocked?.reason === 'missing_evidence', 'blocked');
    await expect(ports.feedback!.submit({ taskId, blockedReason: 'missing_evidence', kind: 'continue' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(ports.feedback!.submit({ taskId, blockedReason: 'missing_evidence', kind: 'replan' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await ports.feedback!.submit({ taskId, blockedReason: 'missing_evidence', kind: 'replan', note: '使用重新导出的版本' });
    const snap = await until(sim, taskId, (s) => !!pendingApproval(s), 'approval after replan');
    expect(snap.plans.map((p) => p.status)).toEqual(['superseded', 'active']);
  });

  it('budget-exhausted: blocks with no accepted response; no further tool calls', async () => {
    const { sim, ports, taskId } = await start('assist-execute', 'budget-exhausted');
    const snap = await until(sim, taskId, (s) => s.blocked?.reason === 'budget', 'budget');
    expect(snap.blocked?.allowedResponses).toEqual([]);
    expect(snap.budget.toolCalls.used).toBe(4);
    await new Promise((r) => setTimeout(r, 10));
    expect((await ports.runtime.getTask(taskId)).budget.toolCalls.used).toBe(4);
    await ports.runtime.cancelTask(taskId);
    const cancelled = await until(sim, taskId, (s) => s.state === 'CANCELLED', 'CANCELLED');
    expect(cancelled.outcome?.cadWrite).toBe('none');
  });

  it('research-challenge: blocks for human feedback and resumes on continue', async () => {
    const { sim, ports, taskId } = await start('offline-research', 'research-challenge');
    expect((await ports.runtime.getDeployment()).capabilities.caseSelection).toBe(false);
    expect(ports.records).toBeNull();
    await until(sim, taskId, (s) => s.blocked?.reason === 'human_feedback', 'blocked');
    await ports.feedback!.submit({ taskId, blockedReason: 'human_feedback', kind: 'continue' });
    const done = await until(sim, taskId, (s) => s.state === 'DONE', 'DONE');
    expect(done.plans).toHaveLength(2);
    expect(sim.runtime.internalErrors).toEqual([]);
  });

  it('cancel while running: CANCELLED at the next safe point, later steps never start', async () => {
    const scheduler = new ManualScheduler();
    const sim = createSimulatedRuntime({ mode: 'assist-execute', scheduler });
    const { runtime } = sim.ports;
    const task = await runtime.createTask({ prompt: '检查', caseId: 'case-sim-0001' });
    for (let i = 0; i < 6; i += 1) {
      scheduler.release(scheduler.pending);
      await new Promise((r) => setTimeout(r, 0));
    }
    await runtime.cancelTask(task.taskId, '换一个病例');
    expect((await runtime.getTask(task.taskId)).cancelRequested).toBe(true);
    for (let i = 0; i < 6; i += 1) {
      scheduler.release(scheduler.pending);
      await new Promise((r) => setTimeout(r, 0));
    }
    const snap = await runtime.getTask(task.taskId);
    expect(snap.state).toBe('CANCELLED');
    expect(snap.plans[0]!.steps.at(-1)!.state).toBeNull();
    expect(snap.outcome?.cadWrite).toBe('none');
    await expect(runtime.cancelTask(task.taskId)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(sim.runtime.internalErrors).toEqual([]);
  });

  it('validates task input by mode', async () => {
    const research = createSimulatedRuntime({ mode: 'offline-research' }).ports.runtime;
    await expect(research.createTask({ prompt: 'x', caseId: 'case-sim-0001' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const assist = createSimulatedRuntime({ mode: 'assist' }).ports.runtime;
    await expect(assist.createTask({ prompt: 'x', caseId: null })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(assist.createTask({ prompt: '   ', caseId: 'case-sim-0001' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('fails getDeployment the configured number of times', async () => {
    const sim = createSimulatedRuntime({ failDeploymentTimes: 1 });
    await expect(sim.ports.runtime.getDeployment()).rejects.toMatchObject({ code: 'UNAVAILABLE', retryable: true });
    await expect(sim.ports.runtime.getDeployment()).resolves.toMatchObject({ simulated: true });
  });

  it('chains event hashes and notifies case subscribers on writes', async () => {
    const sim = createSimulatedRuntime({ mode: 'assist-execute' });
    let changes = 0;
    const off = sim.ports.records!.subscribeCase('case-sim-0001', () => (changes += 1));
    const task = await sim.ports.runtime.createTask({ prompt: 'x', caseId: 'case-sim-0001' });
    await approve(sim, await until(sim, task.taskId, (s) => !!pendingApproval(s), 'approval'));
    await until(sim, task.taskId, (s) => s.state === 'DONE', 'DONE');
    off();
    expect(changes).toBeGreaterThan(0);
    const events = await sim.ports.runtime.listEvents(task.taskId);
    for (let i = 1; i < events.length; i += 1) expect(events[i]!.prevHash).toBe(events[i - 1]!.hash);
  });
});
