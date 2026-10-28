import type { ActionsOptions, Scheduler } from './actions-types.js';

/** The numbers used when an option is left out. */
export const DEFAULTS = {
  minIntervalMs: 3000,
  maxPerMinute: 10,
  confirmTimeoutMs: 10_000,
  unconfirmedCooldownMs: 30_000,
  confirmGraceMs: 1000,
} as const;

export function assertActionId(kind: 'ball' | 'item' | 'pokémon', id: number): void {
  if (!Number.isInteger(id) || id < 0) throw new RangeError(`the ${kind} id must be a non-negative integer, got ${String(id)}`);
}

export function assertBuyArguments(kind: 'ball' | 'item', id: number, quantity: number): void {
  assertActionId(kind, id);
  const max = 9999; // the game's own client never asks for more
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > max)
    throw new RangeError(`the quantity must be an integer from 1 to ${max}, got ${String(quantity)}`);
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function resolveChecks(checks: ActionsOptions['checks']): { notForSale: boolean; gold: boolean; sellable: boolean } {
  if (checks === undefined || checks === true) return { notForSale: true, gold: true, sellable: true };
  if (checks === false) return { notForSale: false, gold: false, sellable: false };
  return { notForSale: checks.notForSale ?? true, gold: checks.gold ?? true, sellable: checks.sellable ?? true };
}

/** A bad number would silently turn a protection off (`x < NaN` is always false): refuse it. */
export function validateOptions(options: ActionsOptions): void {
  const numbers: Array<[string, number | undefined]> = [
    ['maxGoldPerHour', options.maxGoldPerHour],
    ['confirmTimeoutMs', options.confirmTimeoutMs],
    ['confirmGraceMs', options.confirmGraceMs],
    ['unconfirmedCooldownMs', options.unconfirmedCooldownMs],
    ['rateLimit.minIntervalMs', options.rateLimit ? options.rateLimit.minIntervalMs : undefined],
    ['rateLimit.maxPerMinute', options.rateLimit ? options.rateLimit.maxPerMinute : undefined],
  ];
  for (const [name, value] of numbers) {
    if (value !== undefined && !(Number.isFinite(value) && value >= 0))
      throw new RangeError(`${name} must be a finite number of at least 0, got ${String(value)}`);
  }
}
