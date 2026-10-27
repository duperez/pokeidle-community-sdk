import assert from 'node:assert/strict';
import test from 'node:test';
import { tick, setup, setupSell, SELL } from './helpers/actions-setup.js';
import { welcome } from './helpers/fixtures.js';
import { Ball, Item } from '../src/index.js';

test('no confirmation: the result is "unconfirmed" (not failed), and the next purchase waits so it is not paid twice', async () => {
  const { actions, scheduler, transport } = setup({ rateLimit: false });
  const pending = actions.buyBall(Ball.UltraBall, 10);
  scheduler.advance(10_000);
  const result = await pending;
  assert.equal(result.status, 'unconfirmed');
  const again = await actions.buyBall(Ball.UltraBall, 10);
  assert.equal(again.status, 'rate-limited');
  if (again.status === 'rate-limited') assert.deepEqual([again.reason, again.retryInMs], ['unconfirmed-cooldown', 30_000]);
  assert.equal(transport.sent.length, 1);
  scheduler.advance(30_000);
  const later = actions.buyBall(Ball.UltraBall, 10);
  assert.equal(transport.sent.length, 2);
  scheduler.advance(10_000);
  await later;
});

test('rate limit: a minimum interval and a per-minute maximum, both configurable', async () => {
  const { actions, scheduler, feed, transport } = setup();
  const first = actions.buyBall(Ball.PokeBall, 1);
  feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Poke Ball', qtd: 1 }] });
  assert.equal((await first).status, 'confirmed');
  const tooSoon = await actions.buyBall(Ball.PokeBall, 1);
  assert.equal(tooSoon.status, 'rate-limited');
  if (tooSoon.status === 'rate-limited') assert.deepEqual([tooSoon.reason, tooSoon.retryInMs], ['interval', 3000]);
  scheduler.advance(3000);
  const second = actions.buyBall(Ball.PokeBall, 1);
  feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Poke Ball', qtd: 1 }] });
  assert.equal((await second).status, 'confirmed');
  assert.equal(transport.sent.length, 2);

  const strict = setup({ rateLimit: { minIntervalMs: 0, maxPerMinute: 2 } });
  for (let i = 0; i < 2; i++) {
    const p = strict.actions.buyBall(Ball.PokeBall, 1);
    strict.feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Poke Ball', qtd: 1 }] });
    await p;
  }
  const blocked = await strict.actions.buyBall(Ball.PokeBall, 1);
  assert.equal(blocked.status === 'rate-limited' && blocked.reason, 'per-minute');
  strict.scheduler.advance(60_000);
  const free = strict.actions.buyBall(Ball.PokeBall, 1);
  strict.scheduler.advance(10_000);
  assert.equal((await free).status, 'unconfirmed'); // allowed again after a minute
});

test('the rate limit can be turned off', async () => {
  const { actions, feed, transport } = setup({ rateLimit: false });
  for (let i = 0; i < 15; i++) {
    const p = actions.buyBall(Ball.PokeBall, 1);
    feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Poke Ball', qtd: 1 }] });
    assert.equal((await p).status, 'confirmed');
  }
  assert.equal(transport.sent.length, 15);
});

test('spending cap per hour', async () => {
  const { actions, feed, scheduler, transport } = setup({ rateLimit: false, maxGoldPerHour: 2000 });
  const first = actions.buyBall(Ball.UltraBall, 10); // 1 300
  feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 10, gasto: 1300 }] });
  await first;
  assert.equal(actions.spentLastHour, 1300);
  const over = await actions.buyBall(Ball.UltraBall, 10); // 2 600 > 2 000
  assert.equal(over.status, 'spend-cap');
  if (over.status === 'spend-cap') assert.deepEqual([over.spentLastHour, over.cap], [1300, 2000]);
  assert.equal(transport.sent.length, 1);
  scheduler.advance(3_600_001);
  assert.equal(actions.spentLastHour, 0);
  const again = actions.buyBall(Ball.UltraBall, 10);
  feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 10 }] });
  assert.equal((await again).status, 'confirmed');
});

test('only one purchase is in flight at a time', async () => {
  const { actions, feed, transport } = setup({ rateLimit: false });
  const first = actions.buyBall(Ball.PokeBall, 1);
  assert.deepEqual(await actions.buyBall(Ball.PokeBall, 1), { status: 'busy' });
  assert.equal(transport.sent.length, 1);
  feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Poke Ball', qtd: 1 }] });
  await first;
  await tick();
  const next = actions.buyBall(Ball.PokeBall, 1);
  assert.equal(transport.sent.length, 2);
  feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Poke Ball', qtd: 1 }] });
  await next;
});

