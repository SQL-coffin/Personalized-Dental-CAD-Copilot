import type {
  CaseAssignment,
  CaseId,
  CaseRecord,
  CorrectionEpisode,
  DataChange,
  DesignVersion,
  EditAction,
  GeometryDelta,
  ModelingSession,
  OutcomeRecord,
  Technician,
  TechnicianId,
  VersionId,
  VersionOrigin,
} from './model';
import { DataConstraintError, type DataStore } from './store';

interface CaseBucket {
  record: CaseRecord;
  assignment?: CaseAssignment;
  sessions: ModelingSession[];
  versions: DesignVersion[];
  actions: EditAction[];
  episodes: CorrectionEpisode[];
  deltas: GeometryDelta[];
  outcomes: OutcomeRecord[];
}

/**
 * In-memory, append-only data store. Enforces:
 *  - a case is assigned at most once (ADR-0003);
 *  - only the assigned technician can open sessions, edit or undo;
 *  - Copilot-written versions and actions carry an approval (04 §2, 05 §10.3);
 *  - the version graph: parents and undo targets exist in the same case,
 *    the first version of a case is the AI initial design (S_0).
 */
export class InMemoryDataStore implements DataStore {
  private technicians = new Map<TechnicianId, Technician>();
  private cases = new Map<CaseId, CaseBucket>();
  private ids = new Set<string>();
  private listeners = new Set<(change: DataChange) => void>();

  // -- reads ---------------------------------------------------------------

  listTechnicians(): Technician[] {
    return [...this.technicians.values()];
  }

  getTechnician(technicianId: TechnicianId): Technician | undefined {
    return this.technicians.get(technicianId);
  }

  listCases(filter: { technicianId?: TechnicianId } = {}): CaseRecord[] {
    return [...this.cases.values()]
      .filter((b) => !filter.technicianId || b.assignment?.technicianId === filter.technicianId)
      .map((b) => b.record);
  }

  getCase(caseId: CaseId): CaseRecord | undefined {
    return this.cases.get(caseId)?.record;
  }

  getAssignment(caseId: CaseId): CaseAssignment | undefined {
    return this.cases.get(caseId)?.assignment;
  }

  listAssignments(): CaseAssignment[] {
    return [...this.cases.values()].flatMap((b) => (b.assignment ? [b.assignment] : []));
  }

  listSessions(caseId: CaseId): ModelingSession[] {
    return [...(this.cases.get(caseId)?.sessions ?? [])];
  }

  listVersions(caseId: CaseId): DesignVersion[] {
    return [...(this.cases.get(caseId)?.versions ?? [])];
  }

  getVersion(caseId: CaseId, versionId: VersionId): DesignVersion | undefined {
    return this.cases.get(caseId)?.versions.find((v) => v.versionId === versionId);
  }

  initialVersion(caseId: CaseId): DesignVersion | undefined {
    return this.cases.get(caseId)?.versions[0];
  }

  headVersion(caseId: CaseId): DesignVersion | undefined {
    const versions = this.cases.get(caseId)?.versions ?? [];
    return versions[versions.length - 1];
  }

  listActions(caseId: CaseId): EditAction[] {
    return [...(this.cases.get(caseId)?.actions ?? [])];
  }

  listEpisodes(caseId: CaseId): CorrectionEpisode[] {
    return [...(this.cases.get(caseId)?.episodes ?? [])];
  }

  listDeltas(caseId: CaseId, gdType?: GeometryDelta['gdType']): GeometryDelta[] {
    return (this.cases.get(caseId)?.deltas ?? []).filter((d) => !gdType || d.gdType === gdType);
  }

  listOutcomes(caseId: CaseId): OutcomeRecord[] {
    return [...(this.cases.get(caseId)?.outcomes ?? [])];
  }

  currentOutcome(caseId: CaseId, versionId: VersionId): OutcomeRecord | undefined {
    const outcomes = (this.cases.get(caseId)?.outcomes ?? []).filter((o) => o.versionId === versionId);
    const superseded = new Set(outcomes.flatMap((o) => (o.supersedes ? [o.supersedes] : [])));
    return outcomes.filter((o) => !superseded.has(o.outcomeId)).at(-1);
  }

