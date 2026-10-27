/**
 * Joins over the store that other layers need. Each row keeps case,
 * patient, technician and covariates side by side, so an analysis can
 * separate case differences from technician differences.
 */
import type { CaseCovariates, CaseId, GeometryDelta, PatientPseudonym, TechnicianId, VersionId } from './model';
import type { DataStoreReader } from './store';

export interface CompletedCaseRow {
  caseId: CaseId;
  patientPseudonym: PatientPseudonym;
  technicianId: TechnicianId;
  covariates: CaseCovariates;
  confirmedVersionId: VersionId;
  /** When geometry_confirmed was recorded; the time boundary for history queries. */
  confirmedAt: string;
  /** Final GD S_0 → confirmed version. A personal-preference label, not a quality label (02 §8). */
  finalDelta: GeometryDelta;
}

/** Cases with a confirmed version and a final GD ending at that version. */
export function listCompletedCases(store: DataStoreReader): CompletedCaseRow[] {
  const rows: CompletedCaseRow[] = [];
  for (const record of store.listCases()) {
    const assignment = store.getAssignment(record.caseId);
    const confirmed = store.confirmedVersion(record.caseId);
    if (!assignment || !confirmed) continue;
    const finalDelta = store
      .listDeltas(record.caseId, 'final')
      .filter((d) => d.toVersion === confirmed.version.versionId)
      .at(-1);
    if (!finalDelta) continue;
    rows.push({
      caseId: record.caseId,
      patientPseudonym: record.patientPseudonym,
      technicianId: assignment.technicianId,
      covariates: record.covariates,
      confirmedVersionId: confirmed.version.versionId,
      confirmedAt: confirmed.outcome.geometryConfirmed.at ?? confirmed.outcome.recordedAt,
      finalDelta,
    });
  }
  return rows;
}
