/**
 * Inputs and outputs of the catalogued tools. Agents and tool
 * implementations both depend on these, never on each other.
 */
import type {
  ArcInterval,
  CandidateGeometry,
  CandidateRegion,
  Correspondence,
  PreferenceEstimate,
  Provenance,
  QualityGateResult,
  VersionRef,
} from '@cadcopilot/contracts';
import type { ResearchPageResult, ResearchSearchResult } from '../ports/researchBrowser';

export interface ReadDesignInput {
  caseId: string;
}
export interface ReadDesignOutput {
  caseId: string;
  version: VersionRef;
  geometryRef: string;
}

export interface CorrespondenceInput {
  caseId: string;
  versionId: string;
}
export interface RegionCorrespondence {
  regionId: string;
  label: string;
  t: ArcInterval;
  correspondence: Correspondence;
}
export interface CorrespondenceOutput {
  regions: RegionCorrespondence[];
}

export interface HistoryQueryInput {
  technicianId: string;
  asOf: string;
  excludePatients: string[];
}
export interface HistoryQueryOutput {
  caseIds: string[];
  excluded: Array<{ caseId: string; reason: string }>;
}

export interface PredictInput {
  caseId: string;
  base: VersionRef;
  regions: RegionCorrespondence[];
  /** A revision request; how it maps to parameters is the predictor's business. */
  adjustment?: { magnitudeScale: number; note: string };
}

/** What a candidate source proposes; the Runtime turns it into a registered candidate. */
export interface CandidateProposal {
  caseId: string;
  baseVersion: VersionRef & { scope: string[] };
  regions: CandidateRegion[];
  /** Displacement samples inside MATCHED regions only; null when nothing pointwise can be proposed. */
  geometry: CandidateGeometry | null;
  preference: PreferenceEstimate;
  provenance: Provenance;
  /** Historical cases behind the proposal, with their stance. */
  evidence: Array<{ caseId: string; stance: 'supports' | 'opposes'; summary: string }>;
}
export interface PredictOutput {
  proposal: CandidateProposal;
}

export interface CandidateInput {
  candidateId: string;
}
export type GateOutput = QualityGateResult;
export interface DisplayOutput {
  candidateId: string;
  presentation: 'adoptable' | 'diagnostic';
}

export interface ArchiveInput {
  candidateId: string;
  reason: string;
}

export interface WriteOutput {
  newVersion: VersionRef;
}

export interface ResearchSearchInput {
  query: string;
  limit?: number;
}
export interface ResearchSearchOutput {
  results: ResearchSearchResult[];
}
export interface ResearchFetchInput {
  url: string;
}
export type ResearchFetchOutput = ResearchPageResult;
