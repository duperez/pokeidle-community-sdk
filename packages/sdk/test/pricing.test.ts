import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActionsState } from '../src/actions-host.js';
import { Ball, Item } from '../src/index.js';
import { priceOf } from '../src/pricing.js';

const state = (over: Record<string, unknown> = {}): ActionsState =>
  ({ ballCatalog: [], shopItems: [], ...over }) as unknown as ActionsState;

test('ball prices come from the server catalog; missing or unbuyable balls say why', () => {
  const s = state({
    ballCatalog: [
      { id: Ball.PokeBall, name: 'Poke Ball', buyable: true, priceGold: 200 },
      { id: 9, name: 'Nope Ball', buyable: false, priceGold: 100 },
      { id: 8, name: 'Free Ball', buyable: true, priceGold: 0 },
    ],
  });
  assert.deepEqual(priceOf(s, 'ball', Ball.PokeBall), { unit: 200 });
  assert.match(priceOf(s, 'ball', 9).reason ?? '', /not sold/);
  assert.match(priceOf(s, 'ball', 8).reason ?? '', /not sold/);
  assert.match(priceOf(s, 'ball', 77).reason ?? '', /no ball 77/);
});

test('items: the shop offer wins; an offer with no price is refused', () => {
  assert.deepEqual(priceOf(state({ shopItems: [{ itemId: 5, name: 'X', price: 30 }] }), 'item', 5), { unit: 30 });
  assert.match(priceOf(state({ shopItems: [{ itemId: 5, name: 'X', price: null }] }), 'item', 5).reason ?? '', /no price/);
});

test('items: a shop offer priced 0 or negative is refused, not treated as free', () => {
  for (const price of [0, -5]) {
    const result = priceOf(state({ shopItems: [{ itemId: 5, name: 'X', price }] }), 'item', 5);
    assert.equal(result.unit, null);
    assert.match(result.reason ?? '', /no price/);
  }
});

test('items: potions fall back to the catalog NPC price; unknown items say so', () => {
  const potion = priceOf(state(), 'item', Item.SmallPotion);
  assert.ok(potion.unit !== null && potion.unit > 0, JSON.stringify(potion));
  assert.match(priceOf(state(), 'item', 999_999_999).reason ?? '', /not an item the NPC shop is known to sell/);
});
