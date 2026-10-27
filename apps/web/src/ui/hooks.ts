import { useCallback, useEffect, useRef, useState } from 'react';
import {
  toErrorInfo,
  type CaseRecordView,
  type ErrorInfo,
  type EventEnvelope,
  type Receipt,
  type RecordsClient,
  type RuntimeClient,
  type TaskSnapshot,
  type TaskSummary,
  type TaskUpdate,
} from '@cadcopilot/contracts';

/** Every error, from any layer, reduced to one shape for display. */
export function describeError(err: unknown): ErrorInfo {
  return toErrorInfo(err);
}

export function errorMessage(err: unknown): string {
  return describeError(err).message;
}

export function useTaskList(runtime: RuntimeClient): TaskSummary[] {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  useEffect(() => {
    let alive = true;
    void runtime.listTasks().then((t) => alive && setTasks(t));
    const unsubscribe = runtime.subscribeTaskList((t) => alive && setTasks(t));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [runtime]);
  return tasks;
}

interface TaskState {
  snapshot: TaskSnapshot;
  events: EventEnvelope[];
}

function mergeUpdate(state: TaskState, update: TaskUpdate): TaskState {
  const known = new Set(state.events.map((e) => e.eventId));
  const events = [...state.events, ...update.events.filter((e) => !known.has(e.eventId))].sort((a, b) => a.seq - b.seq);
  return { snapshot: update.snapshot.seq >= state.snapshot.seq ? update.snapshot : state.snapshot, events };
}

export type TaskLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: string; code: string }
  | { status: 'ready'; snapshot: TaskSnapshot; events: EventEnvelope[] };

/** Snapshot + event log of one task, kept current through the subscription. */
export function useTask(runtime: RuntimeClient, taskId: string | null): { load: TaskLoad; reload: () => void } {
  const [load, setLoad] = useState<TaskLoad>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!taskId) {
      setLoad({ status: 'idle' });
      return undefined;
    }
    let alive = true;
    setLoad({ status: 'loading' });
    // Updates that arrive before the initial fetch resolves are buffered, then
    // merged by seq so none is lost.
    let current: TaskState | null = null;
    const buffered: TaskUpdate[] = [];
    const unsubscribe = runtime.subscribe(taskId, (update) => {
      if (!alive) return;
      if (!current) {
        buffered.push(update);
        return;
      }
      current = mergeUpdate(current, update);
      setLoad({ status: 'ready', ...current });
    });
    Promise.all([runtime.getTask(taskId), runtime.listEvents(taskId)])
      .then(([snapshot, events]) => {
        if (!alive) return;
        let merged: TaskState = { snapshot, events };
        for (const u of buffered.splice(0)) merged = mergeUpdate(merged, u);
        current = merged;
        setLoad({ status: 'ready', ...merged });
      })
      .catch((err) => {
        if (!alive) return;
        const info = describeError(err);
        setLoad({ status: 'error', error: info.message, code: info.code });
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [runtime, taskId, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { load, reload };
}

export type Submission =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'submitted'; receipt: Receipt }
  | { status: 'error'; error: string; code: string };

/**
 * Tracks a request to the Runtime. 'submitted' only means the Runtime
 * acknowledged receipt; callers must wait for the snapshot to show the result.
 */
export function useSubmission(): {
  submission: Submission;
  submit: (fn: () => Promise<Receipt>) => Promise<void>;
  reset: () => void;
} {
  const [submission, setSubmission] = useState<Submission>({ status: 'idle' });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const submit = useCallback(async (fn: () => Promise<Receipt>) => {
    setSubmission({ status: 'submitting' });
    try {
      const receipt = await fn();
      if (alive.current) setSubmission({ status: 'submitted', receipt });
    } catch (err) {
      const info = describeError(err);
      if (alive.current) setSubmission({ status: 'error', error: info.message, code: info.code });
    }
  }, []);
  const reset = useCallback(() => setSubmission({ status: 'idle' }), []);
  return { submission, submit, reset };
}

export type RecordLoad =
  | { status: 'loading' }
  | { status: 'error'; error: ErrorInfo }
  | { status: 'ready'; record: CaseRecordView };

/** A case record, refreshed whenever the data layer reports a change for the case. */
export function useCaseRecord(records: RecordsClient, caseId: string): RecordLoad {
  const [load, setLoad] = useState<RecordLoad>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    const fetchRecord = () =>
      records
        .getCaseRecord(caseId)
        .then((record) => alive && setLoad({ status: 'ready', record }))
        .catch((err) => alive && setLoad({ status: 'error', error: describeError(err) }));
    setLoad({ status: 'loading' });
    void fetchRecord();
    const unsubscribe = records.subscribeCase(caseId, () => void fetchRecord());
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [records, caseId]);
  return load;
}
