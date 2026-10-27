/**
 * Projections from the data model to the UI contract (packages/contracts
 * cases.ts). The UI never sees the internal model directly.
 */
import type { CaptureLevel, CaseRecordView, CaseSummary, DesignVersionView, TechnicianRef } from '@cadcopilot/contracts';
import type { CaseCovariates, CaseId } from './model';
import type { DataStoreReader } from './store';

const COVARIATE_LABELS: Record<keyof CaseCovariates, string> = {
  restoration: '修复体',
  tooth: '牙位（FDI）',
  arch: '牙弓',
  toothClass: '牙位类别',
  prepType: '预备体边缘',
  scanQuality: '扫描质量',
};

const VALUE_LABELS: Record<string, string> = {
  maxillary: '上颌',
  mandibular: '下颌',
  molar: '磨牙',
  premolar: '前磨牙',
  canine: '尖牙',
  incisor: '切牙',
  chamfer: '凹槽形（chamfer）',
  shoulder: '肩台形（shoulder）',
  knife_edge: '刃状（knife edge）',
  good: '好',
  fair: '一般',
  poor: '差',
};

function technicianRef(store: DataStoreReader, technicianId: string): TechnicianRef {
  return { technicianId, pseudonym: store.getTechnician(technicianId)?.pseudonym ?? technicianId };
}

function captureLevelOf(store: DataStoreReader, caseId: CaseId): CaptureLevel {
  // Capture level is a session property (02 §6.5); with no session only S_0 is known.
  return store.listSessions(caseId).at(-1)?.captureLevel ?? 'C1';
}

export function toCaseSummary(store: DataStoreReader, caseId: CaseId): CaseSummary {
  const record = store.getCase(caseId);
  const head = store.headVersion(caseId);
  if (!record || !head) throw new Error(`case ${caseId} has no record or no version`);
  const assignment = store.getAssignment(caseId);
  return {
    caseId,
    patientPseudonym: record.patientPseudonym,
    restoration: record.covariates.restoration,
    tooth: record.covariates.tooth,
    designObject: record.designObject,
    currentVersion: { versionId: head.versionId, contentHash: head.contentHash },
    captureLevel: captureLevelOf(store, caseId),
    synthetic: record.source === 'synthetic',
    assignedTechnician: assignment ? technicianRef(store, assignment.technicianId) : null,
    status: store.confirmedVersion(caseId) ? 'confirmed' : 'open',
  };
}

export function toCaseRecordView(store: DataStoreReader, caseId: CaseId): CaseRecordView {
  const summary = toCaseSummary(store, caseId);
  const record = store.getCase(caseId)!;
  const assignment = store.getAssignment(caseId);
  const versions = store.listVersions(caseId);
  const head = versions.at(-1);
  const confirmed = store.confirmedVersion(caseId);
  const versionViews: DesignVersionView[] = versions.map((v, i) => {
    const o = v.origin;
    return {
      versionId: v.versionId,
      parent: v.parent,
      ...(v.revertsTo ? { revertsTo: v.revertsTo } : {}),
      origin: o.kind,
      ...(o.kind === 'technician_edit' || o.kind === 'undo' ? { technicianId: o.technicianId } : {}),
      ...(o.kind === 'copilot_execution' ? { approvalId: o.approvalId, taskId: o.taskId } : {}),
      contentHash: v.contentHash,
      createdAt: v.createdAt,
      isCurrent: v === head,
      isInitial: i === 0,
      confirmed: !!store.currentOutcome(caseId, v.versionId)?.geometryConfirmed.confirmed,
    };
  });
  const notes = ['病例之间的差异（牙位、预备体类型、扫描质量）不等于个人偏好；比较不同病例时必须考虑这些协变量。'];
  if (record.source === 'synthetic') notes.push('合成数据：版本、动作和几何差异由生成器构造，不来自真实 CAD 或真实患者。');
  if (!confirmed) notes.push('尚无经牙技师确认的版本。Copilot 写入的版本也需要牙技师在 CAD 中自行确认。');
  return {
    summary,
    covariates: (Object.keys(COVARIATE_LABELS) as Array<keyof CaseCovariates>).map((key) => ({
      key,
      label: COVARIATE_LABELS[key],
      value: VALUE_LABELS[record.covariates[key]] ?? record.covariates[key],
    })),
    assignment: assignment
      ? { technician: technicianRef(store, assignment.technicianId), assignedAt: assignment.assignedAt, ruleVersion: assignment.ruleVersion }
      : null,
    versions: versionViews,
    actions: store.listActions(caseId).map((a) => ({
      actionId: a.actionId,
      tool: a.tool,
      fromVersion: a.fromVersion,
      toVersion: a.toVersion,
      actor: a.actor.kind === 'technician' ? { kind: 'technician', id: a.actor.technicianId } : { kind: 'copilot', id: a.actor.taskId },
      ...(a.actor.kind === 'copilot' ? { approvalId: a.actor.approvalId } : {}),
      regions: a.regions.map((r) => ({ ...(r.label ? { label: r.label } : {}), t: r.t })),
      captureLevel: a.captureLevel,
      ...(a.episodeId ? { episodeId: a.episodeId } : {}),
      at: a.at,
    })),
    deltas: store.listDeltas(caseId).map((d) => ({
      deltaId: d.deltaId,
      gdType: d.gdType,
      fromVersion: d.fromVersion,
      toVersion: d.toVersion,
      regions: d.regions.map((r) => ({
        label: r.label,
        t: r.t,
        correspondence: r.correspondence,
        ...(r.displacement ? { direction: r.displacement.direction, maxUm: r.displacement.maxUm } : {}),
      })),
      computedBy: `${d.computedBy.tool}@${d.computedBy.version}`,
    })),
    confirmation: confirmed
      ? {
          status: 'confirmed',
          versionId: confirmed.version.versionId,
          ...(confirmed.outcome.geometryConfirmed.at ? { confirmedAt: confirmed.outcome.geometryConfirmed.at } : {}),
        }
      : { status: 'not_confirmed' },
    notes,
  };
}
