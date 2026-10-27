/**
 * Synthetic CAD adapter (05 §14: "CAD 由合成适配器代替"). It supports version
 * queries and conditional writes, and can simulate a concurrent technician
 * edit and a write whose reply is lost.
 *
 * In this simulation the CAD's current design is the head of the data
 * layer's version graph, and the adapter doubles as a C3 capture adapter:
 * every change on the CAD side is recorded as a version plus an action, and
 * the data store's rules (assignment, approval) apply to it.
 */
import { stableHash, type VersionRef } from '@cadcopilot/contracts';
import { AdapterError, type CadCapabilities, type CadDesignState, type CadPort, type CadWriteRequest, type CadWriteResult } from '@cadcopilot/agent-tools';
import { MARGIN_REGIONS, type DataStore } from '@cadcopilot/data';

const now = () => new Date().toISOString();

export class SyntheticCadAdapter implements CadPort {
  readonly adapterId = 'cad.synthetic';
  readonly vendor = '合成 CAD（模拟）';
  readonly capabilities: CadCapabilities = {
    readDesign: 'simulated',
    versionQuery: 'simulated',
    conditionalWrite: 'simulated',
    editEvents: 'simulated',
    maxCaptureLevel: 'C3',
  };

  private loseNextWriteReply = new Set<string>();
  private versionQueryDown = new Set<string>();

  constructor(private readonly store: DataStore) {}

  private head(caseId: string) {
    const head = this.store.headVersion(caseId);
    if (!head) throw new AdapterError(this.adapterId, 'UNAVAILABLE', `CAD 中找不到病例 ${caseId} 的设计`);
    return head;
  }

  private nextVersionId(caseId: string): string {
    return `v${this.store.listVersions(caseId).length}`;
  }

  async readDesign(caseId: string): Promise<CadDesignState> {
    const head = this.head(caseId);
    return { caseId, version: { versionId: head.versionId, contentHash: head.contentHash }, geometryRef: head.geometryRef };
  }

  async queryVersion(caseId: string): Promise<VersionRef> {
    if (this.versionQueryDown.delete(caseId)) {
      throw new AdapterError(this.adapterId, 'UNAVAILABLE', 'CAD 版本查询暂时不可用（模拟）');
    }
    const head = this.head(caseId);
    return { versionId: head.versionId, contentHash: head.contentHash };
  }

  async conditionalWrite(req: CadWriteRequest): Promise<CadWriteResult> {
    const head = this.head(req.caseId);
    if (head.versionId !== req.baseVersionId) {
      return { status: 'rejected_base_changed', currentVersion: { versionId: head.versionId, contentHash: head.contentHash } };
    }
    const versionId = this.nextVersionId(req.caseId);
    const contentHash = stableHash(`${req.caseId}:${versionId}:${req.candidateHash}`);
    this.store.appendVersion({
      caseId: req.caseId,
      versionId,
      object: 'margin_line',
      parent: head.versionId,
      contentHash,
      geometryRef: `evidence://sim/${req.caseId}/${versionId}`,
      origin: { kind: 'copilot_execution', taskId: req.taskId, approvalId: req.approvalId },
      createdAt: now(),
    });
    this.store.appendAction({
      actionId: `act-copilot-${versionId}`,
      caseId: req.caseId,
      object: 'margin_line',
      tool: 'cad.write_margin_line',
      params: { intentId: req.intentId },
      fromVersion: head.versionId,
      toVersion: versionId,
      regions: MARGIN_REGIONS.filter((r) => req.geometry.samples.some((s) => s.t >= r.t[0] && s.t <= r.t[1])).map((r) => ({ label: r.label, t: r.t })),
      captureLevel: 'C3',
      actor: { kind: 'copilot', taskId: req.taskId, approvalId: req.approvalId },
      at: now(),
    });
    if (this.loseNextWriteReply.delete(req.caseId)) {
      // Applied, but the caller never hears so; the next version query fails too.
      this.versionQueryDown.add(req.caseId);
      throw new AdapterError(this.adapterId, 'TIMEOUT', '写入请求超时，无法确定是否已生效', 'unknown');
    }
    return { status: 'applied', newVersion: { versionId, contentHash } };
  }

  // -- simulation controls ---------------------------------------------------

  /** The assigned technician edits the design in CAD (recorded as captured). */
  simulateTechnicianEdit(caseId: string): VersionRef {
    const head = this.head(caseId);
    const assignment = this.store.getAssignment(caseId);
    if (!assignment) throw new AdapterError(this.adapterId, 'REJECTED', `病例 ${caseId} 尚未分配`);
    const versionId = this.nextVersionId(caseId);
    const contentHash = stableHash(`${caseId}:${versionId}:manual`);
    const sessionId = this.store.listSessions(caseId).at(-1)?.sessionId;
    this.store.appendVersion({
      caseId,
      versionId,
      object: 'margin_line',
      parent: head.versionId,
      contentHash,
      geometryRef: `evidence://sim/${caseId}/${versionId}`,
      origin: { kind: 'technician_edit', technicianId: assignment.technicianId, ...(sessionId ? { sessionId } : {}) },
      createdAt: now(),
    });
    this.store.appendAction({
      actionId: `act-manual-${versionId}`,
      caseId,
      ...(sessionId ? { sessionId } : {}),
      object: 'margin_line',
      tool: 'margin_line.drag_control_point',
      fromVersion: head.versionId,
      toVersion: versionId,
      regions: [{ label: MARGIN_REGIONS[0]!.label, t: MARGIN_REGIONS[0]!.t }],
      captureLevel: 'C3',
      actor: { kind: 'technician', technicianId: assignment.technicianId },
      at: now(),
    });
    return { versionId, contentHash };
  }

  /** The next write to this case is applied but its reply is lost. */
  loseNextReply(caseId: string): void {
    this.loseNextWriteReply.add(caseId);
  }
}
