import { useState } from 'react';
import type { ApprovalChannel, ApprovalDecision, ApprovalRequest, Candidate, DeploymentInfo, TaskSnapshot } from '@cadcopilot/contracts';
import { formatTime, shortHash } from '../format';
import { useSubmission } from '../hooks';
import { approvalAvailability } from '../presenters/approval';
import { APPROVAL_STATUS_LABEL } from '../presenters/labels';
import { InlineError, KeyValue, Mono, Pending } from './primitives';

type Mode = 'idle' | ApprovalDecision;

/**
 * The §10.3 approval channel. Decisions go through ApprovalChannel only;
 * nothing typed into the conversation reaches this path (I4).
 */
export function ApprovalCard({
  request,
  candidate,
  task,
  deployment,
  approvals,
}: {
  request: ApprovalRequest;
  candidate: Candidate | undefined;
  task: TaskSnapshot;
  deployment: DeploymentInfo;
  approvals: ApprovalChannel | null;
}) {
  const [mode, setMode] = useState<Mode>('idle');
  const [note, setNote] = useState('');
  const { submission, submit } = useSubmission();
  const availability = approvalAvailability({ request, candidate, task, deployment, hasChannel: !!approvals });
  const identity = deployment.identity;
  const waitingForRecord = submission.status === 'submitted' && request.status === 'pending';

  function decide(decision: ApprovalDecision) {
    if (!approvals) return;
    if (decision === 'revise' && !note.trim()) return;
    void submit(() =>
      approvals.submitDecision({
        approvalRequestId: request.approvalRequestId,
        candidateHash: request.candidateHash,
        baseVersionId: request.baseVersion.versionId,
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    );
  }

  return (
    <section className="approval" id="approval-card" aria-labelledby="approval-title">
      <h3 id="approval-title" tabIndex={-1}>
        需要你的审批：写入 CAD
      </h3>
      <p>
        将候选 <Mono>{request.candidateId}</Mono> 写入病例 <Mono>{request.target.caseId}</Mono> 的 {request.target.tooth} 号牙
        margin line（基础版本 <Mono>{request.baseVersion.versionId}</Mono>）。
      </p>
      <KeyValue
        rows={[
          ['候选哈希', <Mono key="c">{shortHash(request.candidateHash, 16)}</Mono>],
          ['基础版本', <Mono key="b">{`${request.baseVersion.versionId} · ${shortHash(request.baseVersion.contentHash, 14)}`}</Mono>],
          ['绑定范围', request.baseVersion.scope.join('、')],
          ['执行工具', <Mono key="e">{request.provenance.executor ? `${request.provenance.executor.id}@${request.provenance.executor.version}` : '—'}</Mono>],
          ['闸门标准集 / 策略', <Mono key="g">{`${request.criteriaSetVersion} / ${request.policyVersion}`}</Mono>],
          ['有效期至', formatTime(request.expiresAt)],
          ['可用次数', '1（一次性）'],
        ]}
      />
      <ul className="approval-notes">
        <li>批准只授权这一次写入。执行前会再次核对基础版本；版本变化时审批自动作废。</li>
        <li>批准不代表放行最终设计。最终设计需要你在 CAD 中自行确认。</li>
        <li>对话中的文字（例如「我批准」）不构成审批。</li>
      </ul>
      <p className="field-help">
        审批人：{identity.displayName}（<Mono>{identity.userId}</Mono>）·{' '}
        {identity.authenticated ? '已通过身份验证' : deployment.simulated ? '未经身份验证（模拟部署，审批无实际效力）' : '未经身份验证'}
      </p>

      {!availability.canDecide && request.status === 'pending' && (
        <div className="unavailable" role="note">
          <p>当前不能作出决定：</p>
          <ul className="plain-list">
            {availability.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {waitingForRecord ? (
        <Pending>已提交审批决定（回执 {submission.receipt.receiptId}），等待 Runtime 写入审批记录…</Pending>
      ) : (
        availability.canDecide && (
          <>
            {mode === 'idle' && (
              <div className="button-row">
                <button type="button" className="btn btn-primary" onClick={() => setMode('approve')}>
                  批准执行…
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setMode('revise')}>
                  要求修改方案…
                </button>
                <button type="button" className="btn btn-outline-danger" onClick={() => setMode('reject')}>
                  拒绝…
                </button>
              </div>
            )}
            {mode === 'approve' && (
              <div className="confirm-box" role="group" aria-label="确认批准">
                <p>
                  确认批准把候选 <Mono>{request.candidateId}</Mono> 写入 CAD？
                </p>
                <div className="button-row">
                  <button type="button" className="btn btn-primary" disabled={submission.status === 'submitting'} onClick={() => decide('approve')}>
                    确认批准
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setMode('idle')}>
                    返回
                  </button>
                </div>
              </div>
            )}
            {(mode === 'reject' || mode === 'revise') && (
              <div className="confirm-box" role="group" aria-label={mode === 'reject' ? '拒绝候选' : '要求修改方案'}>
                <div className="field">
                  <label htmlFor="approval-note">{mode === 'revise' ? '修改意见（必填）' : '拒绝理由（可选）'}</label>
                  <textarea id="approval-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
                  <p className="field-help">
                    {mode === 'revise'
                      ? '此候选会被拒绝；Copilot 会按你的意见重新生成候选，新候选需要重新通过质量闸门并重新审批。'
                      : '被拒绝的建议会单独存档，在相似情境下抑制重复推荐。'}
                  </p>
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    className={mode === 'reject' ? 'btn btn-danger' : 'btn btn-primary'}
                    disabled={submission.status === 'submitting' || (mode === 'revise' && !note.trim())}
                    onClick={() => decide(mode)}
                  >
                    {mode === 'reject' ? '确认拒绝' : '提交修改意见'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setMode('idle')}>
                    返回
                  </button>
                </div>
              </div>
            )}
          </>
        )
      )}
      {submission.status === 'error' && <InlineError>{submission.error}</InlineError>}
    </section>
  );
}

/** Compact history row for approval requests that are no longer pending. */
export function ApprovalHistory({ requests }: { requests: ApprovalRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <div className="approval-history">
      <h4>审批记录</h4>
      <ul className="plain-list">
        {requests.map((r) => (
          <li key={r.approvalRequestId}>
            <Mono>{r.approvalRequestId}</Mono> · 候选 <Mono>{r.candidateId}</Mono>：<strong>{APPROVAL_STATUS_LABEL[r.status]}</strong>
            {r.record && (
              <span className="muted-text">
                {' '}
                （{r.record.approver.displayName}，{formatTime(r.record.decidedAt)}
                {r.record.note ? `，「${r.record.note}」` : ''}）
              </span>
            )}
            {r.invalidationReason && <span className="muted-text"> · {r.invalidationReason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
