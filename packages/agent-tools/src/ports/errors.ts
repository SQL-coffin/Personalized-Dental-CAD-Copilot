import type { ErrorInfo } from '@cadcopilot/contracts';

export type AdapterErrorCode =
  /** The adapter boundary exists, the implementation does not (placeholder). */
  | 'NOT_IMPLEMENTED'
  /** Implemented, but no endpoint, credential or provider is configured. */
  | 'NOT_CONFIGURED'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'REJECTED'
  | 'INVALID_RESPONSE';

/**
 * Error raised by an external-system adapter. `outcome` says whether the
 * request could have taken effect, which decides §7.3 handling: a request
 * that was not executed may be retried; one with an unknown outcome must be
 * reconciled first.
 */
export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly adapterId: string;
  readonly outcome: 'not_executed' | 'unknown';
  readonly info: ErrorInfo;

  constructor(adapterId: string, code: AdapterErrorCode, message: string, outcome: 'not_executed' | 'unknown' = 'not_executed') {
    super(message);
    this.name = 'AdapterError';
    this.adapterId = adapterId;
    this.code = code;
    this.outcome = outcome;
    this.info = { layer: 'adapter', code, message, retryable: code === 'UNAVAILABLE' || code === 'TIMEOUT' };
  }
}
