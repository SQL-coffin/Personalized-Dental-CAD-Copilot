/** Controls how fast simulated work advances. Injected so tests stay deterministic. */
export interface Scheduler {
  sleep(ms: number): Promise<void>;
}

export function realtimeScheduler(speed = 1): Scheduler {
  return { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms / speed)) };
}

/** Advances on the next macrotask; scenarios run straight to their next human wait. */
export const instantScheduler: Scheduler = {
  sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

/** Test helper: each sleep waits until the test releases it. */
export class ManualScheduler implements Scheduler {
  private waiting: Array<() => void> = [];

  sleep(): Promise<void> {
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  get pending(): number {
    return this.waiting.length;
  }

  /** Release up to n pending sleeps (in order). */
  release(n = 1): void {
    for (let i = 0; i < n && this.waiting.length > 0; i += 1) this.waiting.shift()?.();
  }
}

/** Real-time scheduler whose speed can change while tasks run (prototype control). */
export function adjustableScheduler(initialSpeed = 1): Scheduler & { speed: number; setSpeed(s: number): void } {
  const s = {
    speed: initialSpeed,
    setSpeed(next: number) {
      s.speed = next;
    },
    sleep(ms: number) {
      return new Promise<void>((resolve) => setTimeout(resolve, ms / s.speed));
    },
  };
  return s;
}
