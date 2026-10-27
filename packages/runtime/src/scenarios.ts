/**
 * Scripted scenarios for the mock runtime. Each one walks a task through a
 * sequence the contract allows, so the UI can be checked against loading,
 * approval, gate failure, retries, in-doubt writes, blocks and cancellation.
 *
 * The scripts ignore the meaning of the user's prompt: replies are canned.
 * The UI says so in its simulation banner.
 */
import type { Candidate, DecisionRecord, RunMode } from '@cadcopilot/contracts';
import type { ApprovalOutcome, StepSpec, TaskRun, WriteBehavior } from './MockRuntime';
import { GATE_CRITERIA, SIM_GATE_SET_VERSION, TOOLS, bumpProfile, gateResults, regionsFor, simHash } from './fixtures';

export type ScenarioId =
  | 'standard'
  | 'gate-failed'
  | 'ambiguous-region'
  | 'tool-retry'
  | 'in-doubt-write'
  | 'base-version-changed'
  | 'missing-evidence'
  | 'budget-exhausted'
  | 'research-challenge';

export interface ScenarioDef {
  id: ScenarioId;
  title: string;
  description: string;
  modes: RunMode[];
  toolCallLimit?: number;
  run: (ctx: TaskRun) => Promise<void>;
}

const ASSIST_MODES: RunMode[] = ['assist-execute', 'assist'];

// ---------------------------------------------------------------------------
// Candidate flow (assist / assist-execute)
// ---------------------------------------------------------------------------

type GateVariant = 'pass' | 'surface_fit_fail' | 'ambiguous';

interface CandidateFlowOptions {
  gate: GateVariant;
  retryHistory?: boolean;
  missingEvidence?: boolean;
  /** Behaviour of successive approved writes; the last entry repeats. */
  writes?: WriteBehavior[];
}

const SPEC = {
  read: { key: 'read', title: '读取当前设计版本', purpose: '读取 margin line 及其依赖对象（预备体网格）的当前版本与哈希', tool: TOOLS.readDesign },
  corr: { key: 'corr', title: '计算区域对应', purpose: '按区域计算当前曲线与 AI 初始设计 S_0 的对应状态（MATCHED / AMBIGUOUS / UNMATCHED）', tool: TOOLS.correspondence },
  history: { key: 'history', title: '检索个人修正历史', purpose: '经 Memory Manager 检索该牙技师在本病例之前的修正记录（as_of 截止、排除同一患者）', tool: TOOLS.queryHistory },
  predict: { key: 'predict', title: '生成候选修改', purpose: '调用冻结版本的个人检索 Predictor 生成候选几何与偏好估计', tool: TOOLS.predictor },
  gate: { key: 'gate', title: '运行质量闸门', purpose: '按登记的闸门标准集逐项检查候选；缺少任何一项结果都视为未通过', tool: TOOLS.qualityGate },
  display: { key: 'display', title: '展示候选（S 级）', purpose: '只有通过质量闸门的候选才能以可采纳形式展示', tool: TOOLS.displayCandidate },
  hint: { key: 'hint', title: '展示诊断与区域提示', purpose: '展示未通过的检查项与区域提示，不附候选几何', tool: TOOLS.displayRegionHint },
  write: { key: 'write', title: '写入 CAD（需审批）', purpose: '经牙技师逐次批准后，以条件写入方式把候选写入 CAD；执行前核对基础版本', tool: TOOLS.writeMarginLine, maxAttempts: 2 },
  record: { key: 'record', title: '存档被拒绝的建议', purpose: '写入 DecisionRecord，供相似情境下抑制重复推荐', tool: TOOLS.recordDecision },
} satisfies Record<string, StepSpec>;

function analysisSpecs(canWrite: boolean): StepSpec[] {
  const specs: StepSpec[] = [SPEC.read, SPEC.corr, SPEC.history, SPEC.predict, SPEC.gate, SPEC.display];
  return canWrite ? [...specs, SPEC.write] : specs;
}

function regenerateSpecs(canWrite: boolean, withRead: boolean): StepSpec[] {
  const specs: StepSpec[] = [...(withRead ? [SPEC.read] : []), SPEC.predict, SPEC.gate, SPEC.display];
  return canWrite ? [...specs, SPEC.write] : specs;
}