test('after an error the next purchase also waits: the error may have been about something else and the order may have gone through', async () => {
  const { actions, feed, scheduler, transport } = setup({ rateLimit: false });
  const first = actions.buyBall(Ball.UltraBall, 10);
  feed({ t: 'erro', chave: 'unrelated' });
  assert.equal((await first).status, 'rejected');
  const retry = await actions.buyBall(Ball.UltraBall, 10);
  assert.equal(retry.status === 'rate-limited' && retry.reason, 'unconfirmed-cooldown');
  assert.equal(transport.sent.length, 1);
  scheduler.advance(30_000);
  const later = actions.buyBall(Ball.UltraBall, 10);
  assert.equal(transport.sent.length, 2);
  scheduler.advance(10_000);
  await later;
});

test('a dry run uses no budget, and predicts what the real call would meet', async () => {
  const { actions, transport, scheduler, feed } = setup({ maxGoldPerHour: 1500 });
  for (let i = 0; i < 20; i++) assert.equal((await actions.buyBall(Ball.UltraBall, 10, { dryRun: true })).status, 'dry-run'); // no rate limit consumed
  assert.deepEqual(transport.sent, []);
  assert.equal(actions.spentLastHour, 0);
  const real = actions.buyBall(Ball.UltraBall, 10); // 1 300 of 1 500
  feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 10 }] });
  await real;
  assert.equal((await actions.buyBall(Ball.UltraBall, 1, { dryRun: true })).status, 'rate-limited'); // it would be rate limited
  scheduler.advance(3000);
  assert.equal((await actions.buyBall(Ball.UltraBall, 10, { dryRun: true })).status, 'spend-cap'); // 2 600 > 1 500
  assert.equal((await actions.buyBall(Ball.UltraBall, 1, { dryRun: true })).status, 'dry-run'); // 1 430 fits
});

test('with a spending cap, an order whose price is unknown is refused instead of slipping past the cap', async () => {
  const { actions, transport } = setup({ maxGoldPerHour: 1000, checks: false });
  const result = await actions.buyItem(Item.BronzeBossToken, 1); // no known price
  assert.equal(result.status, 'spend-cap');
  assert.deepEqual(transport.sent, []);
});

test('buying and selling share the same limits and the same single order in flight', async () => {
  const { actions, feed, scheduler, transport } = setupSell();
  const buy = actions.buyBall(Ball.UltraBall, 1);
  assert.deepEqual(await actions.sellPokemon(5, SELL), { status: 'busy' });
  feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 1 }] });
  await buy;
  const tooSoon = await actions.sellPokemon(5, SELL);
  assert.equal(tooSoon.status === 'rate-limited' && tooSoon.reason, 'interval'); // the buy used the budget
  scheduler.advance(3000);
  const sale = actions.sellPokemon(5, SELL);
  assert.equal(transport.sent.length, 2);
  feed({ t: 'estado', estado: { pkFora: [5] } });
  await sale;
});

test('after an unconfirmed or rejected sale the next order waits, so nothing is sold or bought twice', async () => {
  const { actions, feed, scheduler, transport } = setupSell({ rateLimit: false });
  const first = actions.sellPokemon(5, SELL);
  feed({ t: 'erro', chave: 'x' });
  assert.equal((await first).status, 'rejected');
  const retry = await actions.sellPokemon(6, SELL);
  assert.equal(retry.status === 'rate-limited' && retry.reason, 'unconfirmed-cooldown');
  const buyToo = await actions.buyBall(Ball.UltraBall, 1);
  assert.equal(buyToo.status === 'rate-limited' && buyToo.reason, 'unconfirmed-cooldown');
  assert.equal(transport.sent.length, 1);
  scheduler.advance(30_000);
  const later = actions.sellPokemon(6, SELL);
  assert.equal(transport.sent.length, 2);
  scheduler.advance(10_000);
  assert.equal((await later).status, 'unconfirmed');
});

test('limits are inclusive at the boundary: spending exactly the cap or exactly your gold is allowed, one more is not', async () => {
  const capped = setup({ maxGoldPerHour: 1300 });
  assert.equal((await capped.actions.buyBall(Ball.UltraBall, 10, { dryRun: true })).status, 'dry-run'); // 1 300 of 1 300
  assert.equal((await capped.actions.buyBall(Ball.UltraBall, 11, { dryRun: true })).status, 'spend-cap'); // 1 430

  const poor = setup({}, false);
  poor.feed(welcome({ gold: 1300 }));
  assert.equal((await poor.actions.buyBall(Ball.UltraBall, 10, { dryRun: true })).status, 'dry-run'); // 1 300 with 1 300
  assert.equal((await poor.actions.buyBall(Ball.UltraBall, 11, { dryRun: true })).status, 'insufficient-gold');
});
