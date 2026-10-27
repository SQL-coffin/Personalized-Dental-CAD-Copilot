/**
 * Scripted stand-in for the Research Engine in assist modes. It plans the
 * candidate workflow and reacts to step results; it never decides a state.
 * It deliberately tries to display every candidate in adoptable form and
 * leaves it to the Policy Gate to refuse a candidate that failed the gate,
 * so that the fail-closed path is exercised for real.
 */
import type { EvidenceRef, TaskOutcome } from '@cadcopilot/contracts';
import {
  TOOL_CATALOG,
  type Agent,
  type AgentSession,
  type CandidateInput,
  type CorrespondenceOutput,
  type HistoryQueryOutput,
  type PlanStepSpec,
  type PredictInput,
  type PredictOutput,
  type ReadDesignOutput,
  type RegionCorrespondence,
  type StepRunResult,
  type WriteOutput,
} from '@cadcopilot/agent-tools';

const S = {
  read: { key: 'read', title: TOOL_CATALOG.readDesign.title, purpose: '读取 margin line 及其依赖对象（预备体网格）的当前版本与哈希', toolId: TOOL_CATALOG.readDesign.toolId },
  corr: { key: 'corr', title: TOOL_CATALOG.correspondence.title, purpose: '按区域计算当前曲线与 AI 初始设计 S_0 的对应状态（MATCHED / AMBIGUOUS / UNMATCHED）', toolId: TOOL_CATALOG.correspondence.toolId },
  history: { key: 'history', title: TOOL_CATALOG.queryHistory.title, purpose: '检索负责牙技师在本病例之前的已确认病例（as_of 截止、排除同一患者）', toolId: TOOL_CATALOG.queryHistory.toolId },
  predict: { key: 'predict', title: TOOL_CATALOG.predictor.title, purpose: '调用冻结版本的个人检索 Predictor 生成候选几何与偏好估计', toolId: TOOL_CATALOG.predictor.toolId },
  gate: { key: 'gate', title: TOOL_CATALOG.qualityGate.title, purpose: '按登记的闸门标准集逐项检查候选；缺少任何一项结果都视为未通过', toolId: TOOL_CATALOG.qualityGate.toolId },
  display: { key: 'display', title: TOOL_CATALOG.displayCandidate.title, purpose: '只有通过质量闸门的候选才能以可采纳形式展示', toolId: TOOL_CATALOG.displayCandidate.toolId },
  hint: { key: 'hint', title: TOOL_CATALOG.displayRegionHint.title, purpose: '展示未通过的检查项与区域提示，不附候选几何', toolId: TOOL_CATALOG.displayRegionHint.toolId },
  write: { key: 'write', title: TOOL_CATALOG.writeMarginLine.title, purpose: '经牙技师逐次批准后，以条件写入方式把候选写入 CAD；执行前核对基础版本', toolId: TOOL_CATALOG.writeMarginLine.toolId, maxAttempts: 2 },
  archive: { key: 'archive', title: TOOL_CATALOG.archiveDecision.title, purpose: '存档被拒绝的候选，供相似情境下抑制重复推荐', toolId: TOOL_CATALOG.archiveDecision.toolId },
} satisfies Record<string, PlanStepSpec>;

const DIRECTION = { apical: '向龈方', coronal: '向冠方', uncertain: '' } as const;

type Shown =
  | { kind: 'adoptable'; candidateId: string }
  | { kind: 'diagnostic'; candidateId: string; unableToJudge: boolean }
  | { kind: 'stopped'; result: Exclude<StepRunResult, { kind: 'succeeded' }> };

export class ScriptedCandidateAgent implements Agent {
  readonly agentId = 'research-engine.scripted';
  readonly version = '0.2.0-sim';

