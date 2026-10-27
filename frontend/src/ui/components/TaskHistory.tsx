import type { TaskSummary } from '../../runtime/contract';
import { formatTime } from '../format';
import { BLOCKED_REASON_LABEL, TASK_STATE_LABEL, taskTone } from '../presenters/labels';
import { StatusIcon } from './primitives';

export function TaskHistory({
  tasks,
  selectedId,
  onSelect,
  onNew,
}: {
  tasks: TaskSummary[];
  selectedId: string | null;
  onSelect: (taskId: string) => void;
  onNew: () => void;
}) {
  return (
    <nav className="history" aria-label="任务历史">
      <button type="button" className="btn btn-primary btn-block" onClick={onNew} aria-pressed={selectedId === null}>
        新建任务
      </button>
      <h2 className="history-title">任务历史</h2>
      {tasks.length === 0 ? (
        <p className="empty-note">还没有任务。描述你想让 Copilot 检查或分析的内容即可开始。</p>
      ) : (
        <ul className="history-list">
          {tasks.map((t) => {
            const tone = taskTone(t.state);
            const label = t.state === 'BLOCKED' && t.blockedReason ? BLOCKED_REASON_LABEL[t.blockedReason] : TASK_STATE_LABEL[t.state];
            return (
              <li key={t.taskId}>
                <button
                  type="button"
                  className={`history-item${t.taskId === selectedId ? ' is-selected' : ''}`}
                  onClick={() => onSelect(t.taskId)}
                  aria-current={t.taskId === selectedId ? 'true' : undefined}
                >
                  <StatusIcon tone={tone} />
                  <span className="history-item-body">
                    <span className="history-item-title">{t.title}</span>
                    <span className="history-item-meta">
                      <span className={`tone-text-${tone}`}>{label}</span>
                      {t.caseId ? ` · ${t.caseId}` : ''} · {formatTime(t.updatedAt)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