function buildCandidate(ctx: TaskRun, gate: GateVariant, revision: number): Candidate {
  const c = ctx.caseInfo!;
  const id = ctx.nextId('cand');
  const passed = gate === 'pass';
  const regions = regionsFor(gate === 'ambiguous' ? 'ambiguous' : 'matched');
  const peak = revision === 0 ? -120 : -80;
  if (regions[0]?.displacement) regions[0].displacement = { direction: 'apical', maxUm: Math.abs(peak), meanUm: Math.round(Math.abs(peak) * 0.53) };
  const candidate: Candidate = {
    candidateId: id,
    candidateHash: simHash(`${id}:${c.currentVersion.contentHash}:r${revision}`),
    caseId: c.caseId,
    object: 'margin_line',
    baseVersion: { ...c.currentVersion, scope: ['margin_line', 'prep_mesh'] },
    provenance: {
      predictor: { id: TOOLS.predictor.toolId, version: TOOLS.predictor.version },
      geometryEngine: { id: 'geometry-engine-sim', version: '0.1.0-sim' },
      paramsHash: `sim:params-k5-r${revision}`,
    },
    regions,
    preference: {
      score: gate === 'surface_fit_fail' ? 0.86 : gate === 'ambiguous' ? 0.71 : revision === 0 ? 0.74 : 0.68,
      interval: gate === 'surface_fit_fail' ? [0.7, 0.93] : [0.52, 0.88],
      basis: '与该牙技师 6 个历史病例的 Final GD 比较（模拟）',
      predictor: { id: TOOLS.predictor.toolId, version: TOOLS.predictor.version },
    },
    quality: {
      gateRef: `gate://sim/${id}`,
      criteriaSetVersion: SIM_GATE_SET_VERSION,
      requiredCriteria: GATE_CRITERIA,
      results: gateResults(gate),
      passed,
      evaluatedAt: new Date().toISOString(),
    },
    presentation: passed ? 'adoptable' : 'diagnostic',
    createdAt: new Date().toISOString(),
  };
  if (passed) {
    candidate.geometry = {
      kind: 'margin_line_displacement',
      frameVersion: 'frame-sim-0.1',
      samples: [...bumpProfile(0.32, 0.48, peak), ...bumpProfile(0.7, 0.8, 35, 12)],
    };
  } else if (gate === 'surface_fit_fail') {
    candidate.hint = '远中颊侧区域符合你过去的修改习惯，但候选未通过「表面贴合」检查，因此不附候选几何。';
  } else {
    candidate.hint = '远中颊侧区域的曲线对应不明确（AMBIGUOUS），不给出逐点位移，只提示该区域可能需要关注。';
  }
  return candidate;
}

function decisionFor(ctx: TaskRun, candidate: Candidate, gate: GateVariant): DecisionRecord {
  const unable = gate === 'ambiguous';
  return {
    decisionId: ctx.nextId('dec'),
    taskId: ctx.snap.taskId,
    caseId: candidate.caseId,
    observations: [
      { ref: 'obs://sim/corr-1', label: `区域对应：远中颊侧 ${candidate.regions[0]?.correspondence}，舌侧 MATCHED` },
      { ref: 'obs://sim/design', label: `当前设计版本 ${candidate.baseVersion.versionId}` },
    ],
    hypothesis: '远中颊侧 margin line 可能需要向龈方降低（工作假设，未验证）',
    evidence: [
      { ref: 'case://sim/hist-03', label: '历史病例 hist-03：同区域向龈方调整 110 μm', stance: 'supports' },
      { ref: 'case://sim/hist-05', label: '历史病例 hist-05：同区域向龈方调整 90 μm', stance: 'supports' },
      { ref: 'case://sim/hist-02', label: '历史病例 hist-02：同区域未修改', stance: 'opposes' },
    ],
    alternatives: [
      { label: '不修改（A0）', whyNot: '6 个历史病例中有 4 个在该区域做了同向修改' },
      { label: '只调整舌侧', whyNot: '舌侧位移小于噪声阈值的 2 倍，单独调整意义不大' },
    ],
    candidateId: candidate.candidateId,
    rationale:
      gate === 'pass'
        ? '候选来自冻结版本 Predictor，所有闸门检查项均可评价且通过；偏好估计与质量结果分别给出。'
        : gate === 'surface_fit_fail'
          ? '偏好符合程度较高，但「表面贴合」检查未通过；按闸门规则不以可采纳形式展示。'
          : '依据区域对应为 AMBIGUOUS，「依据区域的曲线对应」检查不可评价；按闸门规则视为未通过。',
    uncertainty: '偏好估计基于 6 个历史病例，区间较宽；未经过预登记评估（SUPPORTED_EXPLORATORY 以下）。',
    outcome:
      gate === 'pass'
        ? '建议：按候选调整远中颊侧与舌侧，待牙技师决定'
        : unable
          ? '无法可靠判断'
          : '不推荐执行：候选未通过质量闸门',
    unableToJudge: unable,
    createdAt: new Date().toISOString(),
  };
}