  async run(s: AgentSession): Promise<void> {
    const c = s.context.caseSummary;
    if (!c) throw new Error('candidate agent needs a case');
    const canWrite = s.context.registeredToolIds.includes(S.write.toolId);
    const analysis = (withWrite: boolean): PlanStepSpec[] => [S.read, S.corr, S.history, S.predict, S.gate, S.display, ...(withWrite ? [S.write] : [])];

    await s.beginPlanning();
    await s.think(400);
    await s.say(
      `我会读取 ${c.tooth} 号牙 margin line 的当前版本，按区域计算与 AI 初始设计 S_0 的对应，检索你过去的修正记录，再用冻结版本的 Predictor 生成候选，并在展示前运行质量闸门。` +
        (canWrite ? '写入 CAD 之前会请你逐次批准。' : '当前部署没有写入 CAD 的工具，我只会给出建议。'),
    );
    let ids = s.writePlan(analysis(canWrite));
    s.execute();

    let read = await s.runStep<{ caseId: string }, ReadDesignOutput>(ids.read!, { caseId: c.caseId });
    while (read.kind === 'replan_requested') {
      await s.say(`按你的说明改写计划：「${read.note}」。重新读取并校验设计版本。`);
      ids = s.writePlan(analysis(canWrite), '证据缺失，按人工说明改写计划');
      s.execute();
      read = await s.runStep<{ caseId: string }, ReadDesignOutput>(ids.read!, { caseId: c.caseId });
    }
    if (read.kind !== 'succeeded') return this.stop(s, read, '读取设计版本');

    const corr = await s.runStep<{ caseId: string; versionId: string }, CorrespondenceOutput>(ids.corr!, { caseId: c.caseId, versionId: read.output.version.versionId });
    if (corr.kind !== 'succeeded') return this.stop(s, corr, '计算区域对应');
    const history = await s.runStep<unknown, HistoryQueryOutput>(ids.history!, {
      technicianId: s.context.technicianId,
      asOf: s.context.asOf,
      excludePatients: [c.patientPseudonym],
    });
    if (history.kind !== 'succeeded') return this.stop(s, history, '检索修正历史');

    let base = read.output.version;
    let regions: RegionCorrespondence[] = corr.output.regions;
    let shown = await this.proposeAndShow(s, ids, { caseId: c.caseId, base, regions });
    if (shown.kind === 'stopped') return this.stop(s, shown.result, '生成候选');
    if (shown.kind === 'diagnostic') {
      return this.finish(
        s,
        shown.unableToJudge
          ? '结论：无法可靠判断。依据区域的对应不明确，只给出区域提示。未写入 CAD。'
          : '未产生可采纳的候选。已展示未通过的检查项和区域提示。未写入 CAD。',
        'none',
        '验证：已展示的内容不含候选几何；闸门结论未被偏好值改变。',
      );
    }
    if (!canWrite) {
      return this.finish(s, '已展示候选（S 级建议）。当前部署未注册写入 CAD 的工具；如需采用，请在 CAD 中手动修改。未写入 CAD。', 'none', '验证：候选已展示，闸门结果与偏好估计已分别记录。');
    }

    let candidateId = shown.candidateId;
    let writeStep = ids.write!;
    for (;;) {
      const w = await s.runStep<CandidateInput, WriteOutput>(writeStep, { candidateId });
      if (w.kind === 'succeeded') {
        const version = w.output?.newVersion.versionId;
        return this.finish(
          s,
          `${w.reconciled ? '经对账确认，' : ''}已按批准把候选 ${candidateId} 写入 CAD${version ? `（新版本 ${version}）` : ''}。这不代表最终设计已放行：请在 CAD 中检查并自行确认最终设计。`,
          'applied',
          w.reconciled ? '验证：按对账结果记录写入已生效。' : '验证：写后读取的版本与候选一致；对应状态与闸门结果已记录。',
        );
      }

      if (w.kind === 'denied' && w.humanDecision?.decision === 'reject') {
        await s.say('已记录你的拒绝。我会把这条建议存档，在相似情境下抑制重复推荐，不再继续写入。');
        const rec = s.writePlan([S.archive], '审批被拒绝');
        s.execute();
        await s.runStep(rec.archive!, { candidateId, reason: w.humanDecision.note ?? '牙技师拒绝' });
        return this.finish(s, '候选已被拒绝并存档。未写入 CAD。', 'none', '验证：没有任何写入 CAD 的调用被执行。');
      }

      if (w.kind === 'denied' && w.humanDecision?.decision === 'revise') {
        await s.say(
          `按你的修改意见重新生成候选：「${w.humanDecision.note ?? ''}」。（模拟：脚本把修改意见解释为把位移幅度缩小三分之一。）新候选需要重新通过质量闸门，并重新申请审批。`,
        );
        ids = s.writePlan([S.predict, S.gate, S.display, S.write], '牙技师要求修改方案');
        s.execute();
        shown = await this.proposeAndShow(s, ids, { caseId: c.caseId, base, regions, adjustment: { magnitudeScale: 2 / 3, note: w.humanDecision.note ?? '' } });
      } else if (w.kind !== 'replan_requested' && w.code === 'BASE_VERSION_CHANGED') {
        await s.say(`${w.message}。原审批已作废。我会基于新版本重新读取、重新生成并验证候选，再请你重新审批。`);
        ids = s.writePlan([S.read, S.corr, S.predict, S.gate, S.display, S.write], '执行前核对发现基础版本变化');
        s.execute();
        const reread = await s.runStep<{ caseId: string }, ReadDesignOutput>(ids.read!, { caseId: c.caseId });
        if (reread.kind !== 'succeeded') return this.stop(s, reread, '重新读取设计版本');
        const recorr = await s.runStep<{ caseId: string; versionId: string }, CorrespondenceOutput>(ids.corr!, { caseId: c.caseId, versionId: reread.output.version.versionId });
        if (recorr.kind !== 'succeeded') return this.stop(s, recorr, '重新计算区域对应');
        base = reread.output.version;
        regions = recorr.output.regions;
        shown = await this.proposeAndShow(s, ids, { caseId: c.caseId, base, regions });
      } else {
        return this.stop(s, w, '写入 CAD');
      }

      if (shown.kind === 'stopped') return this.stop(s, shown.result, '重新生成候选');
      if (shown.kind === 'diagnostic') return this.finish(s, '重新生成的候选未通过质量闸门。已展示诊断信息。未写入 CAD。', 'none', '验证：没有可采纳的候选被写入。');
      candidateId = shown.candidateId;
      writeStep = ids.write!;
    }
  }

