import { useState } from 'react';
import type { EventEnvelope, TaskSnapshot } from '../../runtime/contract';
import { formatTime, shortHash } from '../format';
import { KeyValue, Mono } from './primitives';

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 1;
  return (
    <div className="budget-row">
      <span>{label}</span>
      <span className="budget-bar" aria-hidden="true">
        <span style={{ width: `${ratio * 100}%` }} className={ratio >= 1 ? 'is-full' : ''} />
      </span>
      <span className="mono">
        {used}/{limit}
      </span>
    </div>
  );
}

/** Advanced diagnostics, collapsed by default so ordinary use stays uncluttered. */
export function DiagnosticsPanel({ task, events }: { task: TaskSnapshot; events: EventEnvelope[] }) {
  const [open, setOpen] = useState(false);
  const [showHashes, setShowHashes] = useState(false);
  return (
    <section className="panel-section diagnostics">
      <header className="panel-section-head">
        <h2>高级诊断</h2>
        <button type="button" className="btn btn-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '展开'}
        </button>
      </header>
      {open && (
        <div className="diag-body">
          <h3>预算</h3>
          <Meter label="循环轮数" used={task.budget.rounds.used} limit={task.budget.rounds.limit} />
          <Meter label="重新规划" used={task.budget.replans.used} limit={task.budget.replans.limit} />
          <Meter label="工具调用" used={task.budget.toolCalls.used} limit={task.budget.toolCalls.limit} />
          <p className="field-help">预算上限由部署配置给出，模型和本界面都不能修改。</p>

          <h3>版本</h3>
          <KeyValue
            rows={[
              ['策略', <Mono key="p">{task.versions.policy}</Mono>],
              ['闸门标准集', <Mono key="g">{task.versions.gateCriteriaSet}</Mono>],
              ['登记记录', <Mono key="r">{task.versions.registration}</Mono>],
              ['模型', task.versions.models.join('、')],
              ['运行模式', <Mono key="m">{task.mode}</Mono>],
              ['事件序号', <Mono key="s">{String(task.seq)}</Mono>],
            ]}
          />

          <div className="diag-events-head">
            <h3>事件日志（{events.length}）</h3>
            <label className="checkbox">
              <input type="checkbox" checked={showHashes} onChange={(e) => setShowHashes(e.target.checked)} /> 显示哈希链
            </label>
          </div>
          <div className="table-scroll events-scroll">
            <table className="events">
              <thead>
                <tr>
                  <th>seq</th>
                  <th>类型</th>
                  <th>说明</th>
                  {showHashes && <th>prev → hash</th>}
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.eventId}>
                    <td className="mono">{e.seq}</td>
                    <td>
                      <span className="mono">{e.type}</span>
                      <span className="event-sub">
                        {formatTime(e.timestamp)} · {e.actor.type}:{e.actor.id}
                      </span>
                    </td>
                    <td>
                      {e.stepId && <Mono>{e.stepId}</Mono>} {e.note}
                    </td>
                    {showHashes && (
                      <td className="mono">
                        {shortHash(e.prevHash, 12)} → {shortHash(e.hash, 12)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