/** predict → gate → display (or hint). Returns the displayed candidate. */
async function generateAndShow(ctx: TaskRun, ids: Record<string, string>, gate: GateVariant, revision: number): Promise<{ candidate: Candidate; adoptable: boolean }> {
  await ctx.runStep(ids.predict!, ['ok'], { outputSummary: '候选 1 个；偏好估计已写入 Record Store' });
  const candidate = buildCandidate(ctx, gate, revision);
  await ctx.runStep(ids.gate!, ['ok'], {
    outputSummary: gate === 'pass' ? '4/4 项可评价且通过' : gate === 'surface_fit_fail' ? '1 项未通过（表面贴合）' : '1 项不可评价（曲线对应）',
  });
  if (gate === 'pass') {
    await ctx.runStep(ids.display!, ['ok'], { outputSummary: '候选已以可采纳形式展示' });
    ctx.addCandidate(candidate);
    ctx.addDecision(decisionFor(ctx, candidate, gate));
    ctx.say(
      `候选 ${candidate.candidateId} 已通过质量闸门（标准集 ${candidate.quality.criteriaSetVersion}）。偏好估计和质量结果分开列在审阅面板中；通过闸门不代表临床或制造质量合格。`,
      [{ ref: candidate.quality.gateRef, label: '闸门结果' }, { ref: `record://sim/${candidate.candidateId}`, label: '候选记录' }],
    );
    return { candidate, adoptable: true };
  }
  // §10.7 fail-closed: the Policy Gate refuses an adoptable display.
  await ctx.runStep(ids.display!, ['policy_denied'], {
    errorMessage: '质量闸门未通过：候选不能以可采纳形式展示（05 §10.7）',
  });
  await ctx.replan('候选未通过质量闸门，改为只展示诊断信息与区域提示。', [{ ref: candidate.quality.gateRef, label: '闸门结果' }]);
  const hintIds = ctx.writePlan([SPEC.hint], '展示步骤被 Policy Gate 拒绝（质量闸门未通过）');
  ctx.toTask('RUNNING');
  await ctx.runStep(hintIds.hint!, ['ok'], { outputSummary: '已展示诊断与区域提示（不含候选几何）' });
  ctx.addCandidate(candidate);
  ctx.addDecision(decisionFor(ctx, candidate, gate));
  return { candidate, adoptable: false };
}

