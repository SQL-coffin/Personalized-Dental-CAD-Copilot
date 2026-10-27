/**
 * Boundary for the Research-Browser-MCP server, which stays in its own
 * repository. This repository only consumes it through ResearchBrowserPort
 * (docs/06); no server code is copied here. MCP is the transport, not the
 * permission boundary: the Runtime's Policy Gate still decides (06 §2).
 *
 * Placeholder: remote providers are off by default (06 §6) and no MCP
 * client is implemented, so every call fails with NOT_CONFIGURED or
 * NOT_IMPLEMENTED.
 */
import { AdapterError, type ResearchBrowserPort, type ResearchPageResult, type ResearchSearchResult } from '@cadcopilot/agent-tools';

export interface ResearchBrowserMcpConfig {
  /** Disabled unless explicitly enabled after the provider review of 06 §6. */
  enabled: boolean;
  /** How to reach the MCP server (stdio command or endpoint); decided with the server repository. */
  server?: { kind: 'stdio'; command: string } | { kind: 'http'; url: string };
  providers: string[];
}

/** Port method → MCP tool name in the server repository (06 §3). To confirm against the server's tool list. */
export const RESEARCH_BROWSER_MCP_TOOLS = {
  search: 'research.search',
  fetchPublicPage: 'research.fetch_public_page',
} as const satisfies Record<'search' | 'fetchPublicPage', string>;

export class ResearchBrowserMcpClientPlaceholder implements ResearchBrowserPort {
  readonly adapterId = 'research-browser.mcp.placeholder';
  readonly providers: readonly string[];

  constructor(private readonly config: ResearchBrowserMcpConfig = { enabled: false, providers: [] }) {
    this.providers = config.enabled ? config.providers : [];
  }

  private refuse(tool: string): AdapterError {
    return this.config.enabled
      ? new AdapterError(this.adapterId, 'NOT_IMPLEMENTED', `Research-Browser-MCP 客户端尚未实现（${tool}）`)
      : new AdapterError(this.adapterId, 'NOT_CONFIGURED', '远程 Research Browser 默认关闭（06 §6）；启用前需完成 provider 与外发审查');
  }

  async search(_request: { query: string; limit?: number }): Promise<ResearchSearchResult[]> {
    throw this.refuse(RESEARCH_BROWSER_MCP_TOOLS.search);
  }

  async fetchPublicPage(_request: { url: string }): Promise<ResearchPageResult> {
    throw this.refuse(RESEARCH_BROWSER_MCP_TOOLS.fetchPublicPage);
  }
}
