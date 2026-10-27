/**
 * Data store port. Reads are plain queries; writes are append-only and
 * validated, so a store implementation (in-memory now, persistent later)
 * cannot accept a record that breaks the data rules.
 */
import type {
  CaseAssignment,
  CaseId,
  CaseRecord,
  CorrectionEpisode,
  DataChange,
  DesignVersion,
  EditAction,
  GeometryDelta,
  ModelingSession,
  OutcomeRecord,
  Technician,
  TechnicianId,
  VersionId,
} from './model';

export type DataConstraintCode =
  | 'DUPLICATE_ID'
  | 'UNKNOWN_CASE'
  | 'UNKNOWN_TECHNICIAN'
  /** The case already has an assignment (to anyone): ADR-0003. */
  | 'ASSIGNMENT_CONFLICT'
  /** A technician other than the assigned one tried to work on the case. */
  | 'NOT_ASSIGNED_TECHNICIAN'
  | 'UNKNOWN_SESSION'
  | 'UNKNOWN_VERSION'
  | 'INVALID_GRAPH'
  | 'MISSING_APPROVAL';

export class DataConstraintError extends Error {
  readonly code: DataConstraintCode;
  readonly info: { layer: 'data'; code: string; message: string; retryable: false };

  constructor(code: DataConstraintCode, message: string) {
    super(message);
    this.name = 'DataConstraintError';
    this.code = code;
    this.info = { layer: 'data', code, message, retryable: false };
  }
}

export interface DataStoreReader {
  listTechnicians(): Technician[];
  getTechnician(technicianId: TechnicianId): Technician | undefined;
  listCases(filter?: { technicianId?: TechnicianId }): CaseRecord[];
  getCase(caseId: CaseId): CaseRecord | undefined;
  getAssignment(caseId: CaseId): CaseAssignment | undefined;
  listAssignments(): CaseAssignment[];
  listSessions(caseId: CaseId): ModelingSession[];
  /** Append order. */
  listVersions(caseId: CaseId): DesignVersion[];
  getVersion(caseId: CaseId, versionId: VersionId): DesignVersion | undefined;
  /** S_0: the AI initial design. */
  initialVersion(caseId: CaseId): DesignVersion | undefined;
  /** The most recently appended version (the current design). */
  headVersion(caseId: CaseId): DesignVersion | undefined;
  listActions(caseId: CaseId): EditAction[];
  listEpisodes(caseId: CaseId): CorrectionEpisode[];
  listDeltas(caseId: CaseId, gdType?: GeometryDelta['gdType']): GeometryDelta[];
  listOutcomes(caseId: CaseId): OutcomeRecord[];
  /** Latest outcome record of a version that no newer record supersedes. */
  currentOutcome(caseId: CaseId, versionId: VersionId): OutcomeRecord | undefined;
  /** The latest version whose current outcome has geometry_confirmed = yes. */
  confirmedVersion(caseId: CaseId): { version: DesignVersion; outcome: OutcomeRecord } | undefined;
  onChange(listener: (change: DataChange) => void): () => void;
}

export interface DataStoreWriter {
  addTechnician(technician: Technician): void;
  addCase(record: CaseRecord): void;
  assign(assignment: CaseAssignment): void;
  openSession(session: ModelingSession): void;
  appendVersion(version: DesignVersion): void;
  appendAction(action: EditAction): void;
  appendEpisode(episode: CorrectionEpisode): void;
  appendDelta(delta: GeometryDelta): void;
  appendOutcome(outcome: OutcomeRecord): void;
}

export interface DataStore extends DataStoreReader, DataStoreWriter {}
