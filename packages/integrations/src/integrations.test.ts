import { AdapterError } from '@cadcopilot/agent-tools';
import { describe, expect, it } from 'vitest';
import { ExternalCadAdapterPlaceholder } from './cad/externalCad';
import { ExternalModelProviderPlaceholder } from './model/externalModel';
import { ResearchBrowserMcpClientPlaceholder } from './research-browser/mcpClient';
import { RUNTIME_HTTP_ROUTES, createHttpRuntimePorts } from './runtime-transport/http';

describe('integration placeholders fail loudly instead of pretending', () => {
  it('HTTP transport rejects every call with NOT_IMPLEMENTED and names the route', async () => {
    const ports = createHttpRuntimePorts({ baseUrl: 'http://runtime.invalid' });
    await expect(ports.runtime.getDeployment()).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', retryable: false });
    await expect(ports.runtime.createTask({ prompt: 'x', caseId: null })).rejects.toThrow(/POST http:\/\/runtime\.invalid\/v0\/tasks/);
    await expect(ports.approvals!.submitDecision({ approvalRequestId: 'r', candidateHash: 'h', baseVersionId: 'v', decision: 'approve' })).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    expect(typeof ports.runtime.subscribe('t', () => undefined)).toBe('function');
  });

  it('routes approval decisions through their own channel and streams over SSE', () => {
    expect(RUNTIME_HTTP_ROUTES.submitDecision.channel).toBe('approval');
    expect(RUNTIME_HTTP_ROUTES.subscribe.transport).toBe('sse');
  });

  it('external CAD declares every capability unknown and refuses calls', async () => {
    const cad = new ExternalCadAdapterPlaceholder();
    expect(Object.values(cad.capabilities).every((v) => v === 'unknown')).toBe(true);
    await expect(cad.readDesign('c')).rejects.toBeInstanceOf(AdapterError);
    await expect(cad.queryVersion('c')).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', outcome: 'not_executed' });
  });

  it('Research Browser MCP client is off by default and model provider is unconfigured', async () => {
    const browser = new ResearchBrowserMcpClientPlaceholder();
    expect(browser.providers).toEqual([]);
    await expect(browser.search({ query: 'x' })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    const enabled = new ResearchBrowserMcpClientPlaceholder({ enabled: true, providers: ['p'] });
    await expect(enabled.fetchPublicPage({ url: 'https://example.org' })).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    const model = new ExternalModelProviderPlaceholder();
    expect(model.egress.sendsOutside).toBe(true);
    await expect(model.complete({ purpose: 'narrate', systemPromptVersion: 'p', messages: [], params: {}, egressCategory: 'deidentified_structured' })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});
