/** Decision Ledger (§11). */

export interface EvidenceRef {
  ref: string;
  label: string;
  stance?: 'supports' | 'opposes';
}

export interface DecisionRecord {
  decisionId: string;
  taskId: string;
  caseId: string | null;
  observations: EvidenceRef[];
  hypothesis: string;
  evidence: EvidenceRef[];
  alternatives: { label: string; whyNot: string }[];
  candidateId?: string;
  /** Rationale summary; each claim should cite a record (§11). Not evidence itself. */
  rationale: string;
  uncertainty: string;
  /** "无法可靠判断" is a first-class outcome (README principles, §11). */
  outcome: string;
  unableToJudge: boolean;
  createdAt: string;
}
