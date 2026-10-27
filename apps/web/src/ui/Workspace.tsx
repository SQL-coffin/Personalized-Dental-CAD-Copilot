import { useCallback, useState, type ReactNode } from 'react';
import type { CaseSummary, DeploymentInfo, RuntimePorts } from '@cadcopilot/contracts';
import { BlockedBanner } from './components/BlockedBanner';
import { CaseRecordPanel } from './components/CaseRecordPanel';
import { Conversation } from './components/Conversation';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { HeaderBar, SimulationBanner } from './components/HeaderBar';
import { NewTaskComposer } from './components/NewTaskComposer';
import { PlanTimeline } from './components/PlanTimeline';
import { InlineError, Pending, Section } from './components/primitives';
import { ReviewPanel } from './components/ReviewPanel';
import { TaskHeader } from './components/TaskHeader';
import { TaskHistory } from './components/TaskHistory';
import { useTask, useTaskList } from './hooks';

/**
 * The product UI. Depends only on the runtime contract (ports + data types);
 * it does not know whether the Runtime is simulated or real.
 */
export function Workspace({
  ports,
  deployment,
  cases,
  sidebarFooter,
}: {
  ports: RuntimePorts;
  deployment: DeploymentInfo;
  cases: CaseSummary[];
  sidebarFooter?: ReactNode;
}) {
  const { runtime, approvals, feedback, records } = ports;
  const tasks = useTaskList(runtime);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { load, reload } = useTask(runtime, selectedId);

  const goToApproval = useCallback(() => {
    const el = document.getElementById('approval-card');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('approval-title')?.focus();
  }, []);

  const task = load.status === 'ready' ? load.snapshot : null;
  const caseInfo = task?.caseId ? cases.find((c) => c.caseId === task.caseId) : undefined;
  const pendingApproval = task?.approvalRequests.some((r) => r.status === 'pending');
  const plan = task && (
    <Section title="执行计划">
      <PlanTimeline task={task} />
    </Section>
  );
  const review = task && (
    <Section title="审阅与审批" aside={pendingApproval ? <span className="badge tone-waiting">待审批</span> : undefined}>
      <ReviewPanel task={task} deployment={deployment} approvals={approvals} />
    </Section>
  );

  return (
    <div className="app">
      <HeaderBar deployment={deployment} />
      {deployment.simulated && <SimulationBanner />}
      <div className="layout">
        <aside className="sidebar">
          <TaskHistory tasks={tasks} selectedId={selectedId} onSelect={setSelectedId} onNew={() => setSelectedId(null)} />
        </aside>
        {sidebarFooter && <div className="proto-slot">{sidebarFooter}</div>}

        <main className="main" aria-label="任务工作区">
          {!task && (
            <div className="main-scroll">
              {selectedId === null && (
                <NewTaskComposer runtime={runtime} deployment={deployment} cases={cases} onCreated={setSelectedId} />
              )}
              {load.status === 'loading' && <Pending>正在加载任务…</Pending>}
              {load.status === 'error' && (
                <div className="error-state">
                  <InlineError code={load.code}>无法加载任务：{load.error}</InlineError>
                  <button type="button" className="btn btn-secondary" onClick={reload}>
                    重试
                  </button>
                </div>
              )}
            </div>
          )}
          {task && (
            <div className="task-view" key={task.taskId}>
              <div className="task-top">
                <TaskHeader task={task} caseInfo={caseInfo} deployment={deployment} runtime={runtime} />
                <BlockedBanner
                  key={`${task.blocked?.reason ?? 'none'}-${task.blocked?.since ?? ''}`}
                  task={task}
                  feedback={feedback}
                  onGoToApproval={goToApproval}
                />
              </div>
              <Conversation task={task} runtime={runtime} />
            </div>
          )}
        </main>

        <aside className="inspector" aria-label="计划与审阅">
          {task ? (
            <>
              {/* The decision that is waiting on the user goes first. */}
              {pendingApproval ? (
                <>
                  {review}
                  {plan}
                </>
              ) : (
                <>
                  {plan}
                  {review}
                </>
              )}
              {records && task.caseId && <CaseRecordPanel key={task.caseId} records={records} caseId={task.caseId} />}
              {load.status === 'ready' && <DiagnosticsPanel task={task} events={load.events} integrations={deployment.integrations} />}
            </>
          ) : (
            <p className="empty-note inspector-empty">选择或新建任务后，这里会显示执行计划、候选与审批。</p>
          )}
        </aside>
      </div>
    </div>
  );
}
