/** Raised inside an agent's run when a recorded cancel request takes effect. */
export class CancelSignal extends Error {
  constructor() {
    super('task cancelled');
    this.name = 'CancelSignal';
  }
}

/** An agent or the engine broke a Runtime rule (e.g. ran a step outside RUNNING). */
export class RuntimeInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeInvariantError';
  }
}
