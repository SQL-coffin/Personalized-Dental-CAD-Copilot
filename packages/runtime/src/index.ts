// Engine and host: usable with any environment.
export { InProcessRuntime } from './host/inProcessRuntime';
export type { BudgetLimits, DeploymentConfig, RuntimeEnvironment, TaskSetup } from './host/environment';
export { PolicyGate, type PolicyConfig, type PolicyDecision } from './engine/policyGate';
export { isStepTransitionAllowed, isTaskTransitionAllowed, TransitionError } from './engine/transitions';
export { adjustableScheduler, instantScheduler, ManualScheduler, realtimeScheduler, type Scheduler } from './engine/scheduler';

// Simulated environment (prototype and tests). Production code assembles its own environment.
export { createSimulatedRuntime, simulatedIntegrations, SIM_VERSIONS, type SimulatedRuntime, type SimulatedRuntimeOptions, type SimulationControls } from './simulation/createSimulatedRuntime';
export { SCENARIOS, scenariosFor, type ScenarioDef, type ScenarioId } from './simulation/scenarios';
export type { FaultPlan } from './simulation/faults';
