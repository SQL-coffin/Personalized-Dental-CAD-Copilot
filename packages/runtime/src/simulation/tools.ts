/**
 * Simulated implementations of the catalogued tools. They work on the
 * synthetic dataset, the synthetic CAD adapter and the research baselines,
 * so a task's results come from data rather than from a script; injected
 * faults (faults.ts) make them misbehave on purpose.
 */
import type { CandidateRegion, GateCriterionResult, QualityGateResult } from '@cadcopilot/contracts';
import {
  TOOL_CATALOG,
  type ArchiveInput,
  type CandidateInput,
  type CorrespondenceInput,
  type CorrespondenceOutput,
  type DisplayOutput,
  type GateOutput,
  type HistoryQueryInput,
  type HistoryQueryOutput,
  type PredictInput,
  type PredictOutput,
  type ReadDesignInput,
  type ReadDesignOutput,
  type ResearchBrowserPort,
  type ResearchFetchInput,
  type ResearchFetchOutput,
  type ResearchSearchInput,
  type ResearchSearchOutput,
  type ToolContext,
  type ToolImplementation,
  type ToolResult,
  type WriteOutput,
} from '@cadcopilot/agent-tools';
import { FRAME_VERSION, MARGIN_REGIONS, type DataStore } from '@cadcopilot/data';
import { buildHistoryView, type Predictor } from '@cadcopilot/research';
import type { FaultBook } from './faults';
import type { SyntheticCadAdapter } from './syntheticCad';

export const GATE_CRITERIA: ReadonlyArray<{ criterionId: string; label: string }> = [
  { criterionId: 'closed_curve', label: '曲线闭合' },
  { criterionId: 'self_intersection', label: '无自交' },
  { criterionId: 'surface_fit', label: '表面贴合（点到面距离 P95）' },
  { criterionId: 'correspondence_validity', label: '依据区域的曲线对应' },
];
export const SURFACE_FIT_THRESHOLD_UM = 40;

const DIRECTION = { apical: '向龈方', coronal: '向冠方', uncertain: '方向不确定' } as const;

export interface SimulatedToolDeps {
  store: DataStore;
  cad: SyntheticCadAdapter;
  browser: ResearchBrowserPort;
  faults: FaultBook;
  predictor: Predictor;
  gateCriteriaSetVersion: string;
}

const fail = (code: 'TIMEOUT' | 'DATA_UNAVAILABLE' | 'INVALID_INPUT', message: string): ToolResult<never> => ({ ok: false, error: { code, message, effect: 'none' } });

function injected(deps: SimulatedToolDeps, ctx: ToolContext, toolId: string, dataMessage: string): ToolResult<never> | null {
  const f = deps.faults.nextToolFault(ctx.taskId, toolId);
  if (f === 'timeout') return fail('TIMEOUT', '调用超时（模拟）；该工具无副作用，可以在 max_attempts 内重试');
  if (f === 'data_unavailable') return fail('DATA_UNAVAILABLE', dataMessage);
  return null;
}

