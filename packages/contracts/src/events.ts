/** Event envelope (§5.1). Event type names are a frontend proposal; 05 does not enumerate them. */

export type EventType =
  | 'TaskCreated'
  | 'TaskStateChanged'
  | 'PlanWritten'
  | 'StepStateChanged'
  | 'ToolCallRecorded'
  | 'ModelCallRecorded'
  | 'CandidateRecorded'
  | 'DecisionRecorded'
  | 'ApprovalRequested'
  | 'ApprovalRecorded'
  | 'ApprovalInvalidated'
  | 'HumanFeedbackRecorded'
  | 'TaskBlocked'
  | 'CancelRequested'
  | 'MessagePosted'
  | 'CheckpointCreated';

/** Events never embed patient data; payloads are refs. */
export interface EventEnvelope {
  eventId: string;
  seq: number;
  prevHash: string;
  hash: string;
  timestamp: string;
  actor: { type: 'human' | 'agent' | 'tool' | 'system' | 'evaluation'; id: string; version?: string };
  taskId: string;
  stepId?: string;
  type: EventType;
  payloadRef?: string;
  schemaVersion: string;
  /** Short non-patient description for the diagnostics view. */
  note?: string;
}
