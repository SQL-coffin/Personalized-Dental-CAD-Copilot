/**
 * Read-only views of case records (02 §1–§12) for the UI. They are
 * projections of the data layer, not the data layer's own types, so the
 * internal model can change without breaking the UI. (frontend proposal)
 */
import type { ArcInterval, CaptureLevel, Correspondence, CoronalApical, VersionRef } from './vocabulary';

export interface TechnicianRef {
  technicianId: string;
  pseudonym: string;
}

/** A pseudonymised case. Patient identity never reaches the UI (04 §1.2). */
export interface CaseSummary {
  caseId: string;
  patientPseudonym: string;
  restoration: string;
  /** FDI tooth number. */
  tooth: string;
  designObject: 'margin_line';
  currentVersion: VersionRef;
  captureLevel: CaptureLevel;
  /** Synthetic fixture rather than real (pseudonymised) patient data. */
  synthetic: boolean;
  /** Each case is assigned to exactly one technician (ADR-0003). */
  assignedTechnician: TechnicianRef | null;
  /** 'confirmed' once a version carries geometry_confirmed = yes (02 §12.1). */
  status: 'open' | 'confirmed';
}

export type VersionOriginKind = 'ai_initial' | 'technician_edit' | 'undo' | 'copilot_execution' | 'import';

export interface DesignVersionView {
  versionId: string;
  parent: string | null;
  revertsTo?: string;
  origin: VersionOriginKind;
  /** Technician who made the change (technician_edit / undo). */
  technicianId?: string;
  /** Approval and task behind a Copilot write (copilot_execution). */
  approvalId?: string;
  taskId?: string;
  contentHash: string;
  createdAt: string;
  isCurrent: boolean;
  isInitial: boolean;
  /** geometry_confirmed = yes for this version. */
  confirmed: boolean;
}

export interface EditActionView {
  actionId: string;
  tool: string;
  fromVersion: string;
  toVersion: string;
  actor: { kind: 'technician' | 'copilot'; id: string };
  approvalId?: string;
  regions: Array<{ label?: string; t: ArcInterval }>;
  captureLevel: CaptureLevel;
  episodeId?: string;
  at: string;
}

export interface GeometryDeltaView {
  deltaId: string;
  gdType: 'step' | 'episode' | 'final';
  fromVersion: string;
  toVersion: string;
  regions: Array<{
    label: string;
    t: ArcInterval;
    correspondence: Correspondence;
    direction?: CoronalApical;
    maxUm?: number;
  }>;
  computedBy: string;
}

export interface CaseRecordView {
  summary: CaseSummary;
  covariates: Array<{ key: string; label: string; value: string }>;
  assignment: { technician: TechnicianRef; assignedAt: string; ruleVersion: string } | null;
  /** Append order; the version graph is reconstructed from `parent`. */
  versions: DesignVersionView[];
  actions: EditActionView[];
  deltas: GeometryDeltaView[];
  confirmation: { status: 'confirmed' | 'not_confirmed'; versionId?: string; confirmedAt?: string };
  /** Caveats that apply to reading this record. */
  notes: string[];
}