export function createSimulatedTools(deps: SimulatedToolDeps): ToolImplementation[] {
  const { store, cad, browser, faults } = deps;

  const readDesign: ToolImplementation<ReadDesignInput, ReadDesignOutput> = {
    definition: TOOL_CATALOG.readDesign,
    async execute(input, ctx) {
      const head = store.headVersion(input.caseId);
      const fault = injected(deps, ctx, this.definition.toolId, `设计版本 ${head?.versionId ?? '?'} 的证据负载哈希校验失败（模拟）`);
      if (fault) return fault;
      const design = await cad.readDesign(input.caseId);
      return { ok: true, output: design, summary: `设计版本 ${design.version.versionId}，哈希校验通过` };
    },
  };

  const correspondence: ToolImplementation<CorrespondenceInput, CorrespondenceOutput> = {
    definition: TOOL_CATALOG.correspondence,
    async execute(input, ctx) {
      const fault = injected(deps, ctx, this.definition.toolId, `版本 ${input.versionId} 的几何负载不可用（模拟）`);
      if (fault) return fault;
      const ambiguous = new Set(faults.get(ctx.taskId).ambiguousRegions ?? []);
      const regions = MARGIN_REGIONS.map((r) => ({ ...r, correspondence: ambiguous.has(r.regionId) ? ('AMBIGUOUS' as const) : ('MATCHED' as const) }));
      return { ok: true, output: { regions }, summary: regions.map((r) => `${r.label} ${r.correspondence}`).join('；') };
    },
  };

  const queryHistory: ToolImplementation<HistoryQueryInput, HistoryQueryOutput> = {
    definition: TOOL_CATALOG.queryHistory,
    async execute(input, ctx) {
      const fault = injected(deps, ctx, this.definition.toolId, '历史记录不可用（模拟）');
      if (fault) return fault;
      const view = buildHistoryView(store, { pool: { kind: 'same_technician', technicianId: input.technicianId }, asOf: input.asOf, excludePatients: input.excludePatients });
      const samePatient = view.excluded.filter((e) => e.reason === 'excluded_patient').length;
      return {
        ok: true,
        output: { caseIds: view.cases.map((c) => c.caseId), excluded: view.excluded.filter((e) => e.reason !== 'not_in_pool') },
        summary: `返回 ${view.cases.length} 个满足 as_of 与患者排除条件的历史病例${samePatient ? `（排除 ${samePatient} 个同一患者的病例）` : ''}`,
      };
    },
  };

  const predictor: ToolImplementation<PredictInput, PredictOutput> = {
    definition: TOOL_CATALOG.predictor,
    async execute(input, ctx) {
      const record = store.getCase(input.caseId);
      if (!record || !ctx.technicianId) return fail('INVALID_INPUT', `病例 ${input.caseId} 不存在或未分配`);
      const history = buildHistoryView(store, {
        pool: { kind: 'same_technician', technicianId: ctx.technicianId },
        asOf: ctx.asOf,
        excludePatients: [record.patientPseudonym],
      });
      const result = deps.predictor.predict(
        { caseId: record.caseId, technicianId: ctx.technicianId, patientPseudonym: record.patientPseudonym, covariates: record.covariates, regions: input.regions },
        history,
        input.adjustment ? { magnitudeScale: input.adjustment.magnitudeScale } : {},
      );
      const regions: CandidateRegion[] = result.regions.map((r) => ({
        regionId: r.regionId,
        label: r.label,
        t: r.t,
        correspondence: r.correspondence,
        ...(r.changed && r.displacement ? { displacement: r.displacement } : {}),
      }));
      const basis = result.regions.filter((r) => r.changed);
      const samples = basis.filter((r) => r.correspondence === 'MATCHED' && r.profile).flatMap((r) => r.profile!);
      const primary = [...basis].sort((a, b) => (b.displacement?.maxUm ?? 0) - (a.displacement?.maxUm ?? 0))[0];
      const evidence = result.neighbors.flatMap((n) => {
        const row = history.cases.find((c) => c.caseId === n.caseId);
        const region = row?.finalDelta.regions.find((r) => r.regionId === primary?.regionId);
        if (!row || !region || !primary) return [];
        const stance: 'supports' | 'opposes' = region.displacement?.direction === primary.displacement?.direction ? 'supports' : 'opposes';
        const change = region.displacement ? `${DIRECTION[region.displacement.direction]} ${region.displacement.maxUm} μm` : `对应 ${region.correspondence}`;
        return [{ caseId: row.caseId, stance, summary: `历史病例 ${row.caseId}：${region.label}${change}（相似度 ${n.similarity}）` }];
      });
      const def = this.definition;
      return {
        ok: true,
        output: {
          proposal: {
            caseId: record.caseId,
            baseVersion: { ...input.base, scope: TOOL_CATALOG.writeMarginLine.baseScope ? [...TOOL_CATALOG.writeMarginLine.baseScope] : ['margin_line'] },
            regions,
            geometry: samples.length ? { kind: 'margin_line_displacement', frameVersion: FRAME_VERSION, samples } : null,
            basisRegionIds: basis.map((r) => r.regionId),
            preference: { ...result.preference, basis: `${result.preference.basis}；合成数据`, predictor: { id: def.toolId, version: def.version } },
            provenance: {
              predictor: { id: `${def.toolId}/${result.predictorId}`, version: `${def.version}/${result.version}` },
              geometryEngine: { id: 'geometry-engine-sim', version: '0.1.0-sim' },
              paramsHash: result.paramsHash,
            },
            evidence,
          },
        },
        summary: `候选 1 个（${result.condition}，${result.neighbors.length}/${result.historySize} 个历史病例）；偏好估计已写入 Record Store`,
      };
    },
  };

  const qualityGate: ToolImplementation<CandidateInput, GateOutput> = {
    definition: TOOL_CATALOG.qualityGate,
    async execute(input, ctx) {
      const c = ctx.candidates.get(input.candidateId);
      if (!c) return fail('INVALID_INPUT', `候选 ${input.candidateId} 不存在`);
      const p95 = faults.get(ctx.taskId).surfaceFitP95Um ?? 18;
      const unmatched = c.proposal.regions.filter((r) => c.proposal.basisRegionIds.includes(r.regionId) && r.correspondence !== 'MATCHED');
      const label = (id: string) => GATE_CRITERIA.find((g) => g.criterionId === id)!.label;
      const results: GateCriterionResult[] = [
        { criterionId: 'closed_curve', label: label('closed_curve'), evaluationValidity: 'evaluable', qualityResult: 'pass' },
        { criterionId: 'self_intersection', label: label('self_intersection'), evaluationValidity: 'evaluable', qualityResult: 'pass' },
        {
          criterionId: 'surface_fit',
          label: label('surface_fit'),
          evaluationValidity: 'evaluable',
          qualityResult: p95 <= SURFACE_FIT_THRESHOLD_UM ? 'pass' : 'fail',
          detail: `P95 = ${p95} μm（模拟阈值 ${SURFACE_FIT_THRESHOLD_UM} μm）`,
        },
        unmatched.length
          ? {
              criterionId: 'correspondence_validity',
              label: label('correspondence_validity'),
              evaluationValidity: 'not_evaluable',
              qualityResult: 'not_evaluated',
              detail: `${unmatched.map((r) => r.label).join('、')}区域为 ${unmatched.map((r) => r.correspondence).join('、')}（02 §6.3）`,
            }
          : { criterionId: 'correspondence_validity', label: label('correspondence_validity'), evaluationValidity: 'evaluable', qualityResult: 'pass', detail: '依据区域均为 MATCHED' },
      ];
      const passed = results.every((r) => r.evaluationValidity === 'evaluable' && r.qualityResult === 'pass');
      const gate: QualityGateResult = {
        gateRef: `gate://${ctx.taskId}/${input.candidateId}`,
        criteriaSetVersion: deps.gateCriteriaSetVersion,
        requiredCriteria: GATE_CRITERIA.map((g) => g.criterionId),
        results,
        passed,
        evaluatedAt: new Date().toISOString(),
      };
      const issues = results.filter((r) => !(r.evaluationValidity === 'evaluable' && r.qualityResult === 'pass'));
      return {
        ok: true,
        output: gate,
        summary: passed ? `${results.length}/${results.length} 项可评价且通过` : issues.map((r) => `${r.label}：${r.evaluationValidity === 'not_evaluable' ? '不可评价' : '未通过'}`).join('；'),
      };
    },
  };

  const displayCandidate: ToolImplementation<CandidateInput, DisplayOutput> = {
    definition: TOOL_CATALOG.displayCandidate,
    async execute(input) {
      return { ok: true, output: { candidateId: input.candidateId, presentation: 'adoptable' }, summary: '候选已以可采纳形式展示' };
    },
  };

  const displayRegionHint: ToolImplementation<CandidateInput, DisplayOutput & { hint: string }> = {
    definition: TOOL_CATALOG.displayRegionHint,
    async execute(input, ctx) {
      const c = ctx.candidates.get(input.candidateId);
      if (!c) return fail('INVALID_INPUT', `候选 ${input.candidateId} 不存在`);
      const basis = c.proposal.regions.filter((r) => c.proposal.basisRegionIds.includes(r.regionId));
      const unmatched = basis.filter((r) => r.correspondence !== 'MATCHED');
      const failing = c.gate?.results.filter((r) => r.qualityResult === 'fail') ?? [];
      const hint = unmatched.length
        ? `${unmatched.map((r) => r.label).join('、')}区域的曲线对应不明确（${unmatched[0]!.correspondence}），不给出逐点位移，只提示该区域可能需要关注。`
        : failing.length
          ? `${basis.map((r) => r.label).join('、') || '这些'}区域符合你过去的修改习惯，但候选未通过「${failing.map((r) => r.label).join('、')}」检查，因此不附候选几何。`
          : '质量闸门结果不完整或候选没有可展示的逐点几何，按未通过处理，不附候选几何。';
      return { ok: true, output: { candidateId: input.candidateId, presentation: 'diagnostic', hint }, summary: '已展示诊断与区域提示（不含候选几何）' };
    },
  };

  const archiveDecision: ToolImplementation<ArchiveInput, null> = {
    definition: TOOL_CATALOG.archiveDecision,
    async execute() {
      return { ok: true, output: null, summary: '被拒绝的建议已存档' };
    },
  };

  const writeMarginLine: ToolImplementation<CandidateInput, WriteOutput> = {
    definition: TOOL_CATALOG.writeMarginLine,
    async readBase(_input, ctx) {
      const caseId = ctx.caseId!;
      if (faults.once(ctx.taskId, 'cad.concurrentEdit', faults.get(ctx.taskId).cad?.concurrentEditBeforeFirstWrite)) cad.simulateTechnicianEdit(caseId);
      return cad.queryVersion(caseId);
    },
    async execute(input, ctx) {
      const c = ctx.candidates.get(input.candidateId);
      if (!c?.proposal.geometry || !ctx.caseId || !ctx.approvalId) return fail('INVALID_INPUT', '写入需要病例、审批与可采纳的候选几何');
      if (faults.once(ctx.taskId, 'cad.loseReply', faults.get(ctx.taskId).cad?.firstWriteOutcomeUnknown)) cad.loseNextReply(ctx.caseId);
      const base = c.proposal.baseVersion.versionId;
      const r = await cad.conditionalWrite({
        caseId: ctx.caseId,
        baseVersionId: base,
        candidateHash: c.candidateHash,
        geometry: c.proposal.geometry,
        approvalId: ctx.approvalId,
        taskId: ctx.taskId,
        intentId: `${ctx.taskId}/${ctx.stepId}/${ctx.attempt}`,
      });
      if (r.status === 'applied') return { ok: true, output: { newVersion: r.newVersion }, summary: `条件写入成功；新版本 ${r.newVersion.versionId}；写后读取一致` };
      return {
        ok: false,
        error: { code: 'BASE_VERSION_CHANGED', message: `条件写入被拒：目标对象已是 ${r.currentVersion.versionId}，不是基础版本 ${base}`, effect: 'none' },
      };
    },
    async reconcile(input, ctx) {
      const c = ctx.candidates.get(input.candidateId);
      if (!ctx.caseId || !c) return 'unknown';
      try {
        const current = await cad.queryVersion(ctx.caseId);
        const version = store.getVersion(ctx.caseId, current.versionId);
        if (version?.origin.kind === 'copilot_execution' && version.origin.approvalId === ctx.approvalId) return 'applied';
        return current.versionId === c.proposal.baseVersion.versionId ? 'not_applied' : 'unknown';
      } catch {
        return 'unknown';
      }
    },
  };

  const researchSearch: ToolImplementation<ResearchSearchInput, ResearchSearchOutput> = {
    definition: TOOL_CATALOG.researchSearch,
    async execute(input) {
      const results = await browser.search(input);
      return { ok: true, output: { results }, summary: `返回 ${results.length} 条来源线索（模拟）` };
    },
  };

  const researchFetch: ToolImplementation<ResearchFetchInput, ResearchFetchOutput> = {
    definition: TOOL_CATALOG.researchFetch,
    async execute(input, ctx) {
      if (faults.once(ctx.taskId, 'research.challenge', faults.get(ctx.taskId).research?.challengeOnFirstFetch)) {
        return {
          ok: true,
          output: {
            status: 'human_verification_required',
            sourceUrl: input.url,
            finalUrl: input.url,
            title: '',
            retrievedAt: new Date().toISOString(),
            content: '',
            challengeType: 'captcha',
            evidenceRef: null,
            warnings: ['访问挑战：系统不会自动求解或绕过（06 §3）'],
          },
          summary: 'status = human_verification_required；challenge_type = captcha',
        };
      }
      const page = await browser.fetchPublicPage(input);
      return { ok: true, output: page, summary: `status = ${page.status}${page.status === 'success' ? '；已保存为只追加 Evidence（模拟）' : ''}` };
    },
  };

  return [
    readDesign,
    correspondence,
    queryHistory,
    predictor,
    qualityGate,
    displayCandidate,
    displayRegionHint,
    archiveDecision,
    writeMarginLine,
    researchSearch,
    researchFetch,
  ] as ToolImplementation[];
}
