import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForFirst } from '../src/wait-for-first.js';
import { FakeScheduler } from './helpers/fake-scheduler.js';

test('resolves with the first finish and ignores the rest', async () => {
  const scheduler = new FakeScheduler();
  let finish!: (v: string) => void;
  const waiter = waitForFirst<string>(
    scheduler,
    1000,
    (f) => {
      finish = f;
    },
    () => 'timeout',
  );
  finish('a');
  finish('b');
  assert.equal(await waiter.result, 'a');
  assert.equal(scheduler.pending, 0);
});

test('times out with onTimeout()', async () => {
  const scheduler = new FakeScheduler();
  const waiter = waitForFirst<string>(
    scheduler,
    1000,
    () => {},
    () => 'timeout',
  );
  scheduler.advance(1000);
  assert.equal(await waiter.result, 'timeout');
});

test('every registered cleanup runs exactly once, on finish or on cancel', () => {
  for (const how of ['finish', 'cancel'] as const) {
    const scheduler = new FakeScheduler();
    let cleaned = 0;
    let finish!: (v: string) => void;
    const waiter = waitForFirst<string>(
      scheduler,
      1000,
      (f, onCleanup) => {
        finish = f;
        onCleanup(() => (cleaned += 1));
        onCleanup(() => (cleaned += 1));
      },
      () => 'timeout',
    );
    if (how === 'finish') finish('x');
    else waiter.cancel();
    finish('late');
    waiter.cancel();
    assert.equal(cleaned, 2, how);
    assert.equal(scheduler.pending, 0, how);
  }
});

test('a cancelled waiter never times out', () => {
  const scheduler = new FakeScheduler();
  let timedOut = false;
  const waiter = waitForFirst<string>(
    scheduler,
    1000,
    () => {},
    () => {
      timedOut = true;
      return 'x';
    },
  );
  waiter.cancel();
  scheduler.advance(5000);
  assert.equal(timedOut, false);
});

test('finish during setup: later registrations are cleaned at once and no timer is left', async () => {
  const scheduler = new FakeScheduler();
  let cleaned = 0;
  const waiter = waitForFirst<string>(
    scheduler,
    1000,
    (finish, onCleanup) => {
      onCleanup(() => (cleaned += 1));
      finish('now');
      onCleanup(() => (cleaned += 1));
    },
    () => 'timeout',
  );
  assert.equal(await waiter.result, 'now');
  assert.equal(cleaned, 2);
  assert.equal(scheduler.pending, 0);
});

test('a throwing cleanup does not stop the others or leak the timer', () => {
  const scheduler = new FakeScheduler();
  let ran = false;
  const waiter = waitForFirst<string>(
    scheduler,
    1000,
    (_finish, onCleanup) => {
      onCleanup(() => {
        throw new Error('off failed');
      });
      onCleanup(() => (ran = true));
    },
    () => 'timeout',
  );
  assert.throws(() => waiter.cancel(), /off failed/);
  assert.equal(ran, true);
  assert.equal(scheduler.pending, 0);
});
