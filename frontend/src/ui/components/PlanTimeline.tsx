import { useState } from 'react';
import type { Plan, PlanStep, TaskSnapshot } from '../../runtime/contract';
import { formatDuration, formatTime, shortHash } from '../format';
import { ERROR_CODE_LABEL, SIDE_EFFECTS_LABEL, STEP_STATE_LABEL, TIER_LABEL } from '../presenters/labels';
import { stepDisplay } from '../presenters/steps';
import { Badge, KeyValue, Mono, StatusIcon } from './primitives';

export function PlanTimeline({ task }: { task: TaskSnapshot }) {
  const active = task.plans.find((p) => p.status === 'active');
  const superseded = task.plans.filter((p) => p.status === 'superseded').reverse();

  if (!active) {
    return (
      <p className="empty-note">
        {task.state === 'CANCELLED' ? '任务在写出计划之前已取消。' : '正在规划：Copilot 写出计划后，步骤会显示在这里。'}
      </p>
    );
  }
  return (
    <div className="plan">
      <PlanBlock plan={active} task={task} />
      {superseded.map((p) => (
        <details key={p.planId} className="plan-superseded">
          <summary>
            计划 v{p.version}（已被取代）· {p.steps.length} 个步骤
          </summary>
          <PlanBlock plan={p} task={task} />
        </details>
      ))}
    </div>
  );
}

function PlanBlock({ plan, task }: { plan: Plan; task: TaskSnapshot }) {
  return (
    <div className="plan-block">
      <p className="plan-head">
        <strong>计划 v{plan.version}</strong>
        <span className="muted-text"> · {formatTime(plan.createdAt)}</span>
        {plan.reason && <span className="plan-reason">修订原因：{plan.reason}</span>}
      </p>
      <ol className="steps">
        {plan.steps.map((s) => (
          <StepRow key={s.stepId} step={s} plan={plan} task={task} />
        ))}
      </ol>
    </div>
  );
}

function StepRow({ step, plan, task }: { step: PlanStep; plan: Plan; task: TaskSnapshot }) {
  const [open, setOpen] = useState(false);
  const display = stepDisplay(step, plan, task);
  const last = step.attempts[step.attempts.length - 1];
  return (
    <li className={`step tone-line-${display.tone}`} data-testid={`step-${step.stepId}`}>
      <div className="step-main">
        <StatusIcon tone={display.tone} />
        <div className="step-body">
          <div className="step-title-row">
            <span className="step-title">
              {step.index}. {step.title}
            </span>
            <Badge tone={step.tool.tier === 'E' ? 'waiting' : 'neutral'} title={`权限级别 ${step.tool.tier}`}>
              {step.tool.tier} · {TIER_LABEL[step.tool.tier]}
            </Badge>
          </div>
          <div className="step-status-row">
            <span className={`tone-text-${display.tone}`}>{display.label}</span>
            {step.attempts.length > 1 && <span className="muted-text"> · 第 {step.attempts.length} 次尝试</span>}
            {last?.errorCode && (
              <span className="muted-text"> · {ERROR_CODE_LABEL[last.errorCode]}</span>
            )}
          </div>
          {last?.errorMessage && display.tone === 'danger' && <p className="step-error">{last.errorMessage}</p>}
          {last?.outputSummary && <p className="step-output">{last.outputSummary}</p>}
        </div>
        <button
          type="button"
          className="btn btn-link"
          aria-expanded={open}
          aria-controls={`diag-${step.stepId}`}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '收起' : '详情'}
        </button>
      </div>
      {open && <StepDiagnostics step={step} />}
    </li>
  );
}

function StepDiagnostics({ step }: { step: PlanStep }) {
  return (
    <div className="step-diag" id={`diag-${step.stepId}`}>
      <p className="step-purpose">{step.purpose}</p>
      <KeyValue
        rows={[
          ['工具', <Mono key="t">{`${step.tool.toolId}@${step.tool.version}`}</Mono>],
          ['类型 / 副作用', `${step.tool.kind} · ${SIDE_EFFECTS_LABEL[step.tool.sideEffects]}`],
          ['确定性 / 幂等', `${step.tool.deterministic ? '确定性' : '非确定性'} · ${step.tool.idempotent ? '幂等' : '非幂等'}`],
          ['最多尝试', String(step.maxAttempts)],
          ['步骤 ID', <Mono key="s">{step.stepId}</Mono>],
        ]}
      />
      {step.attempts.length === 0 ? (
        <p className="muted-text">尚无调用记录。</p>
      ) : (
        <div className="table-scroll">
          <table className="attempts">
            <caption className="visually-hidden">调用记录</caption>
            <thead>
              <tr>
                <th>#</th>
                <th>状态</th>
                <th>错误</th>
                <th>耗时</th>
                <th>输入哈希</th>
                <th>输出哈希</th>
              </tr>
            </thead>
            <tbody>
              {step.attempts.map((a) => (
                <tr key={a.attempt}>
                  <td>{a.attempt}</td>
                  <td>
                    {STEP_STATE_LABEL[a.state]}
                    {a.reconciled && <span className="muted-text">（经对账）</span>}
                  </td>
                  <td>{a.errorCode ? `${a.errorCode}${a.errorMessage ? `：${a.errorMessage}` : ''}` : '—'}</td>
                  <td>{formatDuration(a.durationMs)}</td>
                  <td>
                    <Mono>{shortHash(a.input?.hash)}</Mono>
                  </td>
                  <td>
                    <Mono>{shortHash(a.output?.hash)}</Mono>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
