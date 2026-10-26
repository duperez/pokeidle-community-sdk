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
    isActive: () => false,
    isInTeam: () => false,
    isInCollection: () => false,
    holdsExpShare: () => false,
    ...over,
  }) as unknown as ActionsState;

test('whyNotSellable: sellable, and each protection', () => {
  assert.equal(whyNotSellable(stateOf({}), 5), null);
  assert.match(whyNotSellable(stateOf({ isActive: () => true }), 5) ?? '', /active pokémon/);
  assert.match(whyNotSellable(stateOf({ isInTeam: () => true }), 5) ?? '', /team/);
  assert.match(whyNotSellable(stateOf({ isInCollection: () => true }), 5) ?? '', /Collection \(locked\)/);
  assert.match(whyNotSellable(stateOf({ holdsExpShare: () => true }), 5) ?? '', /holds the Exp\. Share/);
});

test('whyNotSellable fails closed: every unknown refuses, and says what is missing', () => {
  const unknown = () => null;
  assert.match(whyNotSellable(stateOf({ isActive: unknown }), 5) ?? '', /active pokémon is not known/);
  assert.match(whyNotSellable(stateOf({ isInTeam: unknown }), 5) ?? '', /not in your list/);
  assert.match(whyNotSellable(stateOf({ isInCollection: unknown }), 5) ?? '', /Collection is not known/);
  assert.match(whyNotSellable(stateOf({ holdsExpShare: unknown }), 5) ?? '', /Exp\. Share item is not known/);
});
