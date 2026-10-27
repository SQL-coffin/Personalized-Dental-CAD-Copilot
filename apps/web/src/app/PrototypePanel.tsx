import type { RunMode } from '@cadcopilot/contracts';
import type { ScenarioDef, ScenarioId, SimulationControls } from '@cadcopilot/runtime';

export interface PrototypeControls {
  mode: RunMode;
  modes: RunMode[];
  setMode: (mode: RunMode) => void;
  scenarios: ReadonlyArray<Pick<ScenarioDef, 'id' | 'title' | 'description'>>;
  scenarioId: ScenarioId;
  setScenario: (id: ScenarioId) => void;
  speed: number;
  setSpeed: (speed: number) => void;
  generator: SimulationControls['generator'];
}

const MODE_NAME: Record<RunMode, string> = {
  'assist-execute': 'assist-execute（批准后执行）',
  assist: 'assist（只给建议）',
  'offline-research': 'offline-research（离线研究）',
  shadow: 'shadow',
};

/**
 * Prototype-only controls. They stand in for deployment configuration and the
 * Runtime's behaviour; a production build has no equivalent.
 */
export function PrototypePanel({ controls }: { controls: PrototypeControls }) {
  const scenario = controls.scenarios.find((s) => s.id === controls.scenarioId);
  return (
    <section className="proto" aria-label="原型控制">
      <h2>原型控制 · 仅模拟</h2>
      <p className="field-help">这些控件模拟部署配置与 Runtime 的行为，不属于产品功能。</p>
      <div className="field">
        <label htmlFor="proto-mode">模拟部署的运行模式</label>
        <select id="proto-mode" value={controls.mode} onChange={(e) => controls.setMode(e.target.value as RunMode)}>
          {controls.modes.map((m) => (
            <option key={m} value={m}>
              {MODE_NAME[m]}
            </option>
          ))}
        </select>
        <p className="field-help">切换会创建新的模拟部署，并清空模拟任务。</p>
      </div>
      <div className="field">
        <label htmlFor="proto-scenario">下一个任务的场景</label>
        <select id="proto-scenario" value={controls.scenarioId} onChange={(e) => controls.setScenario(e.target.value as ScenarioId)}>
          {controls.scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        {scenario && <p className="field-help">{scenario.description}</p>}
      </div>
      <div className="field">
        <label htmlFor="proto-speed">模拟速度</label>
        <select id="proto-speed" value={controls.speed} onChange={(e) => controls.setSpeed(Number(e.target.value))}>
          <option value={0.5}>0.5×（慢，便于观察状态）</option>
          <option value={1}>1×</option>
          <option value={3}>3×</option>
        </select>
      </div>
      <details className="proto-generator">
        <summary>合成数据的生成假设</summary>
        <p className="field-help">{controls.generator.description}</p>
        <ul className="plain-list field-help">
          {controls.generator.caseEffects.map((e) => (
            <li key={e}>{e}</li>
          ))}
          <li>噪声标准差 {controls.generator.noiseSdUm} μm；随机种子 {controls.generator.seed}</li>
          <li>每位牙技师 {controls.generator.historicalCasesPerTechnician} 个历史病例（演示参数，不是研究设计）</li>
        </ul>
      </details>
    </section>
  );
}
