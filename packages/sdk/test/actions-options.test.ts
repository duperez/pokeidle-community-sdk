import * as sdk from '../src/index.js';

import assert from 'node:assert/strict';
import test from 'node:test';
import { PokeIdleClient } from '../src/client-core.js';
import { FakeTransport, setup } from './helpers/actions-setup.js';
import { Ball, Item } from '../src/index.js';

test('checks can be turned off one by one', async () => {
  const noGold = setup({ checks: { gold: false } });
  const pending = noGold.actions.buyBall(Ball.UltraBall, 1000); // 130 000 > 100 000 gold, sent anyway
  assert.equal(noGold.transport.sent.length, 1);
  noGold.scheduler.advance(10_000);
  await pending;
  const noCatalog = setup({ checks: { notForSale: false } });
  assert.equal((await noCatalog.actions.buyBall(Ball.UltraBall, 1000)).status, 'insufficient-gold'); // the gold check stays on
});

test('a price of zero is not a price', async () => {
  const { actions } = setup();
  assert.equal((await actions.buyItem(Item.Medicine, 1)).status, 'not-for-sale');
});

test('options that would silently disable a protection are refused', () => {
  const transport = new FakeTransport();
  for (const bad of [
    { maxGoldPerHour: Number.NaN },
    { maxGoldPerHour: -1 },
    { confirmTimeoutMs: Number.POSITIVE_INFINITY },
    { rateLimit: { minIntervalMs: Number.NaN } },
    { rateLimit: { maxPerMinute: -5 } },
    { unconfirmedCooldownMs: -1 },
  ]) {
    assert.throws(() => new PokeIdleClient({ transport, actions: bad }), RangeError, JSON.stringify(bad));
  }
});

test('the Actions class is not exported: the limits belong to client.actions', () => {
  assert.equal('Actions' in sdk, false);
  const { client } = setup();
  assert.equal(typeof client.actions.buyBall, 'function');
});
