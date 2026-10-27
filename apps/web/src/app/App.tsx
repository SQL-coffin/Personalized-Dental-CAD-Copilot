/**
 * Composition root. The only place that knows the Runtime is simulated: it
 * assembles the simulated runtime (or, later, a transport to a real one),
 * hands its ports to the product UI and adds the prototype control panel.
 * Nothing under src/ui changes when the Runtime behind the ports changes.
 */
import { useMemo, useState } from 'react';
import type { RunMode } from '@cadcopilot/contracts';
import { adjustableScheduler, createSimulatedRuntime, type Scheduler, type ScenarioId } from '@cadcopilot/runtime';
import { RuntimeBoot } from '../ui/RuntimeBoot';
import { PrototypePanel } from './PrototypePanel';

const MODES: RunMode[] = ['assist-execute', 'assist', 'offline-research'];

export interface AppProps {
  initialMode?: RunMode;
  initialScenario?: ScenarioId;
  /** Tests inject a deterministic scheduler; the browser uses real time. */
  scheduler?: Scheduler;
  failDeploymentTimes?: number;
}

export function App({ initialMode = 'assist-execute', ...rest }: AppProps) {
  const [mode, setMode] = useState<RunMode>(initialMode);
  const realtime = useMemo(() => adjustableScheduler(1), []);
  const [speed, setSpeed] = useState(1);
  // A new mode is a new simulated deployment: remount everything below.
  return (
    <SimulatedDeployment
      key={mode}
      mode={mode}
      setMode={setMode}
      scheduler={rest.scheduler ?? realtime}
      speed={speed}
      setSpeed={(s) => {
        realtime.setSpeed(s);
        setSpeed(s);
      }}
      {...(mode === initialMode && rest.initialScenario ? { initialScenario: rest.initialScenario } : {})}
      {...(rest.failDeploymentTimes !== undefined ? { failDeploymentTimes: rest.failDeploymentTimes } : {})}
    />
  );
}

function SimulatedDeployment(props: {
  mode: RunMode;
  setMode: (m: RunMode) => void;
  scheduler: Scheduler;
  speed: number;
  setSpeed: (s: number) => void;
  initialScenario?: ScenarioId;
  failDeploymentTimes?: number;
}) {
  const [sim] = useState(() =>
    createSimulatedRuntime({
      mode: props.mode,
      scheduler: props.scheduler,
      ...(props.initialScenario ? { scenario: props.initialScenario } : {}),
      ...(props.failDeploymentTimes !== undefined ? { failDeploymentTimes: props.failDeploymentTimes } : {}),
    }),
  );
  const [scenarioId, setScenarioId] = useState<ScenarioId>(sim.controls.scenarioId);

  const panel = (
    <PrototypePanel
      controls={{
        mode: props.mode,
        modes: MODES,
        setMode: props.setMode,
        scenarios: sim.controls.scenarios,
        scenarioId,
        setScenario: (id) => {
          sim.controls.setScenario(id);
          setScenarioId(id);
        },
        speed: props.speed,
        setSpeed: props.setSpeed,
        generator: sim.controls.generator,
      }}
    />
  );
  return <RuntimeBoot ports={sim.ports} sidebarFooter={panel} />;
}
