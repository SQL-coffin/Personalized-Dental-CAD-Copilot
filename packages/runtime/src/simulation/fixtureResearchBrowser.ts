/**
 * Fixture Research Browser: canned search results and pages, no network.
 * The real Research-Browser-MCP server stays in its own repository; an MCP
 * client adapter (packages/integrations) will implement the same port.
 */
import type { ResearchBrowserPort, ResearchPageResult, ResearchSearchResult } from '@cadcopilot/agent-tools';

const SOURCES = [
  { title: '（模拟来源）Margin line 自动识别的深度学习研究', url: 'https://example.org/sim/margin-line-dl', snippet: '模拟摘要：基于预备体扫描数据训练模型识别 margin line。' },
  { title: '（模拟来源）数字化修复体设计中的人工修正', url: 'https://example.org/sim/manual-correction', snippet: '模拟摘要：牙技师对自动设计的修正行为。' },
  { title: '（模拟来源）曲线对应与几何差异度量', url: 'https://example.org/sim/curve-correspondence', snippet: '模拟摘要：曲线对应的一致性检查。' },
];

export class FixtureResearchBrowser implements ResearchBrowserPort {
  readonly adapterId = 'research-browser.fixture';
  readonly providers = ['fixture'];

  async search(request: { query: string; limit?: number }): Promise<ResearchSearchResult[]> {
    const retrievedAt = new Date().toISOString();
    return SOURCES.slice(0, request.limit ?? 5).map((s) => ({ ...s, provider: 'fixture', retrievedAt }));
  }

  async fetchPublicPage(request: { url: string }): Promise<ResearchPageResult> {
    const source = SOURCES.find((s) => s.url === request.url);
    return {
      status: source ? 'success' : 'error',
      sourceUrl: request.url,
      finalUrl: request.url,
      title: source?.title ?? '',
      retrievedAt: new Date().toISOString(),
      content: source ? `${source.snippet}（fixture 内容，不是真实页面）` : '',
      challengeType: 'none',
      evidenceRef: source ? `evidence://research/${encodeURIComponent(request.url)}` : null,
      warnings: source ? ['fixture 页面：内容为模拟文本'] : ['fixture 中没有该 URL'],
    };
  }
}
