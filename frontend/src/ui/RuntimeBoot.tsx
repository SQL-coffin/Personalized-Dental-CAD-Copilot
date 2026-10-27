import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { RuntimeClientError, type CaseSummary, type DeploymentInfo, type RuntimePorts } from '../runtime/contract';
import { StatusIcon } from './components/primitives';
import { errorMessage } from './hooks';
import { Workspace } from './Workspace';

type Boot =
  | { status: 'loading' }
  | { status: 'error'; error: string; retryable: boolean }
  | { status: 'ready'; deployment: DeploymentInfo; cases: CaseSummary[] };

/** Connects to the Runtime, then renders the workspace; handles loading and failure. */
export function RuntimeBoot({ ports, sidebarFooter }: { ports: RuntimePorts; sidebarFooter?: ReactNode }) {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setBoot({ status: 'loading' });
    (async () => {
      try {
        const deployment = await ports.runtime.getDeployment();
        const cases = deployment.capabilities.caseSelection ? await ports.runtime.listCases() : [];
        if (alive) setBoot({ status: 'ready', deployment, cases });
      } catch (err) {
        if (alive) {
          setBoot({
            status: 'error',
            error: errorMessage(err),
            retryable: err instanceof RuntimeClientError ? err.retryable : true,
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [ports, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (boot.status === 'loading') {
    return (
      <div className="boot" role="status" aria-live="polite">
        <StatusIcon tone="active" />
        <p>正在连接 Agent Runtime…</p>
      </div>
    );
  }
  if (boot.status === 'error') {
    return (
      <div className="boot boot-error" role="alert">
        <StatusIcon tone="danger" />
        <h1>无法连接 Agent Runtime</h1>
        <p>{boot.error}</p>
        <p className="muted-text">在连接恢复之前，不会显示任何任务状态或审批。</p>
        {boot.retryable && (
          <button type="button" className="btn btn-primary" onClick={retry}>
            重试
          </button>
        )}
        {sidebarFooter && <div className="boot-footer">{sidebarFooter}</div>}
      </div>
    );
  }
  return <Workspace ports={ports} deployment={boot.deployment} cases={boot.cases} sidebarFooter={sidebarFooter} />;
}
