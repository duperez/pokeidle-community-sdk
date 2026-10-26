import assert from 'node:assert/strict';
import test from 'node:test';
import { RateLimiter } from '../src/rate-limiter.js';
import { SpendLedger } from '../src/spend-ledger.js';

test('rate limiter: defaults allow the first send, then hold 3 s apart', () => {
  const limiter = new RateLimiter();
  assert.equal(limiter.check(1000), null);
  limiter.recordSend(1000);
  assert.deepEqual(limiter.check(2000), { status: 'rate-limited', reason: 'interval', retryInMs: 2000 });
  assert.equal(limiter.check(4000), null);
});

test('rate limiter: at most N per minute, and the retry time points at the oldest send', () => {
  const limiter = new RateLimiter({ rateLimit: { minIntervalMs: 0, maxPerMinute: 3 } });
  for (const t of [0, 10_000, 20_000]) limiter.recordSend(t);
  assert.deepEqual(limiter.check(30_000), { status: 'rate-limited', reason: 'per-minute', retryInMs: 30_000 });
  assert.equal(limiter.check(60_000), null); // the first send is a minute old
});

test('rate limiter: rateLimit false turns the limits off but not the cooldown', () => {
  const limiter = new RateLimiter({ rateLimit: false, unconfirmedCooldownMs: 5000 });
  limiter.recordSend(0);
  assert.equal(limiter.check(1), null);
  limiter.startCooldown(100);
  assert.deepEqual(limiter.check(200), { status: 'rate-limited', reason: 'unconfirmed-cooldown', retryInMs: 4900 });
  assert.equal(limiter.check(5100), null);
});

test('rate limiter: the cooldown defaults to 30 s', () => {
  const limiter = new RateLimiter({ rateLimit: false });
  limiter.startCooldown(0);
  assert.equal(limiter.check(1)?.retryInMs, 29_999);
});

test('rate limiter: forgets sends older than a minute', () => {
  const limiter = new RateLimiter({ rateLimit: { minIntervalMs: 0, maxPerMinute: 1 } });
  limiter.recordSend(0);
  limiter.recordSend(70_000); // prunes the first
  assert.equal(limiter.check(70_001)?.reason, 'per-minute');
  assert.equal(limiter.check(130_001), null);
});

test('spend ledger: sums the last hour only', () => {
  const ledger = new SpendLedger();
  ledger.record(0, 100);
  ledger.record(1_000_000, 50);
  assert.equal(ledger.spentLastHour(1_000_000), 150);
  assert.equal(ledger.spentLastHour(3_600_000), 50); // the first is exactly an hour old: out
  assert.equal(ledger.spentLastHour(5_000_000), 0);
});
