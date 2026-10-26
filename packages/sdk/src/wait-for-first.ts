import type { Scheduler } from './actions-types.js';

/** A pending answer that can be given up on without leaving listeners or timers behind. */
export interface Waiter<R> {
  result: Promise<R>;
  cancel: () => void;
}

/**
 * The scaffolding every confirmation shares: resolve with the FIRST of several things that can happen (a game event, a
 * state change, an error packet) or with `onTimeout()`, and clean up all of it either way.
 *
 * `setup` subscribes to what it needs; every unsubscribe function it passes to `onCleanup` runs exactly once, when the
 * waiter finishes or is cancelled. `finish` after the first call does nothing.
 */
export function waitForFirst<R>(
  scheduler: Scheduler,
  timeoutMs: number,
  setup: (finish: (result: R) => void, onCleanup: (cleanup: () => void) => void) => void,
  onTimeout: () => R,
): Waiter<R> {
  const cleanups: Array<() => void> = [];
  let done = false;
  let timer: unknown;
  const cleanup = (): void => {
    if (done) return;
    done = true;
    for (const fn of cleanups) fn();
    if (timer !== undefined) scheduler.clearTimeout(timer);
  };
  let settle: (result: R) => void = () => {};
  const result = new Promise<R>((resolve) => {
    settle = resolve;
  });
  const finish = (value: R): void => {
    cleanup(); // idempotent; settling an already settled promise is a no-op, so a late `finish` changes nothing
    settle(value);
  };
  setup(finish, (fn) => cleanups.push(fn));
  timer = scheduler.setTimeout(() => finish(onTimeout()), timeoutMs);
  return { result, cancel: cleanup };
}
