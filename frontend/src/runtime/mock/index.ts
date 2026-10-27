/** Simulated runtime for the prototype. Production code must not import this module. */
export { MockRuntime, type MockRuntimeOptions } from './MockRuntime';
export { SCENARIOS, scenariosFor, type ScenarioDef, type ScenarioId } from './scenarios';
export { adjustableScheduler, instantScheduler, ManualScheduler, realtimeScheduler, type Scheduler } from './scheduler';
