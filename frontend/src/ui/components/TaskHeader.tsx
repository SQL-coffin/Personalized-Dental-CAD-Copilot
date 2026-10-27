import { useState } from 'react';
import { TERMINAL_TASK_STATES, type CaseSummary, type DeploymentInfo, type RuntimeClient, type TaskSnapshot } from '../../runtime/contract';
import { useSubmission } from '../hooks';
import { BLOCKED_REASON_LABEL, TASK_STATE_LABEL, taskTone } from '../presenters/labels';
import { activePlan, planProgress } from '../presenters/steps';
import { Badge, InlineError, Mono, Pending, StatusIcon } from './primitives';

const CAD_WRITE_LABEL = {
  none: '未写入 CAD',
  applied: '已写入 CAD',
  unknown: '写入结果不明',
} as const;

export function TaskHeader({
  task,
  caseInfo,
  deployment,
  runtime,
}: {
  task: TaskSnapshot;
  caseInfo: CaseSummary | undefined;
  deployment: DeploymentInfo;
  runtime: RuntimeClient;
}) {
  const [confirming, setConfirming] = useState(false);
  const { submission, submit, reset } = useSubmission();
  const terminal = TERMINAL_TASK_STATES.includes(task.state);
  const canCancel = deployment.capabilities.cancelTask && !terminal;
  const tone = taskTone(task.state);
  const plan = activePlan(task);
  const progress = plan ? planProgress(plan) : null;
  const sideEffectInFlight = task.plans.some((p) =>
    p.steps.some((s) => s.tool.sideEffects !== 'none' && (s.state === 'INTENT_RECORDED' || s.state === 'EXECUTING' || s.state === 'IN_DOUBT')),
  );

  return (
    <header className="task-header">
      <div className="task-header-main">
        <div className="task-title-row">
          <h1 className="task-title">{task.title}</h1>
          <Badge tone={tone}>
            <StatusIcon tone={tone} />
            {TASK_STATE_LABEL[task.state]}
            {task.state === 'BLOCKED' && task.blocked ? ` · ${BLOCKED_REASON_LABEL[task.blocked.reason]}` : ''}
          </Badge>
        </div>
        <p className="task-meta">
          <Mono>{task.taskId}</Mono>
          {caseInfo && (
            <>
              {' · '}病例 <Mono>{caseInfo.caseId}</Mono> · {caseInfo.tooth} 号牙 · {caseInfo.restoration}
              {caseInfo.synthetic ? '（合成）' : ''}
            </>
          )}
          {progress && ` · 计划 v${plan!.version}：${progress.done}/${progress.total} 步已完成`}
        </p>
      </div>

      {canCancel && (
        <div className="task-header-actions">
          {task.cancelRequested || submission.status === 'submitted' ? (
            <Pending>取消请求已提交，等待 Runtime 在下一个安全点应用…</Pending>
          ) : confirming ? (
            <div className="confirm-row" role="group" aria-label="确认取消任务">
              <span>
                确认取消此任务？尚未开始的步骤不会再执行。
                {sideEffectInFlight && ' 正在进行的写入会先完成或对账，取消不会撤销已发生的写入。'}
              </span>
              <button
                type="button"
                className="btn btn-danger"
                disabled={submission.status === 'submitting'}
                onClick={() => void submit(() => runtime.cancelTask(task.taskId, '牙技师取消'))}
              >
                确认取消任务
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setConfirming(false);
                  reset();
                }}
              >
                返回
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(true)}>
              取消任务
            </button>
          )}
          {submission.status === 'error' && <InlineError>{submission.error}</InlineError>}
        </div>
      )}

      {terminal && task.outcome && (
        <div className={`outcome tone-box-${tone}`} role="status">
          <div className="outcome-head">
            <StatusIcon tone={tone} />
            <strong>{TASK_STATE_LABEL[task.state]}</strong>
            <Badge tone={task.outcome.cadWrite === 'applied' ? 'success' : task.outcome.cadWrite === 'unknown' ? 'danger' : 'muted'}>
              {CAD_WRITE_LABEL[task.outcome.cadWrite]}
            </Badge>
          </div>
          <p>{task.outcome.summary}</p>
        </div>
      )}
    </header>
  );
}
