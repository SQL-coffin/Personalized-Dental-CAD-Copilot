import { useState } from 'react';
import type { DesignVersionView, RecordsClient } from '@cadcopilot/contracts';
import { formatTime, shortHash } from '../format';
import { useCaseRecord } from '../hooks';
import { CORRESPONDENCE_LABEL, DIRECTION_LABEL } from '../presenters/labels';
import { Badge, InlineError, KeyValue, Mono, Pending } from './primitives';

const ORIGIN_LABEL: Record<DesignVersionView['origin'], string> = {
  ai_initial: 'AI 初始设计（S_0）',
  technician_edit: '牙技师编辑',
  undo: '撤销',
  copilot_execution: 'Copilot 执行',
  import: '导入',
};

function originDetail(v: DesignVersionView): string {
  if (v.origin === 'copilot_execution') return `审批 ${v.approvalId ?? '?'} · 任务 ${v.taskId ?? '?'}`;
  if (v.origin === 'undo') return `回到 ${v.revertsTo ?? '?'}`;
  return v.technicianId ?? '';
}

/**
 * The case as the data layer records it: who is responsible, which versions
 * exist and where each came from, what changed, and whether a technician has
 * confirmed a version. Refreshes when the data layer reports a change.
 */
export function CaseRecordPanel({ records, caseId }: { records: RecordsClient; caseId: string }) {
  const [open, setOpen] = useState(false);
  const load = useCaseRecord(records, caseId);
  const record = load.status === 'ready' ? load.record : null;
  const head = record?.versions.find((v) => v.isCurrent);

  return (
    <section className="panel-section case-record" aria-label="病例记录">
      <header className="panel-section-head">
        <h2>病例记录</h2>
        {record && (
          <span className="muted-text case-record-summary">
            当前 {head?.versionId} · {record.versions.length} 个版本 · {record.confirmation.status === 'confirmed' ? '已确认' : '未确认'}
          </span>
        )}
        <button type="button" className="btn btn-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '展开'}
        </button>
      </header>
      {open && load.status === 'loading' && <Pending>正在读取病例记录…</Pending>}
      {open && load.status === 'error' && <InlineError code={load.error.code}>{load.error.message}</InlineError>}
      {open && record && (
        <div className="case-record-body">
          <KeyValue
            rows={[
              ['病例', <Mono key="c">{record.summary.caseId}</Mono>],
              [
                '负责牙技师',
                record.assignment ? (
                  <span key="a">
                    {record.assignment.technician.pseudonym}（<Mono>{record.assignment.technician.technicianId}</Mono>）
                  </span>
                ) : (
                  '未分配'
                ),
              ],
              ['分配规则', record.assignment ? <Mono key="r">{record.assignment.ruleVersion}</Mono> : '—'],
              [
                '最终确认',
                record.confirmation.status === 'confirmed' ? (
                  <Badge key="s" tone="success">
                    已确认 {record.confirmation.versionId}
                  </Badge>
                ) : (
                  <Badge key="s" tone="muted">
                    未确认
                  </Badge>
                ),
              ],
            ]}
          />

          <h3>设计版本</h3>
          <ol className="versions" aria-label="设计版本">
            {[...record.versions].reverse().map((v) => (
              <li key={v.versionId} className={`version origin-${v.origin}`}>
                <div className="version-head">
                  <Mono>{v.versionId}</Mono>
                  <span>{ORIGIN_LABEL[v.origin]}</span>
                  {v.isCurrent && <Badge tone="active">当前</Badge>}
                  {v.confirmed && <Badge tone="success">已确认</Badge>}
                </div>
                <div className="version-meta muted-text">
                  {v.parent ? `← ${v.parent} · ` : ''}
                  {originDetail(v)}
                  {originDetail(v) ? ' · ' : ''}
                  {formatTime(v.createdAt)} · <Mono>{shortHash(v.contentHash, 12)}</Mono>
                </div>
              </li>
            ))}
          </ol>

          <details>
            <summary>操作记录（{record.actions.length}）</summary>
            <ul className="plain-list">
              {record.actions.map((a) => (
                <li key={a.actionId}>
                  <Mono>
                    {a.fromVersion} → {a.toVersion}
                  </Mono>{' '}
                  {a.actor.kind === 'copilot' ? `Copilot（审批 ${a.approvalId}）` : `牙技师 ${a.actor.id}`} · {a.tool} · {a.captureLevel}
                  {a.regions.length > 0 && <span className="muted-text"> · {a.regions.map((r) => r.label ?? `[${r.t.join(', ')}]`).join('、')}</span>}
                </li>
              ))}
            </ul>
          </details>

          <details>
            <summary>几何差异（{record.deltas.length}）</summary>
            {record.deltas.length === 0 ? (
              <p className="muted-text">尚无几何差异记录（最终确认后才会计算 Final GD）。</p>
            ) : (
              <ul className="plain-list">
                {record.deltas.map((d) => (
                  <li key={d.deltaId}>
                    {d.gdType} GD <Mono>{d.fromVersion} → {d.toVersion}</Mono>：
                    {d.regions
                      .map((r) => `${r.label} ${CORRESPONDENCE_LABEL[r.correspondence]}${r.direction ? ` ${DIRECTION_LABEL[r.direction]} ${r.maxUm} μm` : ''}`)
                      .join('；')}
                  </li>
                ))}
              </ul>
            )}
          </details>

          <details>
            <summary>病例协变量</summary>
            <KeyValue rows={record.covariates.map((c) => [c.label, c.value])} />
          </details>

          <ul className="record-notes">
            {record.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