  /** predict → gate → display, falling back to a diagnostic hint when the Policy Gate refuses. */
  private async proposeAndShow(s: AgentSession, ids: Record<string, string>, input: PredictInput): Promise<Shown> {
    const pred = await s.runStep<PredictInput, PredictOutput>(ids.predict!, input);
    if (pred.kind !== 'succeeded' || !pred.candidateId) return { kind: 'stopped', result: pred.kind === 'succeeded' ? { kind: 'failed', code: 'TOOL_ERROR', message: '没有生成候选' } : pred };
    const candidateId = pred.candidateId;
    const gate = await s.runStep(ids.gate!, { candidateId });
    if (gate.kind !== 'succeeded') return { kind: 'stopped', result: gate };

    const display = await s.runStep(ids.display!, { candidateId });
    const info = s.candidate(candidateId)!;
    const gateRef: EvidenceRef = { ref: info.gate?.gateRef ?? 'gate://none', label: '闸门结果' };
    if (display.kind === 'succeeded') {
      this.recordDecision(s, candidateId, 'adoptable', false);
      await s.say(
        `候选 ${candidateId} 已通过质量闸门（标准集 ${info.gate?.criteriaSetVersion}）。偏好估计和质量结果分开列在审阅面板中；通过闸门不代表临床或制造质量合格。`,
        [gateRef, { ref: `record://${s.context.taskId}/${candidateId}`, label: '候选记录' }],
      );
      return { kind: 'adoptable', candidateId };
    }
    if (display.kind !== 'denied') return { kind: 'stopped', result: display };

    // The task is back in PLANNING: the Policy Gate refused an adoptable display.
    await s.say('候选未通过质量闸门，改为只展示诊断信息与区域提示。', [gateRef]);
    const hintIds = s.writePlan([S.hint], `展示步骤被 Policy Gate 拒绝：${display.message}`);
    s.execute();
    const hint = await s.runStep(hintIds.hint!, { candidateId });
    if (hint.kind !== 'succeeded') return { kind: 'stopped', result: hint };
    const unableToJudge = info.gate?.results.some((r) => r.evaluationValidity === 'not_evaluable') ?? false;
    this.recordDecision(s, candidateId, 'diagnostic', unableToJudge);
    return { kind: 'diagnostic', candidateId, unableToJudge };
  }

