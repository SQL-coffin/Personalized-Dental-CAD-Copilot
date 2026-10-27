/**
 * CAD port: what the Runtime needs from a dental CAD system. A vendor adapter
 * implements it; which capabilities a real system offers is unknown until the
 * read-only interface audit (05 §15 Phase 3a), so capabilities are declared,
 * not assumed.
 */
import type { CandidateGeometry, CaptureLevel, VersionRef } from '@cadcopilot/contracts';

export type CapabilityStatus = 'supported' | 'unsupported' | 'unknown' | 'simulated';

export interface CadCapabilities {
  readDesign: CapabilityStatus;
  /** Query the current version of an object without reading its geometry. */
  versionQuery: CapabilityStatus;
  /** Write only if the target is still at the expected version (§7.2 step 5). */
  conditionalWrite: CapabilityStatus;
  /** Stream of edit events (needed for C3 capture, 02 §6.5). */
  editEvents: CapabilityStatus;
  maxCaptureLevel: CaptureLevel | 'unknown';
}

export interface CadDesignState {
  caseId: string;
  version: VersionRef;
  geometryRef: string;
}

export interface CadWriteRequest {
  caseId: string;
  baseVersionId: string;
  candidateHash: string;
  geometry: CandidateGeometry;
  approvalId: string;
  taskId: string;
  /** Idempotency / reconciliation key from the intent record. */
  intentId: string;
}

export type CadWriteResult =
  | { status: 'applied'; newVersion: VersionRef }
  /** Conditional write refused: nothing was written. */
  | { status: 'rejected_base_changed'; currentVersion: VersionRef };

/**
 * Methods reject with AdapterError. A write whose outcome is unknown (e.g. a
 * timeout after sending) must reject with outcome 'unknown', never resolve.
 */
export interface CadPort {
  readonly adapterId: string;
  readonly vendor: string;
  readonly capabilities: CadCapabilities;
  readDesign(caseId: string): Promise<CadDesignState>;
  queryVersion(caseId: string): Promise<VersionRef>;
  conditionalWrite(request: CadWriteRequest): Promise<CadWriteResult>;
}
