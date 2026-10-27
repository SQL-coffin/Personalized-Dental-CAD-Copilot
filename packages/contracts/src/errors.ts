/**
 * One error vocabulary for every layer.
 *
 * - `RuntimeClientError` is what a port (RuntimeClient, ApprovalChannel, …)
 *   rejects with: a request-level failure.
 * - `ToolErrorCode` is what a step attempt records (§7.3).
 * - `ErrorInfo` is the serialisable shape both reduce to, so a future network
 *   transport can carry errors without class instances.
 */

export type ErrorLayer = 'client' | 'runtime' | 'policy' | 'tool' | 'adapter' | 'data' | 'research';

export interface ErrorInfo {
  layer: ErrorLayer;
  code: string;
  message: string;
  retryable: boolean;
}

export type RuntimeClientErrorCode =
  | 'UNAVAILABLE'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_REQUEST'
  /** The port exists but this implementation does not provide it yet (placeholder adapters). */
  | 'NOT_IMPLEMENTED';

/** Request-level error raised by a port implementation. */
export class RuntimeClientError extends Error {
  readonly code: RuntimeClientErrorCode;
  readonly retryable: boolean;

  constructor(code: RuntimeClientErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'RuntimeClientError';
    this.code = code;
    this.retryable = retryable;
  }

  toInfo(): ErrorInfo {
    return { layer: 'client', code: this.code, message: this.message, retryable: this.retryable };
  }
}

/** §7.3 error codes the Runtime records for a step attempt. */
export type ToolErrorCode =
  | 'INVALID_INPUT'
  | 'POLICY_DENIED'
  | 'NEEDS_APPROVAL'
  | 'BASE_VERSION_CHANGED'
  | 'DATA_UNAVAILABLE'
  | 'TIMEOUT'
  | 'TOOL_ERROR'
  | 'NOT_EXECUTED'
  | 'POSTCONDITION_FAILED'
  | 'NOT_REGISTERED'
  /** The adapter behind the tool is a placeholder or is not configured. */
  | 'NOT_CONFIGURED';

/** Reduce anything thrown to ErrorInfo; unknown errors are reported, never swallowed. */
export function toErrorInfo(err: unknown, layer: ErrorLayer = 'client'): ErrorInfo {
  if (err instanceof RuntimeClientError) return err.toInfo();
  if (err && typeof err === 'object' && 'info' in err) {
    const info = (err as { info: unknown }).info;
    if (info && typeof info === 'object' && 'code' in info && 'message' in info) return info as ErrorInfo;
  }
  if (err instanceof Error) return { layer, code: 'UNEXPECTED', message: err.message, retryable: false };
  return { layer, code: 'UNEXPECTED', message: String(err), retryable: false };
}
