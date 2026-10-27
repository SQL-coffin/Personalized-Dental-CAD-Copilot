/**
 * Patient-level split (03 §2): all teeth, rescans and versions of one patient
 * fall on the same side. Deterministic for a seed.
 */
import { stableHash } from '@cadcopilot/contracts';

export function chooseHoldoutPatients(patients: Iterable<string>, fraction: number, seed = 'split-v1'): Set<string> {
  const unique = [...new Set(patients)].sort((a, b) => stableHash(`${seed}:${a}`).localeCompare(stableHash(`${seed}:${b}`)));
  return new Set(unique.slice(0, Math.round(unique.length * fraction)));
}

export function splitByPatient<T extends { patientPseudonym: string }>(rows: readonly T[], holdoutPatients: ReadonlySet<string>): { dev: T[]; holdout: T[] } {
  const dev: T[] = [];
  const holdout: T[] = [];
  for (const row of rows) (holdoutPatients.has(row.patientPseudonym) ? holdout : dev).push(row);
  return { dev, holdout };
}
