/**
 * Data model (docs/02-data-specification.md).
 *
 * Every record is immutable once appended; corrections are new records that
 * supersede old ones (02 §14). Records reference versions by ID, never by
 * mutable object. Patient identity never appears here, only pseudonyms
 * (04 §1.2).
 *
 * What this model keeps apart, so that between-case differences are never
 * read as personal preference (ADR-0003):
 *   - the case and its covariates            → CaseRecord
 *   - who worked on it (exactly one person)  → CaseAssignment
 *   - what they did                          → EditAction / CorrectionEpisode
 *   - which geometry resulted                → DesignVersion (graph)
 *   - what changed between two versions      → GeometryDelta
 *   - whether anyone confirmed or validated  → OutcomeRecord / ValidatedImprovement
 */
import type {
  ArcInterval,
  CaptureLevel,
  CoronalApical,
  Correspondence,
  DisplacementSample,
  EvaluationValidity,
  QualityResultValue,
  RegionDisplacement,
} from '@cadcopilot/contracts';

export type CaseId = string;
export type PatientPseudonym = string;
export type TechnicianId = string;
export type SessionId = string;
/** Unique within its case (e.g. "v3"); always used together with the case ID. */
export type VersionId = string;
export type ActionId = string;
export type EpisodeId = string;
export type DeltaId = string;
export type OutcomeId = string;

/** A participating technician, known only by a study pseudonym. */
export interface Technician {
  technicianId: TechnicianId;
  pseudonym: string;
}

export type ToothClass = 'molar' | 'premolar' | 'canine' | 'incisor';

/**
 * Case-level features. They describe how cases differ from each other and are
 * what an analysis conditions on before attributing a difference to a person.
 */
export interface CaseCovariates {
  restoration: string;
  /** FDI tooth number. */
  tooth: string;
  arch: 'maxillary' | 'mandibular';
  toothClass: ToothClass;
  /** Preparation margin type. */
  prepType: 'chamfer' | 'shoulder' | 'knife_edge';
  scanQuality: 'good' | 'fair' | 'poor';
}

export interface CaseRecord {
  caseId: CaseId;
  patientPseudonym: PatientPseudonym;
  designObject: 'margin_line';
  covariates: CaseCovariates;
  createdAt: string;
  source: 'synthetic' | 'pseudonymised';
}

/**
 * The single technician responsible for a case. A case is assigned at most
 * once: no second technician, no repeat by the same technician (ADR-0003).
 */
export interface CaseAssignment {
  caseId: CaseId;
  technicianId: TechnicianId;
  assignedAt: string;
  /** Version of the assignment rule in force when the assignment was made. */
  ruleVersion: string;
}

/** 02 §1 modelling session. */
export interface ModelingSession {
  sessionId: SessionId;
  caseId: CaseId;
  technicianId: TechnicianId;
  captureLevel: CaptureLevel;
  startedAt: string;
  endedAt?: string;
}

export type VersionOrigin =
  | { kind: 'ai_initial' }
  | { kind: 'technician_edit'; technicianId: TechnicianId; sessionId?: SessionId }
  | { kind: 'undo'; technicianId: TechnicianId; sessionId?: SessionId }
  | { kind: 'copilot_execution'; taskId: string; approvalId: string }
  | { kind: 'import' };

/** 02 §6.1 version graph node. Undo creates a new node with `revertsTo`. */
export interface DesignVersion {
  caseId: CaseId;
  versionId: VersionId;
  object: 'margin_line';
  parent: VersionId | null;
  revertsTo?: VersionId;
  contentHash: string;
  /** Content-addressed reference to the geometry payload (Evidence Store). */
  geometryRef: string;
  origin: VersionOrigin;
  createdAt: string;
  /** A curve derived from a mesh is a derived record, not raw evidence (02 §6.5). */
  derived?: { algorithm: string; version: string };
}

export type ActionActor =
  | { kind: 'technician'; technicianId: TechnicianId }
  | { kind: 'copilot'; taskId: string; approvalId: string };

export interface RegionRef {
  label?: string;
  t: ArcInterval;
}

/** 02 §6.2 action ↔ version link. */
export interface EditAction {
  actionId: ActionId;
  caseId: CaseId;
  sessionId?: SessionId;
  episodeId?: EpisodeId;
  object: 'margin_line';
  tool: string;
  params?: Record<string, string | number>;
  fromVersion: VersionId;
  toVersion: VersionId;
  regions: RegionRef[];
  captureLevel: CaptureLevel;
  actor: ActionActor;
  at: string;
}

/** 02 §5. Intent labels come only from humans. */
export interface CorrectionEpisode {
  episodeId: EpisodeId;
  caseId: CaseId;
  sessionId: SessionId;
  technicianId: TechnicianId;
  object: 'margin_line';
  startVersion: VersionId;
  endVersion: VersionId;
  actionIds: ActionId[];
  segmentationRuleVersion: string;
  intent?: { region?: string; direction?: CoronalApical; reason?: string; labelledBy: string };
}

export interface RegionDelta {
  regionId: string;
  label: string;
  t: ArcInterval;
  correspondence: Correspondence;
  /** Only for MATCHED regions (02 §4, §9). */
  displacement?: RegionDisplacement;
  profile?: DisplacementSample[];
}

/** 02 §4 Geometry Delta between two fixed versions. Describes change, not quality. */
export interface GeometryDelta {
  deltaId: DeltaId;
  caseId: CaseId;
  gdType: 'step' | 'episode' | 'final';
  object: 'margin_line';
  fromVersion: VersionId;
  toVersion: VersionId;
  regions: RegionDelta[];
  frameVersion: string;
  computedBy: { tool: string; version: string };
  computedAt: string;
  sourceActionId?: ActionId;
  sourceEpisodeId?: EpisodeId;
}

/** 02 §12.1 outcome record of one design version. A newer record supersedes an older one. */
export interface OutcomeRecord {
  outcomeId: OutcomeId;
  caseId: CaseId;
  versionId: VersionId;
  geometryConfirmed: { confirmed: boolean; at?: string; by?: TechnicianId };
  independentReview:
    | { status: 'none' }
    | { status: 'reviewed'; reviewerPseudonym: string; blinded: boolean; conclusion: string };
  manufactured: 'yes' | 'no' | 'unknown';
  postAdjustment: 'none' | 'chairside' | 'remake' | 'unknown';
  criteriaResults: Array<{ criterionId: string; version: string; result: QualityResultValue }>;
  evaluationValidity: EvaluationValidity;
  qualityResult: QualityResultValue;
  recordedAt: string;
  supersedes?: OutcomeId;
}

/** 02 §7. The technician's own confirmation is never VI evidence. */
export interface ValidatedImprovement {
  viId: string;
  caseId: CaseId;
  targetDelta: DeltaId;
  criterion: { id: string; version: string };
  evidenceType: 'geometric_validity' | 'predefined_criteria' | 'expert_review' | 'production_outcome';
  evidenceSource: string;
  result: 'improved' | 'no_difference' | 'worse' | 'undeterminable';
  reviewedAt: string;
}

/** Notification that something was appended for a case. */
export interface DataChange {
  caseId: CaseId;
  kind: 'case' | 'assignment' | 'session' | 'version' | 'action' | 'episode' | 'delta' | 'outcome';
}
