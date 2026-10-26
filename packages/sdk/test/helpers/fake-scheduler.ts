import type { Scheduler } from '../../src/index.js';

/** A clock the test moves by hand. `pending` counts the timers still waiting: a leaked timer shows up as a number. */
export class FakeScheduler implements Scheduler {
  time = 1_000_000;
  private timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private next = 1;

  now(): number {
    return this.time;
  }

  get pending(): number {
    return this.timers.length;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.timers.push({ at: this.time + ms, fn, id });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }

  advance(ms: number): void {
    this.time += ms;
    for (const timer of this.timers.filter((t) => t.at <= this.time)) {
      this.timers = this.timers.filter((t) => t !== timer);
      timer.fn();
    }
  }
}
