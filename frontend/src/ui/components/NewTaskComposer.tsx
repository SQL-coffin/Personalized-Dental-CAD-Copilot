import { useState, type FormEvent } from 'react';
import type { CaseSummary, DeploymentInfo, RuntimeClient } from '../../runtime/contract';
import { errorMessage } from '../hooks';
import { InlineError, Mono } from './primitives';

const ASSIST_EXAMPLES = [
  '检查远中颊侧的 margin line，按我的修正习惯给出候选',
  '这条 margin line 有哪些区域我通常会修改？',
];
const RESEARCH_EXAMPLES = ['检索 margin line 自动识别的公开研究，整理来源'];

export function NewTaskComposer({
  runtime,
  deployment,
  cases,
  onCreated,
}: {
  runtime: RuntimeClient;
  deployment: DeploymentInfo;
  cases: CaseSummary[];
  onCreated: (taskId: string) => void;
}) {
  const needsCase = deployment.capabilities.caseSelection;
  const [prompt, setPrompt] = useState('');
  const [caseId, setCaseId] = useState<string>(cases[0]?.caseId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = cases.find((c) => c.caseId === caseId);
  const examples = needsCase ? ASSIST_EXAMPLES : RESEARCH_EXAMPLES;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) {
      setError('请先描述任务');
      return;
    }
    if (needsCase && !caseId) {
      setError('请选择一个病例');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const task = await runtime.createTask({ prompt, caseId: needsCase ? caseId : null });
      onCreated(task.taskId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="composer-card" onSubmit={onSubmit} aria-label="新建任务">
      <h1 className="composer-title">要让 Copilot 做什么？</h1>
      <p className="composer-sub">
        用自然语言描述任务。Copilot 会先给出执行计划；任何写入 CAD 的动作都需要你逐次批准。
      </p>

      {needsCase ? (
        <div className="field">
          <label htmlFor="case-select">病例</label>
          {cases.length === 0 ? (
            <p className="empty-note">Runtime 没有返回可选择的病例。</p>
          ) : (
            <select id="case-select" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              {cases.map((c) => (
                <option key={c.caseId} value={c.caseId}>
                  {c.caseId} · {c.tooth} 号牙 · {c.restoration}
                  {c.synthetic ? '（合成）' : ''}
                </option>
              ))}
            </select>
          )}
          {selected && (
            <p className="field-help">
              患者假名 <Mono>{selected.patientPseudonym}</Mono> · 设计对象 margin line · 当前版本{' '}
              <Mono>{selected.currentVersion.versionId}</Mono> · 采集粒度 {selected.captureLevel}
            </p>
          )}
          <p className="field-help">
            病例来自 Runtime 中已假名化的记录。本界面不提供文件上传：原始扫描需先经数据适配器去标识后才能进入证据存储。
          </p>
        </div>
      ) : (
        <p className="field-help">当前为离线研究模式：任务只检索公开资料，不读取任何病例或患者数据。</p>
      )}

      <div className="field">
        <label htmlFor="task-prompt">任务描述</label>
        <textarea
          id="task-prompt"
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例如：检查远中颊侧的 margin line，按我的修正习惯给出候选"
        />
        <div className="chips" aria-label="示例任务">
          {examples.map((ex) => (
            <button key={ex} type="button" className="chip" onClick={() => setPrompt(ex)}>
              {ex}
            </button>
          ))}
        </div>
      </div>

      {error && <InlineError>{error}</InlineError>}
      <div className="composer-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? '正在创建…' : '开始任务'}
        </button>
      </div>
    </form>
  );
}
