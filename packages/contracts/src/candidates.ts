/** Candidates, preference and quality (§10.7, 01 §5, 02 §9, §12.1). */
import type {
  ArcInterval,
  Correspondence,
  DisplacementSample,
  EvaluationValidity,
  QualityResultValue,
  RegionDisplacement,
  VersionRef,
} from './vocabulary';

export interface CandidateRegion {
  regionId: string;
  label: string;
  /** 02 §6.3 normalised arc length on S_0. */
  t: ArcInterval;
  correspondence: Correspondence;
  /** Only present for MATCHED regions (01 §5 rule 3). */
  displacement?: RegionDisplacement;
}

/** 01 §5 Preference: Personal Preference Score with uncertainty. Never merged with quality (I5). */
export interface PreferenceEstimate {
  score: number;
  interval: [number, number];
  basis: string;
  predictor: { id: string; version: string };
}

export interface GateCriterionResult {
  criterionId: string;
  label: string;
  evaluationValidity: EvaluationValidity;
  qualityResult: QualityResultValue;
  detail?: string;
}

/** §10.7 runtime quality gate outcome for one candidate. */
export interface QualityGateResult {
  gateRef: string;
  criteriaSetVersion: string;
  /** Every criterion in the registered set; a missing result counts as not passed. */
  requiredCriteria: string[];
  results: GateCriterionResult[];
  /** Runtime's verdict. Every consumer re-checks it with `isGatePassed`. */
  passed: boolean;
  evaluatedAt: string;
}

export interface Provenance {
  predictor: { id: string; version: string };
  geometryEngine: { id: string; version: string };
  executor?: { id: string; version: string };
  paramsHash: string;
}

/** Candidate geometry; the Runtime only releases it for gate-passed candidates. */
export interface CandidateGeometry {
  kind: 'margin_line_displacement';
  frameVersion: string;
  samples: DisplacementSample[];
}

export interface Candidate {
  candidateId: string;
  candidateHash: string;
  caseId: string;
  object: 'margin_line';
  baseVersion: VersionRef & { scope: string[] };
  provenance: Provenance;
  regions: CandidateRegion[];
  preference: PreferenceEstimate;
  quality: QualityGateResult;
  /** Runtime's display classification (§10.7 table). */
  presentation: 'adoptable' | 'diagnostic';
  /** Absent unless presentation is 'adoptable'. */
  geometry?: CandidateGeometry;
  /** Region-level hint shown when no adoptable geometry is available. */
  hint?: string;
  createdAt: string;
}