async function candidateFlow(ctx: TaskRun, opts: CandidateFlowOptions): Promise<void> {
  const c = ctx.caseInfo!;
  const canWrite = ctx.hasTool(TOOLS.writeMarginLine.toolId);
  const writes = opts.writes ?? [{}];
  let writeRound = 0;

  ctx.toTask('PLANNING');
  await ctx.sleep(400);
  ctx.say(
    `我会读取 ${c.tooth} 号牙 margin line 的当前版本，按区域计算与 AI 初始设计 S_0 的对应，检索你过去的修正记录，再用冻结版本的 Predictor 生成候选，并在展示前运行质量闸门。` +
      (canWrite ? '写入 CAD 之前会请你逐次批准。' : '当前部署没有写入 CAD 的工具，我只会给出建议。'),
  );
  let ids = ctx.writePlan(analysisSpecs(canWrite));
  ctx.toTask('RUNNING');

  const read = await ctx.runStep(ids.read!, opts.missingEvidence ? ['data_unavailable'] : ['ok'], {
    outputSummary: `设计版本 ${c.currentVersion.versionId}，哈希校验通过`,
    ...(opts.missingEvidence ? { errorMessage: `设计版本 ${c.currentVersion.versionId} 的证据负载哈希校验失败` } : {}),
  });
  if (read === 'data_unavailable') {
    const fb = await ctx.block({
      reason: 'missing_evidence',
      summary: `设计版本 ${c.currentVersion.versionId} 的证据负载哈希校验失败，不能凭推测继续（I9）`,
      completed: ctx.completedSteps(),
      requiredAction: '请说明应使用哪个设计版本（或在 CAD 中重新导出后说明），系统将按你的说明改写计划；也可以取消任务。',
      allowedResponses: ['replan'],
      stepId: ids.read!,
    });
    await ctx.replan(`按你的说明改写计划：「${fb.note ?? ''}」。重新读取并校验设计版本。`);
    ids = ctx.writePlan(analysisSpecs(canWrite), '证据缺失，按人工说明改写计划');
    ctx.toTask('RUNNING');
    await ctx.runStep(ids.read!, ['ok'], { outputSummary: `设计版本 ${c.currentVersion.versionId}，哈希校验通过` });
  }

  await ctx.runStep(ids.corr!, ['ok'], {
    outputSummary: opts.gate === 'ambiguous' ? '远中颊侧 AMBIGUOUS；舌侧 MATCHED' : '远中颊侧 MATCHED；舌侧 MATCHED',
  });
  await ctx.runStep(ids.history!, opts.retryHistory ? ['timeout', 'ok'] : ['ok'], {
    outputSummary: '返回 6 个满足 as_of 与患者排除条件的历史病例',
  });

  let shown = await generateAndShow(ctx, ids, opts.gate, 0);
  if (!shown.adoptable) {
    const unable = opts.gate === 'ambiguous';
    await ctx.complete({
      verify: '验证：已展示的内容不含候选几何；闸门结论未被偏好值改变。',
      outcome: {
        summary: unable
          ? '结论：无法可靠判断。依据区域的对应不明确，只给出区域提示。未写入 CAD。'
          : '未产生可采纳的候选。已展示未通过的检查项和区域提示。未写入 CAD。',
        cadWrite: 'none',
      },
    });
    return;
  }

  if (!canWrite) {
    await ctx.complete({
      verify: '验证：候选已展示，闸门结果与偏好估计已分别记录。',
      outcome: {
        summary: '已展示候选（S 级建议）。当前部署未注册写入 CAD 的工具；如需采用，请在 CAD 中手动修改。未写入 CAD。',
        cadWrite: 'none',
      },
    });
    return;
  }

  let revision = 0;
  for (;;) {
    const outcome: ApprovalOutcome = await ctx.requestApproval(ids.write!, shown.candidate);
    const request = ctx.snap.approvalRequests[ctx.snap.approvalRequests.length - 1]!;

    if (outcome.decision === 'reject') {
      ctx.denyAfterDecision(ids.write!, 'reject');
      await ctx.replan('已记录你的拒绝。我会把这条建议存档，在相似情境下抑制重复推荐，不再继续写入。');
      const rec = ctx.writePlan([SPEC.record], '审批被拒绝');
      ctx.toTask('RUNNING');
      await ctx.runStep(rec.record!, ['ok'], { outputSummary: '被拒绝的建议已存档' });
      await ctx.complete({
        verify: '验证：没有任何写入 CAD 的调用被执行。',
        outcome: { summary: '候选已被拒绝并存档。未写入 CAD。', cadWrite: 'none' },
      });
      return;
    }

    if (outcome.decision === 'revise') {
      ctx.denyAfterDecision(ids.write!, 'revise');
      revision += 1;
      await ctx.replan(`按你的修改意见重新生成候选：「${outcome.note ?? ''}」。新候选需要重新通过质量闸门，并重新申请审批。`);
      ids = ctx.writePlan(regenerateSpecs(true, false), '牙技师要求修改方案');
      ctx.toTask('RUNNING');
      shown = await generateAndShow(ctx, ids, 'pass', revision);
      continue;
    }

    const behavior = writes[Math.min(writeRound, writes.length - 1)]!;
    writeRound += 1;
    const result = await ctx.executeApproved(ids.write!, request, behavior);

    if (result === 'succeeded') {
      await ctx.complete({
        verify: '验证：写后读取的版本与候选一致；对应状态与闸门结果已记录。',
        outcome: {
          summary: `已按批准把候选 ${shown.candidate.candidateId} 写入 CAD（新版本 ${c.currentVersion.versionId}）。这不代表最终设计已放行：请在 CAD 中检查并自行确认最终设计。`,
          cadWrite: 'applied',
        },
      });
      return;
    }

    if (result === 'base_changed') {
      await ctx.replan(`设计在审批之后发生了变化（当前 ${c.currentVersion.versionId}），原审批已作废。我会基于新版本重新生成并验证候选，再请你重新审批。`);
      ids = ctx.writePlan(regenerateSpecs(true, true), '执行前核对发现基础版本变化');
      ctx.toTask('RUNNING');
      await ctx.runStep(ids.read!, ['ok'], { outputSummary: `设计版本 ${c.currentVersion.versionId}` });
      shown = await generateAndShow(ctx, ids, 'pass', revision);
      continue;
    }

    // in_doubt
    const fb = await ctx.block({
      reason: 'in_doubt',
      summary: '写入 CAD 的请求超时，自动对账无法判断是否已生效。查清之前不会重试。',
      completed: ctx.completedSteps(),
      requiredAction: '请在 CAD 中查看当前 margin line，确认这次写入是否已生效。',
      allowedResponses: ['reconcile_applied', 'reconcile_not_applied'],
      stepId: ids.write!,
    });
    if (fb.kind === 'reconcile_applied') {
      ctx.resolveInDoubt(ids.write!, true);
      await ctx.complete({
        verify: '验证：按人工对账结果记录写入已生效。',
        outcome: {
          summary: `经你在 CAD 中核对，候选 ${shown.candidate.candidateId} 的写入已生效。这不代表最终设计已放行：请在 CAD 中自行确认最终设计。`,
          cadWrite: 'applied',
        },
      });
      return;
    }
    ctx.resolveInDoubt(ids.write!, false);
    ctx.notice('已按人工对账结果记录写入未生效。原审批已在写入意图记录时消耗，重试需要新的审批。');
  }
}

