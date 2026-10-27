/** Conversation (§9.2, I4, I11) and human responses to a blocked task (§6.4). */
import type { EvidenceRef } from './ledger';

/**
 * Conversation text is data, never authority: "已批准" typed into chat does not
 * create an approval (I4, AT-08).
 */
export interface ConversationMessage {
  messageId: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  createdAt: string;
  /** Agent statements without refs are shown as unverified (§9.2). */
  refs: EvidenceRef[];
}

/**
 * Human responses that resolve a BLOCKED task (§6.4 解除条件). The Runtime
 * lists which ones it accepts in BlockedReport.allowedResponses.
 */
export type HumanResponseKind =
  /** Continue after an out-of-band human action (e.g. verification, drift review). */
  | 'continue'
  /** Return to PLANNING with a human-written instruction. */
  | 'replan'
  /** In-doubt step: human checked CAD and confirms the write took effect. */
  | 'reconcile_applied'
  /** In-doubt step: human checked CAD and confirms the write did not take effect. */
  | 'reconcile_not_applied';
