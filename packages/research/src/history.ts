/**
 * History view with the memory boundary of 05 §8.3: every query carries a
 * time cut-off (`asOf`) and a patient exclusion list, and an item is
 * returned only if all of its sources satisfy both. Excluded items are kept
 * with a reason, so leakage can be audited.
 */
import { listCompletedCases, type CompletedCaseRow, type DataStoreReader } from '@cadcopilot/data';

export type HistoryPool =
  | { kind: 'same_technician'; technicianId: string }
  | { kind: 'other_technicians'; excludeTechnicianId: string }
  | { kind: 'all' };

export interface HistoryQuery {
  pool: HistoryPool;
  asOf: string;
  excludePatients: string[];
}

export type ExclusionReason = 'not_in_pool' | 'not_before_as_of' | 'excluded_patient';

export interface HistoryView {
  readonly query: HistoryQuery;
  readonly cases: readonly CompletedCaseRow[];
  readonly excluded: ReadonlyArray<{ caseId: string; reason: ExclusionReason }>;
}

export function buildHistoryView(store: DataStoreReader, query: HistoryQuery): HistoryView {
  const asOf = Date.parse(query.asOf);
  const cases: CompletedCaseRow[] = [];
  const excluded: Array<{ caseId: string; reason: ExclusionReason }> = [];
  for (const row of listCompletedCases(store)) {
    const inPool =
      query.pool.kind === 'all' ||
      (query.pool.kind === 'same_technician' && row.technicianId === query.pool.technicianId) ||
      (query.pool.kind === 'other_technicians' && row.technicianId !== query.pool.excludeTechnicianId);
    if (!inPool) excluded.push({ caseId: row.caseId, reason: 'not_in_pool' });
    else if (!(Date.parse(row.confirmedAt) < asOf)) excluded.push({ caseId: row.caseId, reason: 'not_before_as_of' });
    else if (query.excludePatients.includes(row.patientPseudonym)) excluded.push({ caseId: row.caseId, reason: 'excluded_patient' });
    else cases.push(row);
  }
  return { query, cases, excluded };
}
