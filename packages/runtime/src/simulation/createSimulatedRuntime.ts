/**
 * Assembles the simulated environment: synthetic dataset, synthetic CAD,
 * fixture Research Browser, scripted model, simulated tools, the M baseline
 * predictor, and scenario selection. Everything it reports is marked
 * simulated.
 */
import { RuntimeClientError, type IntegrationStatus, type RunMode, type RuntimePorts } from '@cadcopilot/contracts';
import { buildSyntheticDataset, type SyntheticDataset, type SyntheticDatasetOptions } from '@cadcopilot/data';
import { SimilarCaseRetrievalPredictor } from '@cadcopilot/research';
import { instantScheduler, type Scheduler } from '../engine/scheduler';
import type { DeploymentConfig } from '../host/environment';
import { InProcessRuntime } from '../host/inProcessRuntime';
import { FaultBook } from './faults';
import { FixtureResearchBrowser } from './fixtureResearchBrowser';
import { defaultScenarioFor, findScenario, scenariosFor, type ScenarioDef, type ScenarioId } from './scenarios';
import { ScriptedModelProvider } from './scriptedModel';
import { SyntheticCadAdapter } from './syntheticCad';
import { GATE_CRITERIA, createSimulatedTools } from './tools';

export const SIM_VERSIONS = {
  policy: 'policy-sim-0.2',
  gateCriteriaSet: 'gate-set-sim-0.1',
  registration: 'registration-draft-0.1',
  systemPrompt: 'prompt-sim-0.1',
};

export interface SimulatedRuntimeOptions {
  mode?: RunMode;
  scheduler?: Scheduler;
  /** Number of initial getDeployment() calls that fail, to exercise the error state. */
  failDeploymentTimes?: number;
  scenario?: ScenarioId;
  dataset?: SyntheticDatasetOptions;
}

/** Prototype-only controls; a production composition root has no equivalent. */
export interface SimulationControls {
  readonly scenarios: ReadonlyArray<Pick<ScenarioDef, 'id' | 'title' | 'description'>>;
  readonly scenarioId: ScenarioId;
  setScenario(id: ScenarioId): void;
  readonly generator: SyntheticDataset['generator'];
}

export interface SimulatedRuntime {
  runtime: InProcessRuntime;
  ports: RuntimePorts;
  controls: SimulationControls;
  dataset: SyntheticDataset;
  cad: SyntheticCadAdapter;
}

export function simulatedIntegrations(mode: RunMode): IntegrationStatus[] {
  return [
    { kind: 'runtime-transport', adapterId: 'runtime.in-process', label: 'Runtime 传输', implementation: 'simulated', detail: 'Runtime 在浏览器进程内运行；HTTP/SSE 传输只有占位实现。' },
    { kind: 'data-store', adapterId: 'data.in-memory-synthetic', label: '数据存储', implementation: 'simulated', detail: '内存存储 + 合成数据集；刷新页面即重置。' },
    { kind: 'cad', adapterId: 'cad.synthetic', label: 'CAD', implementation: 'simulated', detail: '合成 CAD 适配器（支持版本查询与条件写入，可注入故障）。真实 CAD 适配器只有占位实现，能力待接口审计。' },
    { kind: 'model-provider', adapterId: 'model.scripted', label: '模型', implementation: 'simulated', detail: '脚本叙述，不调用任何模型；调用记录按 05 §7.4 保存。' },
    {
      kind: 'research-browser',
      adapterId: 'research-browser.fixture',
      label: 'Research Browser',
      implementation: 'simulated',
      detail: mode === 'offline-research' ? 'fixture 结果；Research-Browser-MCP 是独立仓库，MCP 客户端只有占位实现。' : '当前模式不注册研究工具。',
    },
  ];
}

export function createSimulatedRuntime(options: SimulatedRuntimeOptions = {}): SimulatedRuntime {
  const mode = options.mode ?? 'assist-execute';
  const dataset = buildSyntheticDataset(options.dataset);
  const faults = new FaultBook();
  const cad = new SyntheticCadAdapter(dataset.store);
  const technician = dataset.store.getTechnician(dataset.currentTechnicianId)!;
  let scenario = options.scenario ? findScenario(options.scenario) : defaultScenarioFor(mode);
  if (!scenario.modes.includes(mode)) throw new RuntimeClientError('INVALID_REQUEST', `场景 ${scenario.id} 不适用于 ${mode} 模式`);

  const config: DeploymentConfig = {
    deploymentId: `deploy-sim-${mode}`,
    mode,
    simulated: true,
    cadConnected: false,
    policyVersion: SIM_VERSIONS.policy,
    gateCriteriaSetVersion: SIM_VERSIONS.gateCriteriaSet,
    registrationVersion: SIM_VERSIONS.registration,
    systemPromptVersion: SIM_VERSIONS.systemPrompt,
    requiredGateCriteria: GATE_CRITERIA.map((g) => g.criterionId),
    identity: { userId: technician.technicianId, displayName: technician.pseudonym, authenticated: false },
    // Research queries may go to the (fixture) Research Browser; nothing case-related leaves the Runtime.
    egressAllowed: ['public_query'],
    budget: { rounds: 6, replans: 4, toolCalls: 40 },
    integrations: simulatedIntegrations(mode),
  };

  const runtime = new InProcessRuntime({
    config,
    data: dataset.store,
    tools: createSimulatedTools({
      store: dataset.store,
      cad,
      browser: new FixtureResearchBrowser(),
      faults,
      predictor: new SimilarCaseRetrievalPredictor('M', 5),
      gateCriteriaSetVersion: SIM_VERSIONS.gateCriteriaSet,
    }),
    model: new ScriptedModelProvider(),
    scheduler: options.scheduler ?? instantScheduler,
    ...(options.failDeploymentTimes !== undefined ? { failDeploymentTimes: options.failDeploymentTimes } : {}),
    setupTask: (context) => {
      faults.set(context.taskId, scenario.faults);
      return { agent: scenario.agent(), ...(scenario.budget ? { budget: scenario.budget } : {}), label: `scenario=${scenario.id}` };
    },
  });

  const controls: SimulationControls = {
    scenarios: scenariosFor(mode).map(({ id, title, description }) => ({ id, title, description })),
    get scenarioId() {
      return scenario.id;
    },
    setScenario(id) {
      const next = findScenario(id);
      if (!next.modes.includes(mode)) throw new RuntimeClientError('INVALID_REQUEST', `场景 ${id} 不适用于 ${mode} 模式`);
      scenario = next;
    },
    generator: dataset.generator,
  };

  return { runtime, ports: runtime.ports(), controls, dataset, cad };
}