  private recordDecision(s: AgentSession, candidateId: string, presentation: 'adoptable' | 'diagnostic', unableToJudge: boolean): void {
    const info = s.candidate(candidateId)!;
    const p = info.proposal;
    const basis = p.regions.filter((r) => p.basisRegionIds.includes(r.regionId));
    const main = basis.find((r) => r.displacement) ?? basis[0];
    const failing = info.gate?.results.filter((r) => !(r.evaluationValidity === 'evaluable' && r.qualityResult === 'pass')) ?? [];
    s.recordDecision({
      observations: [
        { ref: `obs://${s.context.taskId}/correspondence`, label: `区域对应：${p.regions.map((r) => `${r.label} ${r.correspondence}`).join('，')}` },
        { ref: `obs://${s.context.taskId}/design`, label: `当前设计版本 ${p.baseVersion.versionId}` },
      ],
      hypothesis: main
        ? `${main.label} margin line 可能需要${main.displacement ? DIRECTION[main.displacement.direction] : ''}调整（工作假设，未验证）`
        : '没有区域达到可测变化阈值（工作假设，未验证）',
      evidence: p.evidence.map((e) => ({ ref: `case://${e.caseId}`, label: e.summary, stance: e.stance })),
      alternatives: [
        { label: '不修改（A0）', whyNot: `相似历史病例中 ${p.evidence.filter((e) => e.stance === 'supports').length}/${p.evidence.length} 个在该区域做了同向修改` },
        { label: '只调整次要区域', whyNot: '次要区域的变化接近噪声阈值，单独调整意义不大' },
      ],
      candidateId,
      rationale:
        presentation === 'adoptable'
          ? '候选来自冻结版本 Predictor，所有闸门检查项均可评价且通过；偏好估计与质量结果分别给出。'
          : unableToJudge
            ? '依据区域对应不明确，「依据区域的曲线对应」检查不可评价；按闸门规则视为未通过。'
            : `闸门未通过（${failing.map((r) => r.label).join('、')}）；按闸门规则不以可采纳形式展示。偏好值不改变这一结论。`,
      uncertainty: `偏好估计 ${p.preference.score.toFixed(2)}（区间 ${p.preference.interval[0]}–${p.preference.interval[1]}），基于合成数据上的少量历史病例；未经过预登记评估。`,
      outcome: presentation === 'adoptable' ? '建议：按候选调整，待牙技师决定' : unableToJudge ? '无法可靠判断' : '不推荐执行：候选未通过质量闸门',
      unableToJudge,
    });
  }

  private async finish(s: AgentSession, summary: string, cadWrite: TaskOutcome['cadWrite'], verify: string): Promise<void> {
    await s.complete({ summary, cadWrite }, verify);
  }

  /** After a non-success result the task is in PLANNING: close it with an empty plan. */
  private async stop(s: AgentSession, result: Exclude<StepRunResult, { kind: 'succeeded' }>, phase: string): Promise<void> {
    const detail = 'message' in result ? result.message : result.note;
    await s.say(`无法继续：${phase}没有成功（${detail}）。`);
    s.writePlan([], `${phase}没有成功，结束任务`);
    s.execute();
    await this.finish(s, `任务结束：${phase}没有成功。未写入 CAD。`, 'none', '验证：没有写入 CAD 的调用被执行。');
  }
}
