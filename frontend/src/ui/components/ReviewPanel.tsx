import type { ApprovalChannel, DeploymentInfo, TaskSnapshot } from '../../runtime/contract';
import { ApprovalCard, ApprovalHistory } from './ApprovalCard';
import { CandidateCard } from './CandidateCard';

export function ReviewPanel({
  task,
  deployment,
  approvals,
}: {
  task: TaskSnapshot;
  deployment: DeploymentInfo;
  approvals: ApprovalChannel | null;
}) {
  const pending = [...task.approvalRequests].reverse().find((r) => r.status === 'pending');
  const history = task.approvalRequests.filter((r) => r !== pending).reverse();
  const candidates = [...task.candidates].reverse();
  const [latest, ...older] = candidates;
  const decisionFor = (candidateId: string) => [...task.decisions].reverse().find((d) => d.candidateId === candidateId);

  if (!latest && !pending && history.length === 0) {
    return (
      <p className="empty-note">
        尚无候选。候选在生成并经过质量闸门后才会出现在这里；未通过闸门的候选只展示诊断信息。
      </p>
    );
  }

  return (
    <div className="review">
      {pending && (
        <ApprovalCard
          key={pending.approvalRequestId}
          request={pending}
          candidate={task.candidates.find((c) => c.candidateId === pending.candidateId)}
          task={task}
          deployment={deployment}
          approvals={approvals}
        />
      )}
      {latest && <CandidateCard candidate={latest} decision={decisionFor(latest.candidateId)} simulated={task.simulated} />}
      {deployment.mode === 'assist' && latest && (
        <p className="field-help">当前部署为「只给建议」模式，没有写入 CAD 的工具。如需采用候选，请在 CAD 中手动修改。</p>
      )}
      {older.map((c) => (
        <details key={c.candidateId} className="older-candidate">
          <summary>较早的候选 {c.candidateId}</summary>
          <CandidateCard candidate={c} decision={decisionFor(c.candidateId)} simulated={task.simulated} />
        </details>
      ))}
      <ApprovalHistory requests={history} />
    </div>
  );
}