// ---------------------------------------------------------------------------
// Offline research (06 Research Browser)
// ---------------------------------------------------------------------------

async function researchFlow(ctx: TaskRun): Promise<void> {
  ctx.toTask('PLANNING');
  await ctx.sleep(400);
  ctx.say('我会检索公开研究资料并读取来源页面。检索只使用任务描述中的研究主题，不会发送任何病例或患者信息。');
  const ids = ctx.writePlan([
    { key: 'search', title: '检索公开资料', purpose: '用获批的搜索 provider 检索（结果只是待核验的来源线索）', tool: TOOLS.researchSearch },
    { key: 'fetch', title: '读取来源页面', purpose: '只读公开 HTTPS 页面，不执行 JavaScript，不提交表单', tool: TOOLS.researchFetch },
  ]);
  ctx.toTask('RUNNING');
  await ctx.runStep(ids.search!, ['ok'], { outputSummary: '返回 5 条来源线索（模拟）' });
  await ctx.runStep(ids.fetch!, ['ok'], { outputSummary: 'status = human_verification_required；challenge_type = captcha' });
  const fb = await ctx.block({
    reason: 'human_feedback',
    summary: '目标页面要求人工验证（CAPTCHA）。系统不会自动求解或绕过（06 §3）。',
    completed: ctx.completedSteps(),
    requiredAction: '你可以在自己的浏览器中处理后选择「继续」，系统会重新检查策略与版本后再读取；也可以改写计划，换用其他来源。系统不会保存 Cookie、密码或验证码答案。',
    allowedResponses: ['continue', 'replan'],
    stepId: ids.fetch!,
  });
  await ctx.replan(
    fb.kind === 'continue'
      ? '已收到人工反馈。恢复前重新检查运行模式、策略、工具版本与预算，然后重新读取该页面。'
      : `按你的说明改写计划：「${fb.note ?? ''}」。`,
  );
  const ids2 = ctx.writePlan(
    [{ key: 'fetch', title: fb.kind === 'continue' ? '重新读取来源页面' : '读取替代来源', purpose: '只读公开 HTTPS 页面', tool: TOOLS.researchFetch }],
    fb.kind === 'continue' ? '人工处理访问挑战后恢复' : '人工要求换用其他来源',
  );
  ctx.toTask('RUNNING');
  await ctx.runStep(ids2.fetch!, ['ok'], { outputSummary: 'status = success；已保存为只追加 Evidence（模拟）' });
  await ctx.complete({
    verify: '验证：来源有 URL 与获取时间；摘要作为 Observation 引用原始证据。',
    outcome: {
      summary: '已获取来源并存为证据。网页内容只作为待核验资料，不会自动成为已验证的知识。',
      cadWrite: 'none',
    },
  });
}

