/**
 * Model provider port. A model only produces text for the agent: narration,
 * plans to be checked, summaries. Its output is data, never authority (I11):
 * it cannot change task state, policy or approvals, and every call is
 * recorded with the fields 05 §7.4 requires for audit and re-execution.
 *
 * No provider is bound here (00 §3: not tied to a specific model).
 */
import type { EgressCategory } from '@cadcopilot/contracts';
import type { EgressDeclaration } from '../tools/definition';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  text: string;
}

export interface ModelCallRequest {
  purpose: 'narrate' | 'plan' | 'summarize';
  systemPromptVersion: string;
  messages: ModelMessage[];
  params: { temperature?: number; maxTokens?: number; seed?: number };
  /** Data category of the input; the Policy Gate checks it against the provider's egress (§10.6). */
  egressCategory: EgressCategory;
}

/** §7.4 record: references and hashes of the full input and output, never hidden reasoning. */
export interface ModelCallRecord {
  callId: string;
  providerId: string;
  modelId: string;
  modelVersion: string;
  systemPromptVersion: string;
  purpose: ModelCallRequest['purpose'];
  params: ModelCallRequest['params'];
  inputRef: string;
  inputHash: string;
  outputRef: string;
  outputHash: string;
  startedAt: string;
  finishedAt: string;
  /** True when no model was called (scripted provider). */
  simulated: boolean;
}

export interface ModelCallResult {
  text: string;
  record: ModelCallRecord;
}

export interface ModelProvider {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly simulated: boolean;
  /** Whether calls leave the Runtime, and which data categories they may carry. */
  readonly egress: EgressDeclaration;
  complete(request: ModelCallRequest): Promise<ModelCallResult>;
}
