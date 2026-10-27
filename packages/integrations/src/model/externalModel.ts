/**
 * Boundary for an external model provider. No provider is chosen (00 §3:
 * the project is not bound to a specific model), and whether case-derived
 * data may be sent at all depends on the deployment and data-processing
 * agreement (05 §10.6, open decision). Placeholder: every call fails with
 * NOT_CONFIGURED. Its egress declaration is what the Policy Gate would
 * check if it were enabled.
 */
import { AdapterError, type ModelCallRequest, type ModelCallResult, type ModelProvider } from '@cadcopilot/agent-tools';

export class ExternalModelProviderPlaceholder implements ModelProvider {
  readonly providerId = 'model.external.placeholder';
  readonly modelId = 'unselected';
  readonly modelVersion = 'none';
  readonly simulated = false;
  readonly egress = { sendsOutside: true, categories: ['deidentified_structured' as const], recipient: '待定' };

  async complete(_request: ModelCallRequest): Promise<ModelCallResult> {
    throw new AdapterError(this.providerId, 'NOT_CONFIGURED', '未配置模型提供方：模型选择与允许外发的数据类别都待决（05 §10.6）');
  }
}
