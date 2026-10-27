/**
 * What a Runtime host needs from its environment. The simulated environment
 * (src/simulation) and a future real one supply the same shape; the host
 * and engine do not change between them.
 */
import type { EgressCategory, Identity, IntegrationStatus, RunMode } from '@cadcopilot/contracts';
import type { Agent, AgentTaskContext, ModelProvider, ToolImplementation } from '@cadcopilot/agent-tools';
import type { DataStore } from '@cadcopilot/data';
import type { Scheduler } from '../engine/scheduler';

export interface BudgetLimits {
  rounds: number;
  replans: number;
  toolCalls: number;
}

/** Deployment configuration (§4, §10, §13). Fixed per deployment; no agent can change it. */
export interface DeploymentConfig {
  deploymentId: string;
  mode: RunMode;
  simulated: boolean;
  cadConnected: boolean;
  policyVersion: string;
  gateCriteriaSetVersion: string;
  registrationVersion: string;
  systemPromptVersion: string;
  /** Criteria the quality gate must report on (§10.7). */
  requiredGateCriteria: readonly string[];
  /** The signed-in human. */
  identity: Identity;
  egressAllowed: readonly EgressCategory[];
  budget: BudgetLimits;
  integrations: IntegrationStatus[];
}

export interface TaskSetup {
  agent: Agent;
  budget?: Partial<BudgetLimits>;
  /** Short label recorded on TaskCreated (e.g. the simulated scenario). */
  label?: string;
}

export interface RuntimeEnvironment {
  config: DeploymentConfig;
  data: DataStore;
  tools: readonly ToolImplementation[];
  model: ModelProvider;
  scheduler: Scheduler;
  /** Chooses the agent (and per-task limits) for a new task. */
  setupTask(context: AgentTaskContext): TaskSetup;
  /** Prototype only: number of initial getDeployment() calls that fail. */
  failDeploymentTimes?: number;
}