// ---------------------------------------------------------------------------

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'standard',
    title: '标准流程',
    description: 'assist-execute：候选通过质量闸门 → 等待审批 → 条件写入。assist：只展示建议。',
    modes: ASSIST_MODES,
    run: (ctx) => candidateFlow(ctx, { gate: 'pass' }),
  },
  {
    id: 'gate-failed',
    title: '偏好高，但未通过质量闸门',
    description: '偏好符合程度 0.86，但「表面贴合」未通过：只展示诊断与区域提示，没有审批入口。',
    modes: ASSIST_MODES,
    run: (ctx) => candidateFlow(ctx, { gate: 'surface_fit_fail' }),
  },
  {
    id: 'ambiguous-region',
    title: '依据区域对应不明确',
    description: '远中颊侧为 AMBIGUOUS：不给逐点位移，结论为「无法可靠判断」。',
    modes: ASSIST_MODES,
    run: (ctx) => candidateFlow(ctx, { gate: 'ambiguous' }),
  },
  {
    id: 'tool-retry',
    title: '只读工具超时后重试',
    description: '历史检索第一次超时（无副作用，FAILED_NO_EFFECT），第二次成功；诊断中可见两次尝试。',
    modes: ASSIST_MODES,
    run: (ctx) => candidateFlow(ctx, { gate: 'pass', retryHistory: true }),
  },
  {
    id: 'in-doubt-write',
    title: '写入超时，结果不明',
    description: '批准后写入超时 → IN_DOUBT → 自动对账无法判断 → 需要人工确认是否生效。',
    modes: ['assist-execute'],
    run: (ctx) => candidateFlow(ctx, { gate: 'pass', writes: [{ inDoubt: true }, {}] }),
  },
  {
    id: 'base-version-changed',
    title: '审批后设计版本变化',
    description: '执行前核对发现基础版本变化 → 审批作废 → 基于新版本重新生成候选并重新审批。',
    modes: ['assist-execute'],
    run: (ctx) => candidateFlow(ctx, { gate: 'pass', writes: [{ baseChanged: true }, {}] }),
  },
  {
    id: 'missing-evidence',
    title: '证据校验失败',
    description: '设计版本证据哈希不一致 → BLOCKED(missing_evidence) → 人工说明后改写计划。',
    modes: ASSIST_MODES,
    run: (ctx) => candidateFlow(ctx, { gate: 'pass', missingEvidence: true }),
  },
  {
    id: 'budget-exhausted',
    title: '预算耗尽',
    description: '工具调用预算只有 4 次 → BLOCKED(budget)；界面不提供追加预算，只能取消。',
    modes: ASSIST_MODES,
    toolCallLimit: 4,
    run: (ctx) => candidateFlow(ctx, { gate: 'pass' }),
  },
  {
    id: 'research-challenge',
    title: '公开网页要求人工验证',
    description: 'offline-research：读取来源时遇到 CAPTCHA → BLOCKED(human_feedback) → 人工处理后继续或换来源。',
    modes: ['offline-research'],
    run: researchFlow,
  },
];

export function findScenario(id: ScenarioId): ScenarioDef {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario ${id}`);
  return s;
}

export function scenariosFor(mode: RunMode): ScenarioDef[] {
  return SCENARIOS.filter((s) => s.modes.includes(mode));
}

export function defaultScenarioFor(mode: RunMode): ScenarioDef {
  return scenariosFor(mode)[0] ?? findScenario('standard');
}
