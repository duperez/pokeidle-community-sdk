import type { Scheduler } from './actions-types.js';

/** A pending answer that can be given up on without leaving listeners or timers behind. */
export interface Waiter<R> {
  result: Promise<R>;
  cancel: () => void;
  snapshot: () => R;
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
  let settled: { value: R } | undefined;
  // Every cleanup runs even if an earlier one throws; the first error is rethrown afterwards.
  const runAll = (fns: Array<() => void>): void => {
    let failure: { error: unknown } | null = null;
    for (const fn of fns) {
      try {
        fn();
      } catch (error) {
        failure ??= { error };
      }
    }
    if (failure) throw failure.error;
  };
  const cleanup = (): void => {
    if (done) return;
    done = true;
    runAll([...cleanups, () => timer !== undefined && scheduler.clearTimeout(timer)].map((fn) => () => void fn()));
  };
  let settle: (result: R) => void = () => {};
  const result = new Promise<R>((resolve) => {
    settle = resolve;
  });
  const finish = (value: R): void => {
    if (done) return;
    settled = { value };
    cleanup(); // idempotent; settling an already settled promise is a no-op, so a late `finish` changes nothing
    settle(value);
  };
  setup(finish, (fn) => {
    if (done)
      fn(); // `finish` already ran inside `setup`: whatever registers afterwards is cleaned up at once
    else cleanups.push(fn);
  });
  if (!done) timer = scheduler.setTimeout(() => finish(onTimeout()), timeoutMs);
  return { result, cancel: cleanup, snapshot: () => (settled ? settled.value : onTimeout()) };
}
