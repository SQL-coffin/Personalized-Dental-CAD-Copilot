/**
 * Research Browser port, following docs/06 §3–§4 (PR #3). The Research
 * Browser MCP server is a separate repository; an adapter in
 * packages/integrations will talk to it over MCP. Nothing of its
 * implementation lives here — only the shape this Runtime consumes.
 *
 * Results are untrusted data: page text never changes task, policy or tools
 * (06 §1, I11).
 */

export type ResearchResultStatus = 'success' | 'human_verification_required' | 'blocked' | 'error';

/** 06 §3 research.inspect_challenge classification. */
export type ChallengeType = 'none' | 'captcha' | 'login_required' | 'rate_limited' | 'robots_or_policy_block' | 'unknown';

export interface ResearchSearchResult {
  title: string;
  url: string;
  snippet: string;
  provider: string;
  retrievedAt: string;
}

/** 06 §4 unified result. */
export interface ResearchPageResult {
  status: ResearchResultStatus;
  sourceUrl: string;
  finalUrl: string;
  title: string;
  retrievedAt: string;
  content: string;
  challengeType: ChallengeType;
  evidenceRef: string | null;
  warnings: string[];
}

export interface ResearchBrowserPort {
  readonly adapterId: string;
  /** Configured providers; empty means remote providers are off (06 §6 default). */
  readonly providers: readonly string[];
  search(request: { query: string; limit?: number }): Promise<ResearchSearchResult[]>;
  fetchPublicPage(request: { url: string }): Promise<ResearchPageResult>;
}
