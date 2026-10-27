/** Approvals (§10.3). */
import type { Provenance } from './candidates';
import type { Identity } from './deployment';
import type { VersionRef } from './vocabulary';

export type ApprovalRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'consumed'
  | 'invalidated'
  | 'expired'
  | 'revoked';

export interface ApprovalRecord {
  approvalId: string;
  approver: Identity;
  decision: 'approve' | 'reject';
  note?: string;
  decidedAt: string;
  /** E tier: always 1 (§10.3). */
  uses: 1;
  expiresAt?: string;
}

/** An approval the Runtime is waiting for; mirrors the §10.3 approval scope. (frontend proposal) */
export interface ApprovalRequest {
  approvalRequestId: string;
  taskId: string;
  stepId: string;
  candidateId: string;
  candidateHash: string;
  target: { caseId: string; sessionId: string; object: 'margin_line'; tooth: string };
  baseVersion: VersionRef & { scope: string[] };
  provenance: Provenance;
  qualityGateRef: string;
  criteriaSetVersion: string;
  policyVersion: string;
  requestedAt: string;
  expiresAt?: string;
  status: ApprovalRequestStatus;
  invalidationReason?: string;
  record?: ApprovalRecord;
}

/** 'revise' = reject this candidate and ask for a revised one (frontend proposal). */
export type ApprovalDecision = 'approve' | 'reject' | 'revise';
