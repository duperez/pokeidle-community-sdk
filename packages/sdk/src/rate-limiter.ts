import { DEFAULTS } from './actions-options.js';
import type { ActionsOptions, RateLimited } from './actions-types.js';

const MINUTE_MS = 60_000;

/**
 * Decides whether an action may be sent now: a minimum interval, a most-per-minute, and a pause after an action that
 * was not confirmed. It only remembers; the caller says when something was actually sent.
 */
export class RateLimiter {
  #blockedUntil = 0;
  #lastSentAt = -Infinity;
  #sends: number[] = [];

  constructor(private readonly options: Pick<ActionsOptions, 'rateLimit' | 'unconfirmedCooldownMs'> = {}) {}

  /** `null` when `now` is fine; otherwise why not and for how long. The cooldown applies even with the rate limit off. */
  check(now: number): RateLimited | null {
    if (now < this.#blockedUntil) return { status: 'rate-limited', reason: 'unconfirmed-cooldown', retryInMs: this.#blockedUntil - now };
    const limit = this.options.rateLimit;
    if (limit === false) return null;
    const minInterval = limit?.minIntervalMs ?? DEFAULTS.minIntervalMs;
    const perMinute = limit?.maxPerMinute ?? DEFAULTS.maxPerMinute;
    if (now - this.#lastSentAt < minInterval)
      return { status: 'rate-limited', reason: 'interval', retryInMs: minInterval - (now - this.#lastSentAt) };
    const recent = this.#sends.filter((t) => now - t < MINUTE_MS);
    if (recent.length >= perMinute)
      return { status: 'rate-limited', reason: 'per-minute', retryInMs: MINUTE_MS - (now - (recent[0] ?? now)) };
    return null;
  }

  /** Something was sent at `now`. */
  recordSend(now: number): void {
    this.#lastSentAt = now;
    this.#sends = [...this.#sends.filter((t) => now - t < MINUTE_MS), now];
  }

  /** Hold everything back for the unconfirmed-cooldown starting at `now`. */
  startCooldown(now: number): void {
    this.#blockedUntil = now + (this.options.unconfirmedCooldownMs ?? DEFAULTS.unconfirmedCooldownMs);
  }
}
