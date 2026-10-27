/**
 * Tool contract (05 §7). A tool is registered with a definition, executed by
 * the Runtime's step executor, and returns a result the Runtime classifies
 * (§7.3). Tools never change task state themselves.
 */
import type { EgressCategory, RunMode, ToolErrorCode, ToolRef, VersionRef } from '@cadcopilot/contracts';
import type { CandidateProposal } from './io';

/** §10.4 data partitions a tool may read. */
export type DataPartition = 'dev' | 'calib' | 'holdout' | 'review';

/** §7.1 `egress`: whether data leaves the Runtime, and which category. */
export interface EgressDeclaration {
  sendsOutside: boolean;
  categories: EgressCategory[];
  recipient?: string;
}

/**
 * What the Runtime does with a successful result, beyond recording it. The
 * role is how the engine knows which policy rules and record updates apply,
 * without knowing tool internals.
 */
export type ToolRole =
  /** Read or compute; the output goes back to the agent. */
  | 'read'
  /** Output is a candidate proposal; the Runtime registers it (05 §5.3: candidates only from registered predictors). */
  | 'candidate_source'
  /** Output is a QualityGateResult; the Runtime attaches it to the candidate. */
  | 'quality_gate'
  /** Releases a gate-passed candidate in adoptable form (S tier, §10.7). */
  | 'display_candidate'
  /** Releases a candidate as diagnostics only, without geometry (S tier, §10.7). */
  | 'display_hint'
  /** Writes an archival record (S tier). */
  | 'archive'
  /** Writes to CAD (E tier): approval, base-version check, intent record, reconciliation. */
  | 'cad_write';

export interface ToolDefinition extends ToolRef {
  title: string;
  description: string;
  role: ToolRole;
  /** Modes the tool may be registered in (further limited by tier, §4). */
  modes: RunMode[];
  dataScopes: DataPartition[];
  egress: EgressDeclaration;
  /** cad_write tools: target object and dependencies, bound into approvals (§7.1 base_scope). */
  baseScope?: string[];
  timeoutMs: number;
}

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  /**
   * Whether a side effect may have happened (§7.3). 'none' only when the tool
   * has no side effects, failed before executing, or the adapter reported
   * explicitly that the request was not executed.
   */
  effect: 'none' | 'unknown';
}

export type ToolResult<O> = { ok: true; output: O; summary?: string } | { ok: false; error: ToolError };

/** Read-only view of a candidate registered in the current task. */
export interface RegisteredCandidate {
  candidateId: string;
  candidateHash: string;
  proposal: CandidateProposal;
}

export interface ToolContext {
  taskId: string;
  stepId: string;
  attempt: number;
  caseId: string | null;
  technicianId: string | null;
  /** Memory boundary of the task (§8.3). */
  asOf: string;
  /** Present for an E-tier call after its approval was consumed. */
  approvalId?: string;
  candidates: { get(candidateId: string): RegisteredCandidate | undefined };
}

export type ReconcileResult = 'applied' | 'not_applied' | 'unknown';

export interface ToolImplementation<I = unknown, O = unknown> {
  readonly definition: ToolDefinition;
  execute(input: I, ctx: ToolContext): Promise<ToolResult<O>>;
  /** cad_write: read the target's current version for the pre-execution check (§10.3). */
  readBase?(input: I, ctx: ToolContext): Promise<VersionRef>;
  /** Side-effecting tools: establish whether an in-doubt call took effect (§7.3). */
  reconcile?(input: I, ctx: ToolContext): Promise<ReconcileResult>;
}
