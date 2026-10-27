/**
 * Integration Layer: boundaries to systems outside this repository. Every
 * export here is a placeholder that fails loudly; simulated stand-ins live
 * in packages/runtime/src/simulation.
 */
export { RUNTIME_HTTP_ROUTES, createHttpRuntimePorts, type HttpRoute, type HttpTransportConfig } from './runtime-transport/http';
export { CAD_INTERFACE_AUDIT, ExternalCadAdapterPlaceholder } from './cad/externalCad';
export { RESEARCH_BROWSER_MCP_TOOLS, ResearchBrowserMcpClientPlaceholder, type ResearchBrowserMcpConfig } from './research-browser/mcpClient';
export { ExternalModelProviderPlaceholder } from './model/externalModel';
