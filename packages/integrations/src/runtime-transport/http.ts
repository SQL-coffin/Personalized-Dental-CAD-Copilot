/**
 * HTTP/SSE transport to a Runtime running in its own process — the boundary
 * for a real Runtime. Not implemented: every call rejects with
 * NOT_IMPLEMENTED, so the UI shows a clear error instead of pretending to
 * be connected.
 *
 * RUNTIME_HTTP_ROUTES is the proposed wire mapping of every port method
 * (docs/architecture/extension-points.md, backend interfaces B1–B12). The
 * `satisfies` clause makes the compiler flag any port method without a route.
 */
import {
  RuntimeClientError,
  type ApprovalChannel,
  type HumanFeedbackChannel,
  type RecordsClient,
  type RuntimeClient,
  type RuntimePorts,
} from '@cadcopilot/contracts';

export interface HttpRoute {
  method: 'GET' | 'POST';
  path: string;
  /** Streaming routes use Server-Sent Events and resume from the last seen seq. */
  transport?: 'sse';
  /** Approval decisions go through a separately authenticated channel (I4). */
  channel?: 'approval';
}

type PortMethods = keyof RuntimeClient | keyof ApprovalChannel | keyof HumanFeedbackChannel | keyof RecordsClient;

export const RUNTIME_HTTP_ROUTES = {
  getDeployment: { method: 'GET', path: '/v0/deployment' },
  listCases: { method: 'GET', path: '/v0/cases' },
  getCaseRecord: { method: 'GET', path: '/v0/cases/:caseId/record' },
  subscribeCase: { method: 'GET', path: '/v0/cases/:caseId/stream', transport: 'sse' },
  listTasks: { method: 'GET', path: '/v0/tasks' },
  subscribeTaskList: { method: 'GET', path: '/v0/tasks/stream', transport: 'sse' },
  createTask: { method: 'POST', path: '/v0/tasks' },
  getTask: { method: 'GET', path: '/v0/tasks/:taskId' },
  listEvents: { method: 'GET', path: '/v0/tasks/:taskId/events?after_seq=:seq' },
  subscribe: { method: 'GET', path: '/v0/tasks/:taskId/stream?after_seq=:seq', transport: 'sse' },
  postMessage: { method: 'POST', path: '/v0/tasks/:taskId/messages' },
  cancelTask: { method: 'POST', path: '/v0/tasks/:taskId/cancel' },
  submit: { method: 'POST', path: '/v0/tasks/:taskId/feedback' },
  submitDecision: { method: 'POST', path: '/v0/approvals/:approvalRequestId/decision', channel: 'approval' },
} as const satisfies Record<PortMethods, HttpRoute>;

export interface HttpTransportConfig {
  baseUrl: string;
}

function notImplemented(method: PortMethods, config: HttpTransportConfig): RuntimeClientError {
  const route: HttpRoute = RUNTIME_HTTP_ROUTES[method];
  return new RuntimeClientError(
    'NOT_IMPLEMENTED',
    `HTTP/SSE 传输尚未实现（${route.method} ${config.baseUrl}${route.path}）。当前只能使用进程内模拟 Runtime。`,
    false,
  );
}

/** Ports for a networked Runtime. Placeholder: nothing is sent. */
export function createHttpRuntimePorts(config: HttpTransportConfig): RuntimePorts {
  const reject = (method: PortMethods) => () => Promise.reject(notImplemented(method, config));
  const runtime: RuntimeClient = {
    getDeployment: reject('getDeployment'),
    listCases: reject('listCases'),
    listTasks: reject('listTasks'),
    getTask: reject('getTask'),
    listEvents: reject('listEvents'),
    createTask: reject('createTask'),
    postMessage: reject('postMessage'),
    cancelTask: reject('cancelTask'),
    subscribe: () => () => undefined,
    subscribeTaskList: () => () => undefined,
  };
  return {
    runtime,
    approvals: { submitDecision: reject('submitDecision') },
    feedback: { submit: reject('submit') },
    records: { getCaseRecord: reject('getCaseRecord'), subscribeCase: () => () => undefined },
  };
}