  confirmedVersion(caseId: CaseId): { version: DesignVersion; outcome: OutcomeRecord } | undefined {
    const versions = this.cases.get(caseId)?.versions ?? [];
    for (let i = versions.length - 1; i >= 0; i -= 1) {
      const version = versions[i]!;
      const outcome = this.currentOutcome(caseId, version.versionId);
      if (outcome?.geometryConfirmed.confirmed) return { version, outcome };
    }
    return undefined;
  }

  onChange(listener: (change: DataChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // -- writes --------------------------------------------------------------

  addTechnician(technician: Technician): void {
    this.claimId(`technician:${technician.technicianId}`);
    this.technicians.set(technician.technicianId, technician);
  }

  addCase(record: CaseRecord): void {
    this.claimId(`case:${record.caseId}`);
    this.cases.set(record.caseId, {
      record,
      sessions: [],
      versions: [],
      actions: [],
      episodes: [],
      deltas: [],
      outcomes: [],
    });
    this.emit({ caseId: record.caseId, kind: 'case' });
  }

  assign(assignment: CaseAssignment): void {
    const bucket = this.bucket(assignment.caseId);
    if (!this.technicians.has(assignment.technicianId)) {
      throw new DataConstraintError('UNKNOWN_TECHNICIAN', `牙技师 ${assignment.technicianId} 不存在`);
    }
    if (bucket.assignment) {
      const same = bucket.assignment.technicianId === assignment.technicianId;
      throw new DataConstraintError(
        'ASSIGNMENT_CONFLICT',
        same
          ? `病例 ${assignment.caseId} 已分配给 ${assignment.technicianId}；同一牙技师不能重复处理同一病例`
          : `病例 ${assignment.caseId} 已分配给 ${bucket.assignment.technicianId}；一个病例只能分配给一位牙技师`,
      );
    }
    bucket.assignment = assignment;
    this.emit({ caseId: assignment.caseId, kind: 'assignment' });
  }

  openSession(session: ModelingSession): void {
    const bucket = this.bucket(session.caseId);
    this.requireAssigned(bucket, session.technicianId);
    this.claimId(`session:${session.sessionId}`);
    bucket.sessions.push(session);
    this.emit({ caseId: session.caseId, kind: 'session' });
  }

  appendVersion(version: DesignVersion): void {
    const bucket = this.bucket(version.caseId);
    const exists = (id: VersionId) => bucket.versions.some((v) => v.versionId === id);
    if (exists(version.versionId)) {
      throw new DataConstraintError('DUPLICATE_ID', `病例 ${version.caseId} 已有版本 ${version.versionId}`);
    }
    if (bucket.versions.length === 0) {
      if (version.origin.kind !== 'ai_initial' && version.origin.kind !== 'import') {
        throw new DataConstraintError('INVALID_GRAPH', `病例 ${version.caseId} 的第一个版本必须是 AI 初始设计（S_0）或导入版本`);
      }
      if (version.parent !== null) throw new DataConstraintError('INVALID_GRAPH', 'S_0 不能有父版本');
    } else {
      if (version.origin.kind === 'ai_initial') {
        throw new DataConstraintError('INVALID_GRAPH', `病例 ${version.caseId} 已有 S_0`);
      }
      if (!version.parent || !exists(version.parent)) {
        throw new DataConstraintError('UNKNOWN_VERSION', `父版本 ${version.parent ?? '（空）'} 不在病例 ${version.caseId} 中`);
      }
    }
    if (version.revertsTo && !exists(version.revertsTo)) {
      throw new DataConstraintError('UNKNOWN_VERSION', `撤销目标 ${version.revertsTo} 不在病例 ${version.caseId} 中`);
    }
    this.checkOrigin(bucket, version.origin);
    bucket.versions.push(version);
    this.emit({ caseId: version.caseId, kind: 'version' });
  }

  appendAction(action: EditAction): void {
    const bucket = this.bucket(action.caseId);
    for (const v of [action.fromVersion, action.toVersion]) {
      if (!bucket.versions.some((x) => x.versionId === v)) {
        throw new DataConstraintError('UNKNOWN_VERSION', `动作 ${action.actionId} 引用的版本 ${v} 不在病例 ${action.caseId} 中`);
      }
    }
    if (action.sessionId && !bucket.sessions.some((s) => s.sessionId === action.sessionId)) {
      throw new DataConstraintError('UNKNOWN_SESSION', `会话 ${action.sessionId} 不在病例 ${action.caseId} 中`);
    }
    if (action.actor.kind === 'technician') this.requireAssigned(bucket, action.actor.technicianId);
    else if (!action.actor.approvalId) {
      throw new DataConstraintError('MISSING_APPROVAL', `Copilot 动作 ${action.actionId} 缺少审批记录`);
    }
    this.claimId(`action:${action.caseId}:${action.actionId}`);
    bucket.actions.push(action);
    this.emit({ caseId: action.caseId, kind: 'action' });
  }

  appendEpisode(episode: CorrectionEpisode): void {
    const bucket = this.bucket(episode.caseId);
    this.requireAssigned(bucket, episode.technicianId);
    this.claimId(`episode:${episode.caseId}:${episode.episodeId}`);
    bucket.episodes.push(episode);
    this.emit({ caseId: episode.caseId, kind: 'episode' });
  }

  appendDelta(delta: GeometryDelta): void {
    const bucket = this.bucket(delta.caseId);
    for (const v of [delta.fromVersion, delta.toVersion]) {
      if (!bucket.versions.some((x) => x.versionId === v)) {
        throw new DataConstraintError('UNKNOWN_VERSION', `GD ${delta.deltaId} 引用的版本 ${v} 不在病例 ${delta.caseId} 中`);
      }
    }
    for (const r of delta.regions) {
      if (r.correspondence !== 'MATCHED' && (r.displacement || r.profile)) {
        throw new DataConstraintError('INVALID_GRAPH', `GD ${delta.deltaId}：非 MATCHED 区域 ${r.regionId} 不能带逐点位移（02 §9）`);
      }
    }
    this.claimId(`delta:${delta.caseId}:${delta.deltaId}`);
    bucket.deltas.push(delta);
    this.emit({ caseId: delta.caseId, kind: 'delta' });
  }

  appendOutcome(outcome: OutcomeRecord): void {
    const bucket = this.bucket(outcome.caseId);
    if (!bucket.versions.some((v) => v.versionId === outcome.versionId)) {
      throw new DataConstraintError('UNKNOWN_VERSION', `结果记录引用的版本 ${outcome.versionId} 不在病例 ${outcome.caseId} 中`);
    }
    if (outcome.supersedes && !bucket.outcomes.some((o) => o.outcomeId === outcome.supersedes)) {
      throw new DataConstraintError('UNKNOWN_VERSION', `被取代的结果记录 ${outcome.supersedes} 不存在`);
    }
    if (outcome.evaluationValidity === 'not_evaluable' && outcome.qualityResult !== 'not_evaluated') {
      throw new DataConstraintError('INVALID_GRAPH', '不可评价时 quality_result 只能为「未评价」（02 §12.1）');
    }
    if (outcome.geometryConfirmed.by) this.requireAssigned(bucket, outcome.geometryConfirmed.by);
    this.claimId(`outcome:${outcome.caseId}:${outcome.outcomeId}`);
    bucket.outcomes.push(outcome);
    this.emit({ caseId: outcome.caseId, kind: 'outcome' });
  }

  // -- helpers -------------------------------------------------------------

  private bucket(caseId: CaseId): CaseBucket {
    const bucket = this.cases.get(caseId);
    if (!bucket) throw new DataConstraintError('UNKNOWN_CASE', `病例 ${caseId} 不存在`);
    return bucket;
  }

  private requireAssigned(bucket: CaseBucket, technicianId: TechnicianId): void {
    if (bucket.assignment?.technicianId !== technicianId) {
      throw new DataConstraintError(
        'NOT_ASSIGNED_TECHNICIAN',
        `${technicianId} 不是病例 ${bucket.record.caseId} 的负责牙技师${bucket.assignment ? `（负责人：${bucket.assignment.technicianId}）` : '（病例尚未分配）'}`,
      );
    }
  }

  private checkOrigin(bucket: CaseBucket, origin: VersionOrigin): void {
    if (origin.kind === 'technician_edit' || origin.kind === 'undo') this.requireAssigned(bucket, origin.technicianId);
    if (origin.kind === 'copilot_execution' && !origin.approvalId) {
      throw new DataConstraintError('MISSING_APPROVAL', 'Copilot 写入的版本必须引用审批记录');
    }
  }

  private claimId(key: string): void {
    if (this.ids.has(key)) throw new DataConstraintError('DUPLICATE_ID', `重复的 ID：${key}`);
    this.ids.add(key);
  }

  private emit(change: DataChange): void {
    for (const l of this.listeners) l(change);
  }
}
