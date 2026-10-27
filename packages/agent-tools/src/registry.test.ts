import { describe, expect, it } from 'vitest';
import { TOOL_CATALOG } from './tools/catalog';
import type { ToolImplementation } from './tools/definition';
import { TIERS_BY_MODE, ToolNotRegisteredError, ToolRegistry } from './tools/registry';

const impls: ToolImplementation[] = Object.values(TOOL_CATALOG).map((definition) => ({
  definition,
  execute: async () => ({ ok: true, output: null }),
}));

describe('ToolRegistry (05 §4, AT-07a)', () => {
  it('never registers a tool whose tier the mode does not allow', () => {
    for (const mode of ['offline-research', 'shadow', 'assist', 'assist-execute'] as const) {
      const registry = ToolRegistry.forMode(mode, impls);
      for (const def of registry.definitions()) expect(TIERS_BY_MODE[mode]).toContain(def.tier);
    }
  });

  it('has the CAD write tool only in assist-execute', () => {
    expect(ToolRegistry.forMode('assist-execute', impls).has('cad.write_margin_line')).toBe(true);
    expect(ToolRegistry.forMode('assist', impls).has('cad.write_margin_line')).toBe(false);
    expect(() => ToolRegistry.forMode('assist', impls).require('cad.write_margin_line')).toThrow(ToolNotRegisteredError);
  });

  it('keeps display tools out of shadow mode (suggestions are not shown there)', () => {
    const shadow = ToolRegistry.forMode('shadow', impls);
    expect(shadow.has('assist.display_candidate')).toBe(false);
    expect(shadow.has('predictor.personal_retrieval')).toBe(true);
    expect(shadow.excluded.map((e) => e.toolId)).toContain('assist.display_candidate');
  });

  it('registers only research tools in offline-research, and they declare their egress', () => {
    const research = ToolRegistry.forMode('offline-research', impls);
    expect(research.definitions().map((d) => d.toolId).sort()).toEqual(['research.fetch_public_page', 'research.search']);
    for (const d of research.definitions()) expect(d.egress).toMatchObject({ sendsOutside: true, categories: ['public_query'] });
  });

  it('rejects duplicate implementations', () => {
    expect(() => ToolRegistry.forMode('assist', [impls[0]!, impls[0]!])).toThrow(/duplicate/);
  });
});
