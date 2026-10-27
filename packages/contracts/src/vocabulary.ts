/**
 * Shared vocabulary used by every layer (data, research, runtime, UI).
 *
 * Section references (§) point to docs/05-agent-runtime-spec.md v0.2 (PR #3,
 * not yet merged) unless another document is named. Enumerations defined
 * there are copied verbatim.
 */

/** §4. Chosen by deployment config; neither the model nor the UI can switch it. */
export type RunMode = 'offline-research' | 'shadow' | 'assist' | 'assist-execute';

/** 04 §2 permission tiers. */
export type Tier = 'R' | 'S' | 'E';

/** §7.1 `kind`. */
export type ToolKind = 'geometry' | 'data' | 'predictor' | 'llm' | 'adapter' | 'io' | 'research';

/** §7.1 `side_effects`. */
export type SideEffects = 'none' | 'writes_store' | 'displays' | 'writes_cad';

/** 02 §6.5 capture levels. */
export type CaptureLevel = 'C0' | 'C1' | 'C2' | 'C3';

/** 02 §9 curve correspondence state of a region. */
export type Correspondence = 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED';

/** 02 §10.4: direction is decided by the reference axis and may be uncertain. */
export type CoronalApical = 'coronal' | 'apical' | 'uncertain';

/** 02 §12.1 */
export type EvaluationValidity = 'evaluable' | 'not_evaluable';
export type QualityResultValue = 'pass' | 'fail' | 'not_evaluated';

/** An immutable design version (02 §6.1), identified within its case. */
export interface VersionRef {
  versionId: string;
  contentHash: string;
}

/** Normalised arc length interval [t1, t2] on S_0 (02 §6.3, §11). */
export type ArcInterval = [number, number];

export interface DisplacementSample {
  t: number;
  /** Lateral component d·b in μm; + coronal, − apical (02 §10). */
  lateralUm: number;
}

export interface RegionDisplacement {
  direction: CoronalApical;
  maxUm: number;
  meanUm: number;
}

/** §10.6 data categories, plus 06's public research query text. */
export type EgressCategory =
  | 'synthetic'
  | 'deidentified_structured'
  | 'deidentified_geometry'
  | 'raw'
  | 'public_query';
