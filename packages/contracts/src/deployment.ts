import type { RunMode, SideEffects, Tier, ToolKind } from './vocabulary';

/** Subset of §7.1 registration info that the UI needs to explain a step. */
export interface ToolRef {
  toolId: string;
  version: string;
  kind: ToolKind;
  tier: Tier;
  sideEffects: SideEffects;
  deterministic: boolean;
  idempotent: boolean;
}

export interface Identity {
  userId: string;
  displayName: string;
  /** I4 / §10.3: approvals must come from an authenticated human. */
  authenticated: boolean;
}

/**
 * Which interactive features the connected Runtime actually offers. The UI
 * renders a control only when the matching capability is true, so it never
 * exposes an action the backend cannot perform. (frontend proposal)
 */
export interface RuntimeCapabilities {
  /** §6.3 "任何非终止状态 → CANCELLED（人工取消）". */
  cancelTask: boolean;
  /** §6.4 human responses that unblock a task (feedback, replan, reconcile). */
  humanFeedback: boolean;
  /** §10.3 approval channel; only meaningful when an E-tier tool is registered. */
  approvals: boolean;
  /** Selecting an existing pseudonymised case from the Record Store. */
  caseSelection: boolean;
  /** Read-only case records (versions, actions, deltas, confirmation). */
  caseRecords: boolean;
}

export type IntegrationKind = 'runtime-transport' | 'data-store' | 'cad' | 'model-provider' | 'research-browser';

/**
 * - simulated: works, but against synthetic data or scripted behaviour;
 * - placeholder: the adapter boundary exists, the implementation does not;
 * - connected: a real external system is attached.
 */
export type IntegrationImplementation = 'simulated' | 'placeholder' | 'connected';

/** What sits behind each external boundary in this deployment. (frontend proposal) */
export interface IntegrationStatus {
  kind: IntegrationKind;
  adapterId: string;
  label: string;
  implementation: IntegrationImplementation;
  detail: string;
}

export interface DeploymentInfo {
  deploymentId: string;
  mode: RunMode;
  /** True for the simulated host and any synthetic test deployment (§14). */
  simulated: boolean;
  /** Whether a real CAD adapter is connected. */
  cadConnected: boolean;
  policyVersion: string;
  /** §10.7 registered gate criteria set. */
  gateCriteriaSetVersion: string;
  /** §4: tools not allowed in this mode are not registered at all. */
  registeredTools: ToolRef[];
  capabilities: RuntimeCapabilities;
  identity: Identity;
  integrations: IntegrationStatus[];
}
