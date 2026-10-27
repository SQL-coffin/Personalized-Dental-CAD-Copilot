/**
 * Boundary for a real dental CAD system. Which product (candidate: 3Shape,
 * still to be confirmed) and what it exposes are unknown until the
 * read-only interface audit (05 §15 Phase 3a, without real patient data).
 * Until then every capability is 'unknown' and every call fails with
 * NOT_IMPLEMENTED; nothing here talks to CAD software.
 */
import { AdapterError, type CadCapabilities, type CadDesignState, type CadPort, type CadWriteRequest, type CadWriteResult } from '@cadcopilot/agent-tools';
import type { VersionRef } from '@cadcopilot/contracts';

/** What the Phase 3a audit must establish before an adapter can be written. */
export const CAD_INTERFACE_AUDIT: ReadonlyArray<{ capability: keyof CadCapabilities | 'export' | 'authorization'; question: string }> = [
  { capability: 'readDesign', question: '能否读取 margin line 曲线本身（而不只是网格），以及 AI 初始设计 S_0？' },
  { capability: 'versionQuery', question: '能否只查询设计对象及其依赖对象的当前版本与哈希？' },
  { capability: 'conditionalWrite', question: '能否「版本不变才写入」？不能时，写后能否立即读取并对账？' },
  { capability: 'editEvents', question: '能否获得编辑事件或中间版本？决定采集粒度 C0–C3（02 §6.5）。' },
  { capability: 'maxCaptureLevel', question: '实际可达到的采集粒度是多少？在实际安装上逐项核实。' },
  { capability: 'export', question: '导出格式是否可读（例如是否加密）？是否需要开发者合作或插件权限？' },
  { capability: 'authorization', question: '读取与写入需要哪些授权？测试订单或演示病例能否用于审计？' },
];

export class ExternalCadAdapterPlaceholder implements CadPort {
  readonly adapterId = 'cad.external.placeholder';
  readonly vendor = '待定（候选：3Shape，待确认）';
  readonly capabilities: CadCapabilities = {
    readDesign: 'unknown',
    versionQuery: 'unknown',
    conditionalWrite: 'unknown',
    editEvents: 'unknown',
    maxCaptureLevel: 'unknown',
  };

  private refuse(operation: string): AdapterError {
    return new AdapterError(this.adapterId, 'NOT_IMPLEMENTED', `真实 CAD 适配器尚未实现（${operation}）：需先完成只读接口审计（05 §15 Phase 3a）`);
  }

  async readDesign(_caseId: string): Promise<CadDesignState> {
    throw this.refuse('readDesign');
  }

  async queryVersion(_caseId: string): Promise<VersionRef> {
    throw this.refuse('queryVersion');
  }

  async conditionalWrite(_request: CadWriteRequest): Promise<CadWriteResult> {
    // Not executed: nothing was sent, so §7.3 treats it as having no effect.
    throw this.refuse('conditionalWrite');
  }
}
