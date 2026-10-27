/**
 * Simulated scenarios. A scenario is an environment (fault plan, budget) plus
 * the agent that runs in it; it does not script task or step states. What the
 * user sees comes from the engine reacting to the environment.
 */
import type { RunMode } from '@cadcopilot/contracts';
import type { Agent } from '@cadcopilot/agent-tools';
import type { BudgetLimits } from '../host/environment';
import { ScriptedCandidateAgent } from './agents/candidateAgent';
import { ScriptedResearchAgent } from './agents/researchAgent';
import type { FaultPlan } from './faults';

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
  faults: FaultPlan;
  budget?: Partial<BudgetLimits>;
  agent: () => Agent;
}

const ASSIST_MODES: RunMode[] = ['assist-execute', 'assist'];
const candidate = () => new ScriptedCandidateAgent();

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'standard',
    title: '标准流程',
    description: '没有注入故障。assist-execute：候选通过质量闸门 → 等待审批 → 条件写入；assist：只展示建议。',
    modes: ASSIST_MODES,
    faults: {},
    agent: candidate,
  },
  {
    id: 'gate-failed',
    title: '偏好高，但未通过质量闸门',
    description: '表面贴合 P95 = 63 μm（模拟阈值 40 μm）：Policy Gate 拒绝以可采纳形式展示，只给诊断与区域提示。',
    modes: ASSIST_MODES,
    faults: { surfaceFitP95Um: 63 },
    agent: candidate,
  },
  {
    id: 'ambiguous-region',
    title: '依据区域对应不明确',
    description: '远中颊侧为 AMBIGUOUS：Predictor 不给该区域逐点位移，闸门不可评价，结论为「无法可靠判断」。',
    modes: ASSIST_MODES,
    faults: { ambiguousRegions: ['r-db'] },
    agent: candidate,
  },
  {
    id: 'tool-retry',
    title: '只读工具超时后重试',
    description: '历史检索第一次超时（无副作用，FAILED_NO_EFFECT），Runtime 在 max_attempts 内自动重试。',
    modes: ASSIST_MODES,
    faults: { toolFaults: { 'memory.query_history': ['timeout'] } },
    agent: candidate,
  },
  {
    id: 'in-doubt-write',
    title: '写入后回复丢失，结果不明',
    description: '写入已生效但回复丢失，版本查询也暂时失败 → IN_DOUBT → 自动对账无法判断 → 人工确认。',
    modes: ['assist-execute'],
    faults: { cad: { firstWriteOutcomeUnknown: true } },
    agent: candidate,
  },
  {
    id: 'base-version-changed',
    title: '审批期间设计被修改',
    description: '审批等待期间负责牙技师在 CAD 中改了设计：执行前核对不一致 → 审批作废 → 基于新版本重新生成并重新审批。',
    modes: ['assist-execute'],
    faults: { cad: { concurrentEditBeforeFirstWrite: true } },
    agent: candidate,
  },
  {
    id: 'missing-evidence',
    title: '证据校验失败',
    description: '读取设计版本时证据哈希不一致 → BLOCKED(missing_evidence) → 人工说明后改写计划。',
    modes: ASSIST_MODES,
    faults: { toolFaults: { 'cad.read_design_version': ['data_unavailable'] } },
    agent: candidate,
  },
  {
    id: 'budget-exhausted',
    title: '预算耗尽',
    description: '工具调用预算只有 4 次 → BLOCKED(budget)；界面不提供追加预算，只能取消。',
    modes: ASSIST_MODES,
    faults: {},
    budget: { toolCalls: 4 },
    agent: candidate,
  },
  {
    id: 'research-challenge',
    title: '公开网页要求人工验证',
    description: 'offline-research：第一次读取页面遇到 CAPTCHA → BLOCKED(human_feedback) → 人工处理后继续或换来源。',
    modes: ['offline-research'],
    faults: { research: { challengeOnFirstFetch: true } },
    agent: () => new ScriptedResearchAgent(),
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
