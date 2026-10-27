import { useEffect, useRef, useState, type FormEvent } from 'react';
import { TERMINAL_TASK_STATES, type ConversationMessage, type RuntimeClient, type TaskSnapshot } from '@cadcopilot/contracts';
import { formatTime } from '../format';
import { useSubmission } from '../hooks';
import { InlineError } from './primitives';

const ROLE_LABEL: Record<ConversationMessage['role'], string> = {
  user: '你',
  agent: 'Copilot',
  system: 'Runtime',
};

export function Conversation({ task, runtime }: { task: TaskSnapshot; runtime: RuntimeClient }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const count = task.messages.length;
  useEffect(() => {
    // Scroll only the message list itself; never move the page away from
    // the task header or a blocked notice.
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  return (
    <div className="conversation">
      <div className="messages-scroll" ref={scrollRef}>
        <ol className="messages" aria-label="对话" aria-live="polite">
          {task.messages.map((m) => (
            <li key={m.messageId} className={`message role-${m.role}`}>
              <div className="message-meta">
                <span className="message-role">{ROLE_LABEL[m.role]}</span>
                <span>{formatTime(m.createdAt)}</span>
                {m.role === 'agent' && m.refs.length === 0 && (
                  <span className="unverified" title="05 §9.2：没有引用证据或记录的叙述，不具有权威性">
                    未引用证据
                  </span>
                )}
              </div>
              <p className="message-text">{m.text}</p>
              {m.refs.length > 0 && (
                <ul className="refs" aria-label="引用">
                  {m.refs.map((r) => (
                    <li key={r.ref} title={r.ref}>
                      {r.label}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </div>
      <FollowUp task={task} runtime={runtime} />
    </div>
  );
}

function FollowUp({ task, runtime }: { task: TaskSnapshot; runtime: RuntimeClient }) {
  const [text, setText] = useState('');
  const { submission, submit, reset } = useSubmission();
  const terminal = TERMINAL_TASK_STATES.includes(task.state);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const value = text;
    await submit(() => runtime.postMessage(task.taskId, value));
    setText('');
  }

  if (terminal) {
    return <p className="followup-closed">任务已结束。如需继续，请新建任务。</p>;
  }
  return (
    <form className="followup" onSubmit={onSubmit} aria-label="发送消息">
      <label htmlFor="followup-input" className="visually-hidden">
        给 Copilot 发消息
      </label>
      <textarea
        id="followup-input"
        rows={2}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (submission.status !== 'idle') reset();
        }}
        placeholder="补充说明或提问…"
      />
      <div className="followup-foot">
        <span className="field-help">对话消息不构成审批，也不会改变任务权限、预算或策略。</span>
        <button type="submit" className="btn btn-secondary" disabled={!text.trim() || submission.status === 'submitting'}>
          发送
        </button>
      </div>
      {submission.status === 'error' && <InlineError code={submission.code}>{submission.error}</InlineError>}
    </form>
  );
}
