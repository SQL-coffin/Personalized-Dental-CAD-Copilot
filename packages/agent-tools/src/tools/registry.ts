import type { RunMode, Tier, ToolRef } from '@cadcopilot/contracts';
import type { ToolDefinition, ToolImplementation } from './definition';

/** §4: tiers a mode may register. A tool outside them is not registered at all. */
export const TIERS_BY_MODE: Record<RunMode, readonly Tier[]> = {
  'offline-research': ['R'],
  shadow: ['R', 'S'],
  assist: ['R', 'S'],
  'assist-execute': ['R', 'S', 'E'],
};

export class ToolNotRegisteredError extends Error {
  readonly toolId: string;
  constructor(toolId: string, mode: RunMode) {
    super(`工具 ${toolId} 未在 ${mode} 模式下注册`);
    this.name = 'ToolNotRegisteredError';
    this.toolId = toolId;
  }
}

/**
 * The tools of one deployment mode. Built once from all available
 * implementations; anything the mode does not allow is left out, so it
 * cannot be called by name (AT-07a).
 */
export class ToolRegistry {
  readonly mode: RunMode;
  /** Implementations left out, and why (for diagnostics). */
  readonly excluded: ReadonlyArray<{ toolId: string; reason: string }>;
  private readonly tools: ReadonlyMap<string, ToolImplementation>;

  private constructor(mode: RunMode, tools: Map<string, ToolImplementation>, excluded: Array<{ toolId: string; reason: string }>) {
    this.mode = mode;
    this.tools = tools;
    this.excluded = excluded;
  }

  static forMode(mode: RunMode, implementations: ReadonlyArray<ToolImplementation>): ToolRegistry {
    const tools = new Map<string, ToolImplementation>();
    const excluded: Array<{ toolId: string; reason: string }> = [];
    for (const impl of implementations) {
      const def = impl.definition;
      if (tools.has(def.toolId)) throw new Error(`duplicate tool implementation ${def.toolId}`);
      if (!TIERS_BY_MODE[mode].includes(def.tier)) excluded.push({ toolId: def.toolId, reason: `${def.tier} 级工具不能在 ${mode} 模式注册` });
      else if (!def.modes.includes(mode)) excluded.push({ toolId: def.toolId, reason: `工具定义不包含 ${mode} 模式` });
      else tools.set(def.toolId, impl);
    }
    return new ToolRegistry(mode, tools, excluded);
  }

  has(toolId: string): boolean {
    return this.tools.has(toolId);
  }

  get(toolId: string): ToolImplementation | undefined {
    return this.tools.get(toolId);
  }

  require(toolId: string): ToolImplementation {
    const impl = this.tools.get(toolId);
    if (!impl) throw new ToolNotRegisteredError(toolId, this.mode);
    return impl;
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  refs(): ToolRef[] {
    return this.definitions().map(({ toolId, version, kind, tier, sideEffects, deterministic, idempotent }) => ({
      toolId,
      version,
      kind,
      tier,
      sideEffects,
      deterministic,
      idempotent,
    }));
  }
}
