import { useState } from 'react';
import type { HumanFeedbackChannel, HumanResponseKind, TaskSnapshot } from '@cadcopilot/contracts';
import { formatTime } from '../format';
import { useSubmission } from '../hooks';
import { BLOCKED_REASON_LABEL, RESPONSE_LABEL } from '../presenters/labels';
import { InlineError, Pending, StatusIcon } from './primitives';

/** §6.4 blocked report plus the human responses the Runtime says it accepts. */
export function BlockedBanner({
  task,
  feedback,
  onGoToApproval,
}: {
  task: TaskSnapshot;
  feedback: HumanFeedbackChannel | null;
  onGoToApproval: () => void;
}) {
  const report = task.blocked;
  const [note, setNote] = useState('');
  const { submission, submit } = useSubmission();
  if (task.state !== 'BLOCKED' || !report) return null;

  const severe = report.reason === 'in_doubt' || report.reason === 'budget';
  const responses = feedback ? report.allowedResponses : [];
  const waiting = submission.status === 'submitted';

  function send(kind: HumanResponseKind) {
    if (!feedback) return;
    if (kind === 'replan' && !note.trim()) return;
    void submit(() =>
      feedback.submit({ taskId: task.taskId, blockedReason: report!.reason, kind, ...(note.trim() ? { note: note.trim() } : {}) }),
    );
  }

  return (
    <section className={`blocked tone-box-${severe ? 'danger' : 'waiting'}`} aria-label="任务已暂停" role="region">
      <div className="blocked-head">
        <StatusIcon tone={severe ? 'danger' : 'waiting'} />
        <h2>
          任务已暂停：{BLOCKED_REASON_LABEL[report.reason]}
          <span className="code-chip">BLOCKED({report.reason})</span>
        </h2>
        <span className="muted-text">自 {formatTime(report.since)}</span>
      </div>
      <p>{report.summary}</p>
      <p>
        <strong>需要的操作：</strong>
        {report.requiredAction}
      </p>
      {report.completed.length > 0 && (
        <details>
          <summary>已完成的步骤（{report.completed.length}）</summary>
          <ul className="plain-list">
            {report.completed.map((c, i) => (
              <li key={`${c}-${i}`}>{c}</li>
            ))}
          </ul>
        </details>
      )}

      {report.reason === 'approval' && (
        <button type="button" className="btn btn-primary" onClick={onGoToApproval}>
          前往审批
        </button>
      )}

      {report.reason !== 'approval' && responses.length === 0 && (
        <p className="muted-text">此阻塞状态没有可在本界面完成的操作。你可以等待解除条件满足，或取消任务。</p>
      )}

      {responses.length > 0 && !waiting && (
        <div className="responses">
          {(responses.includes('replan') || responses.includes('continue')) && (
            <div className="field">
              <label htmlFor="feedback-note">
                说明{responses.includes('replan') ? '（改写计划时必填）' : '（可选）'}
              </label>
              <textarea id="feedback-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
          <div className="button-row">
            {responses.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`btn ${kind === 'replan' || kind === 'continue' ? 'btn-secondary' : 'btn-outline'}`}
                disabled={submission.status === 'submitting' || (kind === 'replan' && !note.trim())}
                onClick={() => send(kind)}
              >
                {RESPONSE_LABEL[kind]}
              </button>
            ))}
          </div>
        </div>
      )}
      {waiting && <Pending>已提交（回执 {submission.receipt.receiptId}），等待 Runtime 记录并恢复任务…</Pending>}
      {submission.status === 'error' && <InlineError code={submission.code}>{submission.error}</InlineError>}
    </section>
  );
}
