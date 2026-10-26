import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULTS, resolveChecks, validateOptions } from '../src/actions-options.js';
import { errorOf } from '../src/confirmations.js';
import { normalizeName, parseSaleName, whyNotSellable } from '../src/sale-rules.js';
import type { ActionsState } from '../src/actions-host.js';

test('resolveChecks: true/undefined all on, false all off, object per key (missing keys stay on)', () => {
  const on = { notForSale: true, gold: true, sellable: true };
  assert.deepEqual(resolveChecks(undefined), on);
  assert.deepEqual(resolveChecks(true), on);
  assert.deepEqual(resolveChecks(false), { notForSale: false, gold: false, sellable: false });
  assert.deepEqual(resolveChecks({ gold: false }), { notForSale: true, gold: false, sellable: true });
});

test('validateOptions refuses NaN, Infinity and negatives, accepts 0 and absent', () => {
  validateOptions({});
  validateOptions({ confirmGraceMs: 0, rateLimit: { minIntervalMs: 0 } });
  for (const bad of [NaN, Infinity, -1]) {
    assert.throws(() => validateOptions({ maxGoldPerHour: bad }), /maxGoldPerHour/);
    assert.throws(() => validateOptions({ rateLimit: { maxPerMinute: bad } }), /rateLimit\.maxPerMinute/);
  }
  assert.equal(DEFAULTS.minIntervalMs, 3000);
});

test('normalizeName / parseSaleName', () => {
  assert.equal(normalizeName('✨ Charmander'), 'charmander');
  assert.equal(normalizeName('Shiny Charmander'), 'charmander');
  assert.deepEqual(parseSaleName('Charmander Nv 20'), { name: 'charmander', level: 20 });
  assert.deepEqual(parseSaleName('✨ Charmander Nv.7'), { name: 'charmander', level: 7 });
  assert.deepEqual(parseSaleName('Charmander'), { name: 'charmander', level: null });
});

test('errorOf keeps only well-typed fields', () => {
  assert.deepEqual(errorOf({ chave: 'k', msg: 'm', params: { a: 1 } }), { chave: 'k', msg: 'm', params: { a: 1 } });
  assert.deepEqual(errorOf({ chave: 1, msg: null, params: [1] }), {});
});

const stateOf = (over: Partial<Record<keyof ActionsState, unknown>>): ActionsState =>
  ({
    activePokemonId: 1,
    collectionKnown: true,
    isInCollection: () => false,
    xpShareItemId: 99,
    ...over,
  }) as unknown as ActionsState;

test('whyNotSellable: sellable, and each protection (fail closed on unknowns)', () => {
  const p = { id: 5 };
  assert.equal(whyNotSellable(stateOf({}), p), null);
  assert.match(whyNotSellable(stateOf({}), {}) ?? '', /no id/);
  assert.match(whyNotSellable(stateOf({ activePokemonId: null }), p) ?? '', /active pokémon is not known/);
  assert.match(whyNotSellable(stateOf({}), { id: 1 }) ?? '', /active pokémon/);
  assert.match(whyNotSellable(stateOf({}), { id: 5, slot: 0 }) ?? '', /team/);
  assert.equal(whyNotSellable(stateOf({}), { id: 5, slot: null }), null);
  assert.match(whyNotSellable(stateOf({ collectionKnown: false }), p) ?? '', /Collection is not known/);
  assert.match(whyNotSellable(stateOf({ isInCollection: () => true }), p) ?? '', /Collection \(locked\)/);
  assert.match(whyNotSellable(stateOf({ xpShareItemId: null }), p) ?? '', /Exp\. Share item is not known/);
  assert.match(whyNotSellable(stateOf({}), { id: 5, heldItemId: 99 }) ?? '', /holds the Exp\. Share/);
});
