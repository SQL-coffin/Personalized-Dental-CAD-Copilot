/**
 * Scripted model provider: returns the agent's draft text unchanged and
 * records the call with the §7.4 fields. No model is called and nothing
 * leaves the Runtime. A real provider replaces this class behind the same
 * ModelProvider port (packages/integrations has the placeholder).
 */
import { stableHash } from '@cadcopilot/contracts';
import type { ModelCallRequest, ModelCallResult, ModelProvider } from '@cadcopilot/agent-tools';

export class ScriptedModelProvider implements ModelProvider {
  readonly providerId = 'model.scripted';
  readonly modelId = 'scripted-narrator';
  readonly modelVersion = '0.2.0-sim';
  readonly simulated = true;
  readonly egress = { sendsOutside: false, categories: [] };
  private calls = 0;

  async complete(request: ModelCallRequest): Promise<ModelCallResult> {
    this.calls += 1;
    const startedAt = new Date().toISOString();
    const text = request.messages.filter((m) => m.role === 'user').at(-1)?.text ?? '';
    const input = JSON.stringify(request);
    const callId = `mcall-${this.calls}`;
    return {
      text,
      record: {
        callId,
        providerId: this.providerId,
        modelId: this.modelId,
        modelVersion: this.modelVersion,
        systemPromptVersion: request.systemPromptVersion,
        purpose: request.purpose,
        params: request.params,
        inputRef: `evidence://model/${callId}/in`,
        inputHash: stableHash(input),
        outputRef: `evidence://model/${callId}/out`,
        outputHash: stableHash(text),
        startedAt,
        finishedAt: new Date().toISOString(),
        simulated: true,
      },
    };
  }
}
