/**
 * Fault plans: what makes one simulated scenario differ from another. The
 * environment (tools, CAD, browser) misbehaves as planned; the agent and the
 * engine react as they would to a real failure. No scenario dictates task or
 * step states directly.
 */

export type InjectedToolFault = 'timeout' | 'data_unavailable';

export interface FaultPlan {
  /** Faults for successive attempts of a tool, in order (e.g. first call times out). */
  toolFaults?: Partial<Record<string, InjectedToolFault[]>>;
  /** Regions the correspondence tool reports as AMBIGUOUS (02 §9). */
  ambiguousRegions?: string[];
  /** Surface-fit P95 the quality gate measures, in μm (simulated threshold 40). */
  surfaceFitP95Um?: number;
  cad?: {
    /** A technician edits the design while the approval is pending (§10.3). */
    concurrentEditBeforeFirstWrite?: boolean;
    /** The first write is applied but its reply is lost, and version queries fail once (§7.3). */
    firstWriteOutcomeUnknown?: boolean;
  };
  research?: {
    /** The first page fetch meets a CAPTCHA (06 §3). */
    challengeOnFirstFetch?: boolean;
  };
}

/** Fault plans per task, with one-shot consumption. */
export class FaultBook {
  private plans = new Map<string, FaultPlan>();
  private used = new Map<string, number>();

  set(taskId: string, plan: FaultPlan): void {
    this.plans.set(taskId, plan);
  }

  get(taskId: string): FaultPlan {
    return this.plans.get(taskId) ?? {};
  }

  /** Next injected fault for this tool in this task, if any. */
  nextToolFault(taskId: string, toolId: string): InjectedToolFault | undefined {
    const list = this.get(taskId).toolFaults?.[toolId] ?? [];
    const key = `${taskId}:${toolId}`;
    const i = this.used.get(key) ?? 0;
    this.used.set(key, i + 1);
    return list[i];
  }

  /** True the first time a named one-shot fault is asked for, when the plan enables it. */
  once(taskId: string, name: string, enabled: boolean | undefined): boolean {
    if (!enabled) return false;
    const key = `${taskId}:once:${name}`;
    if (this.used.has(key)) return false;
    this.used.set(key, 1);
    return true;
  }
}
