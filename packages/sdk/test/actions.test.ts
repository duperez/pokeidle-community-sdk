import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/index.js';
import { FakeScheduler } from './helpers/fake-scheduler.js';
import { pokemon, sellWelcome, welcome } from './helpers/fixtures.js';
import { Ball, Item, PokeIdleClient, type ActionsOptions, type Transport, type TransportHandlers } from '../src/index.js';

class FakeTransport implements Transport {
  handlers: TransportHandlers | null = null;
  sent: Array<Record<string, unknown>> = [];
  readyState = 1;
  start(handlers: TransportHandlers): void {
    this.handlers = handlers;
  }
  stop(): void {}
  send(text: string): boolean {
    if (this.readyState !== 1) return false;
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
    return true;
  }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(options: ActionsOptions = {}, withWelcome = true) {
  const transport = new FakeTransport();
  const scheduler = new FakeScheduler();
  const client = new PokeIdleClient({ transport, actions: { confirmGraceMs: 0, ...options, scheduler } }); // no grace window unless a test asks for one
  client.start();
  const feed = (...packets: object[]) => packets.forEach((p) => transport.handlers?.onMessage(JSON.stringify(p)));
  if (withWelcome) feed(welcome());
  return { transport, scheduler, client, feed, actions: client.actions };
}

test('dry run says what it would send and sends nothing', async () => {
  const { transport, actions } = setup();
  const result = await actions.buyBall(Ball.UltraBall, 10, { dryRun: true });
  assert.deepEqual(result, {
    status: 'dry-run',
    request: { kind: 'ball', id: 4, quantity: 10, unitPrice: 130, totalPrice: 1300 },
    command: { t: 'shop.buy', kind: 'ball', id: 4, qty: 10 },
  });
  assert.deepEqual(transport.sent, []);
  const everything = setup({ dryRun: true });
  assert.equal((await everything.actions.buyItem(Item.SmallPotion, 5)).status, 'dry-run'); // the option on the client
  assert.deepEqual(everything.transport.sent, []);
});

test("a purchase is sent and confirmed by the game's own `compra` event", async () => {
  const { transport, actions, feed } = setup();
  const pending = actions.buyBall(Ball.UltraBall, 10);
  assert.deepEqual(transport.sent, [{ t: 'shop.buy', kind: 'ball', id: 4, qty: 10 }]);
  feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 10, gasto: 1300 }] });
  const result = await pending;
  assert.equal(result.status, 'confirmed');
  if (result.status === 'confirmed') assert.deepEqual([result.confirmedBy, result.before, result.spent], ['event', 72, 1300]);
});

test('a purchase is also confirmed when the inventory grows, whichever signal comes first', async () => {
  const { actions, feed } = setup();
  const pending = actions.buyBall(Ball.UltraBall, 10);
  feed({ t: 'estado', estado: { balls: { '1': 100, '4': 82, '5': 0 } } });
  const result = await pending;
  assert.equal(result.status, 'confirmed');
  if (result.status === 'confirmed')
    assert.deepEqual([result.confirmedBy, result.before, result.after, result.spent], ['inventory', 72, 82, 1300]);
});

test('a `compra` event for another quantity or another item does not confirm', async () => {
  const { actions, feed, scheduler } = setup();
  const pending = actions.buyBall(Ball.UltraBall, 10);
  feed({
    t: 'batalha',
    ev: [
      { k: 'compra', nome: 'Ultra Ball', qtd: 3 },
      { k: 'compra', nome: 'Revive', qtd: 10 },
    ],
  });
  scheduler.advance(10_000);
  assert.equal((await pending).status, 'unconfirmed');
});

test('an error from the game while waiting rejects the purchase', async () => {
  const { actions, feed } = setup();
  const pending = actions.buyItem(Item.SmallPotion, 5);
  feed({ t: 'erro', chave: 'erro.semOuro', msg: 'no gold', params: { falta: 5 } });
  const result = await pending;
  assert.equal(result.status, 'rejected');
  if (result.status === 'rejected') assert.deepEqual(result.error, { chave: 'erro.semOuro', msg: 'no gold', params: { falta: 5 } });
});

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

test('without a connection or before the welcome packet nothing is sent', async () => {
  const offline = setup();
  offline.transport.readyState = 3;
  assert.deepEqual(await offline.actions.buyBall(Ball.UltraBall, 1), { status: 'not-connected' });
  const early = setup({}, false);
  assert.deepEqual(await early.actions.buyBall(Ball.UltraBall, 1), { status: 'no-state' });
  assert.deepEqual([...offline.transport.sent, ...early.transport.sent], []);
});

test('what the shop does not sell is refused before sending', async () => {
  const { actions, transport } = setup();
  const beast = await actions.buyBall(Ball.BeastBall, 1);
  assert.equal(beast.status, 'not-for-sale');
  if (beast.status === 'not-for-sale') assert.match(beast.reason, /not sold in the shop/);
  assert.equal((await actions.buyBall(99, 1)).status, 'not-for-sale'); // a ball the server never listed
  assert.equal((await actions.buyItem(Item.Medicine, 1)).status, 'not-for-sale'); // price 0
  assert.equal((await actions.buyItem(Item.GoldenPotion, 1)).status, 'not-for-sale'); // rare item
  assert.equal((await actions.buyItem(Item.BronzeBossToken, 1)).status, 'not-for-sale');
  assert.deepEqual(transport.sent, []);
});

test('prices: balls come from the server catalog, potions from the item catalog, shop items from the welcome packet', async () => {
  const { actions } = setup();
  const potion = await actions.buyItem(Item.Revive, 3, { dryRun: true });
  assert.equal(potion.status === 'dry-run' && potion.request.unitPrice, 600);
  const egg = await actions.buyItem(70091, 1, { dryRun: true });
  assert.equal(egg.status, 'insufficient-gold'); // 20 000 000 > 100 000
  if (egg.status === 'insufficient-gold') assert.deepEqual([egg.needed, egg.have], [20_000_000, 100_000]);
});

test('not enough gold is refused before sending, and the checks can be turned off', async () => {
  const { actions, transport } = setup();
  assert.equal((await actions.buyBall(Ball.UltraBall, 1000)).status, 'insufficient-gold'); // 130 000 > 100 000
  assert.deepEqual(transport.sent, []);
  const unchecked = setup({ checks: false });
  const pending = unchecked.actions.buyBall(Ball.BeastBall, 1000);
  assert.equal(unchecked.transport.sent.length, 1); // the game decides
  unchecked.scheduler.advance(10_000);
  await pending;
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

test('invalid quantities and ids are programming errors and throw', async () => {
  const { actions, transport } = setup();
  for (const qty of [0, -1, 1.5, 10_000, Number.NaN]) await assert.rejects(actions.buyBall(Ball.PokeBall, qty), RangeError, String(qty));
  await assert.rejects(actions.buyItem(-1, 1), RangeError);
  await assert.rejects(actions.buyItem(1.5, 1), RangeError);
  assert.deepEqual(transport.sent, []);
});

test('an inventory that did not grow (balls used in the hunt) is not a confirmation', async () => {
  const { actions, feed, scheduler } = setup();
  const pending = actions.buyBall(Ball.UltraBall, 10);
  feed({ t: 'estado', estado: { balls: { '1': 100, '4': 72, '5': 0 } } }); // same as before
  feed({ t: 'estado', estado: { balls: { '1': 100, '4': 70, '5': 0 } } }); // used two
  scheduler.advance(10_000);
  assert.equal((await pending).status, 'unconfirmed');
});

test('an answer that arrives while the command is being sent is not missed', async () => {
  const { actions, transport, feed } = setup();
  const original = transport.send.bind(transport);
  transport.send = (text: string) => {
    const ok = original(text);
    feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 10, gasto: 1300 }] }); // instant answer
    return ok;
  };
  const result = await actions.buyBall(Ball.UltraBall, 10);
  assert.equal(result.status, 'confirmed');
});

test('an inventory that grew by less than the quantity is not a confirmation (a drop is not a purchase)', async () => {
  const { actions, feed, scheduler } = setup();
  const pending = actions.buyBall(Ball.UltraBall, 10);
  feed({ t: 'estado', estado: { balls: { '1': 100, '4': 73, '5': 0 } } }); // +1
  scheduler.advance(10_000);
  assert.equal((await pending).status, 'unconfirmed');
});

test('a `compra` event without a name, or with another name, does not confirm', async () => {
  const { actions, feed, scheduler } = setup();
  const pending = actions.buyBall(Ball.UltraBall, 10);
  feed({
    t: 'batalha',
    ev: [
      { k: 'compra', qtd: 10 },
      { k: 'compra', nome: 'Great Ball', qtd: 10 },
    ],
  });
  scheduler.advance(10_000);
  assert.equal((await pending).status, 'unconfirmed');
});

test("confidence: certain for the game's own event, probable for the inventory and for an error", async () => {
  const byEvent = setup();
  let p = byEvent.actions.buyBall(Ball.UltraBall, 10);
  byEvent.feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 10 }] });
  let r = await p;
  assert.equal(r.status === 'confirmed' && r.confidence, 'certain');
  const byInventory = setup();
  p = byInventory.actions.buyBall(Ball.UltraBall, 10);
  byInventory.feed({ t: 'estado', estado: { balls: { '1': 100, '4': 90, '5': 0 } } });
  r = await p;
  assert.equal(r.status === 'confirmed' && r.confidence, 'probable');
  const byError = setup();
  p = byError.actions.buyBall(Ball.UltraBall, 10);
  byError.feed({ t: 'erro', chave: 'x' });
  r = await p;
  assert.equal(r.status === 'rejected' && r.confidence, 'probable');
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

// ---------------------------------------------------------------------------------------------------------------------
// selling pokémon

import { CommandRefusedError } from '../src/index.js';

/** A player with: 1 = active and in the team, 2 = team (slot 1), 3 = in the Collection, 4 = holds the Exp. Share, 5 and 6 = ordinary Depot pokémon. */
function setupSell(options: ActionsOptions = {}) {
  const ctx = setup(options, false);
  ctx.feed(
    sellWelcome([
      pokemon(1, { slot: 0 }),
      pokemon(2, { slot: 1 }),
      pokemon(3),
      pokemon(4, { heldItemId: 70050 }),
      pokemon(5),
      pokemon(6, { shiny: true, level: 77 }),
    ]),
  );
  return ctx;
}
const SELL = { confirmIrreversible: true } as const;

test('selling cannot be done by accident: it needs confirmIrreversible, except in a dry run', async () => {
  const { actions, transport } = setupSell();
  await assert.rejects(actions.sellPokemon(5), CommandRefusedError);
  assert.deepEqual(transport.sent, []);
  const dry = await actions.sellPokemon(5, { dryRun: true });
  assert.deepEqual(dry, {
    status: 'dry-run',
    request: { pokemonId: 5, name: 'Mon5', level: 10, shiny: false },
    command: { t: 'shop.sellPokemon', pokemonId: 5 },
  });
  assert.deepEqual(transport.sent, []);
});

test("a sale is sent and confirmed by the game's `venda` event, with the gold it reports", async () => {
  const { actions, transport, feed } = setupSell();
  const pending = actions.sellPokemon(6, SELL);
  assert.deepEqual(transport.sent, [{ t: 'shop.sellPokemon', pokemonId: 6 }]);
  feed({ t: 'batalha', ev: [{ k: 'venda', nome: 'Mon6', ganho: 4500 }] });
  assert.deepEqual(await pending, {
    status: 'confirmed',
    request: { pokemonId: 6, name: 'Mon6', level: 77, shiny: true },
    confirmedBy: 'event',
    confidence: 'certain',
    gained: 4500,
  });
});

test('a sale is also confirmed when the pokémon leaves the list', async () => {
  const { actions, feed } = setupSell();
  const pending = actions.sellPokemon(5, SELL);
  feed({ t: 'estado', estado: { pkFora: [5] } });
  const result = await pending;
  assert.equal(result.status, 'confirmed');
  if (result.status === 'confirmed') assert.deepEqual([result.confirmedBy, result.confidence, result.gained], ['state', 'probable', null]);
});

test('another pokémon leaving the list, or a sale of another one, does not confirm', async () => {
  const { actions, feed, scheduler } = setupSell();
  const pending = actions.sellPokemon(5, SELL);
  feed({ t: 'estado', estado: { pkFora: [6] } });
  feed({
    t: 'batalha',
    ev: [
      { k: 'venda', nome: 'Mon6', ganho: 1 },
      { k: 'venda', ganho: 1 },
    ],
  });
  scheduler.advance(10_000);
  assert.equal((await pending).status, 'unconfirmed');
});

test("what the game's own client does not sell is refused before sending, with the reason", async () => {
  const { actions, transport } = setupSell();
  const reasons: Record<number, RegExp> = { 1: /active/, 2: /team/, 3: /Collection/, 4: /Exp\. Share/ };
  for (const [id, reason] of Object.entries(reasons)) {
    const result = await actions.sellPokemon(Number(id), SELL);
    assert.equal(result.status, 'not-sellable', id);
    if (result.status === 'not-sellable') assert.match(result.reason, reason);
  }
  assert.deepEqual(await actions.sellPokemon(999, SELL), { status: 'not-found', pokemonId: 999 });
  assert.deepEqual(transport.sent, []);
});

test('the sellable check can be turned off and the game decides', async () => {
  const { actions, transport, scheduler } = setupSell({ checks: { sellable: false } });
  const pending = actions.sellPokemon(3, SELL); // in the Collection
  assert.equal(transport.sent.length, 1);
  scheduler.advance(10_000);
  await pending;
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

test('a pokémon id that is not an integer is a programming error and throws', async () => {
  const { actions, transport } = setupSell();
  for (const id of [-1, 1.5, Number.NaN]) await assert.rejects(actions.sellPokemon(id, SELL), RangeError, String(id));
  assert.deepEqual(transport.sent, []);
});

test('without a connection or before the welcome packet nothing is sold', async () => {
  const offline = setupSell();
  offline.transport.readyState = 3;
  assert.deepEqual(await offline.actions.sellPokemon(5, SELL), { status: 'not-connected' });
  const early = setup({}, false);
  assert.deepEqual(await early.actions.sellPokemon(5, SELL), { status: 'no-state' });
});

test('selling fails CLOSED when a protection cannot be read: an unknown active pokémon, Collection or Exp. Share means "no"', async () => {
  const noActive = setup({}, false);
  noActive.feed({ ...welcome({ automation: { pokemonTravado: [] }, pokemons: [pokemon(5)] }), xpShareHeld: { itemId: 70050 } });
  const r1 = await noActive.actions.sellPokemon(5, SELL);
  assert.equal(r1.status === 'not-sellable' && /active pokémon is not known/.test(r1.reason), true);

  const noCollection = setup({}, false);
  noCollection.feed({
    ...welcome({ activeId: 1, automation: { autoRevive: true }, pokemons: [pokemon(5)] }),
    xpShareHeld: { itemId: 70050 },
  });
  const r2 = await noCollection.actions.sellPokemon(5, SELL);
  assert.equal(r2.status === 'not-sellable' && /Collection is not known/.test(r2.reason), true);

  const noXpShare = setup({}, false);
  noXpShare.feed(welcome({ activeId: 1, automation: { pokemonTravado: [] }, pokemons: [pokemon(5)] })); // no xpShareHeld in the packet
  const r3 = await noXpShare.actions.sellPokemon(5, SELL);
  assert.equal(r3.status === 'not-sellable' && /Exp\. Share item is not known/.test(r3.reason), true);

  assert.deepEqual([...noActive.transport.sent, ...noCollection.transport.sent, ...noXpShare.transport.sent], []);
});

test('a delta that replaces `automation` and loses the Collection list makes selling refuse again, not allow', async () => {
  const { actions, feed, transport } = setupSell();
  feed({ t: 'estado', estado: { automation: { autoRevive: true } } }); // the whole automation object is replaced
  const result = await actions.sellPokemon(3, SELL); // 3 is in the Collection
  assert.equal(result.status, 'not-sellable');
  assert.deepEqual(transport.sent, []);
});

test('ids as numeric text are understood: activeId, the Collection, the Exp. Share item and a text held item', async () => {
  const { actions, transport } = setup({}, false);
  const as = (pokemons: unknown[]) => ({
    ...welcome({ activeId: '1', automation: { pokemonTravado: ['3'] }, pokemons }),
    xpShareHeld: { itemId: '70050' },
  });
  const ctx = { feed: (p: object) => transport.handlers?.onMessage(JSON.stringify(p)) };
  ctx.feed(as([pokemon(1), pokemon(3), pokemon(4, { heldItemId: '70050' }), pokemon(5)]));
  for (const [id, reason] of [
    [1, /active/],
    [3, /Collection/],
    [4, /Exp\. Share/],
  ] as const) {
    const r = await actions.sellPokemon(id, SELL);
    assert.equal(r.status === 'not-sellable' && reason.test(r.reason), true, String(id));
  }
  assert.deepEqual(transport.sent, []);
  const pending = actions.sellPokemon(5, SELL); // the ordinary one is sellable
  assert.equal(transport.sent.length, 1);
  ctx.feed({ t: 'estado', estado: { pkFora: [5] } });
  await pending;
});

test('an explicit `slot: null` is the Depot; any number is the team', async () => {
  const { actions, feed, transport, scheduler } = setupSell({ rateLimit: false });
  feed(sellWelcome([pokemon(1, { slot: 0 }), pokemon(5, { slot: null }), pokemon(6, { slot: 3 })]));
  assert.equal((await actions.sellPokemon(6, SELL)).status, 'not-sellable');
  const pending = actions.sellPokemon(5, SELL);
  assert.equal(transport.sent.length, 1);
  scheduler.advance(10_000);
  await pending;
});

test('two pokémon with the same name: the `venda` event still counts (the game emits it), but only as probable', async () => {
  const { actions, feed } = setupSell();
  feed(sellWelcome([pokemon(1, { slot: 0 }), pokemon(5, { nome: 'Pidgey' }), pokemon(6, { nome: 'Pidgey' })]));
  const pending = actions.sellPokemon(5, SELL);
  feed({ t: 'batalha', ev: [{ k: 'venda', nome: 'Pidgey', ganho: 10 }] }); // could be either one
  const result = await pending;
  assert.deepEqual(
    [
      result.status === 'confirmed' && result.confirmedBy,
      result.status === 'confirmed' && result.confidence,
      result.status === 'confirmed' && result.gained,
    ],
    ['event', 'probable', 10],
  );
});

test('a sale confirmed first by the list waits a moment for the `venda` event, to bring the gold', async () => {
  const { actions, feed, scheduler } = setupSell({ confirmGraceMs: 1000 });
  const pending = actions.sellPokemon(5, SELL);
  feed({ t: 'estado', estado: { pkFora: [5] } }); // the list comes first
  scheduler.advance(300);
  feed({ t: 'batalha', ev: [{ k: 'venda', nome: 'Mon5', ganho: 250 }] }); // then the event, inside the window
  const result = await pending;
  assert.deepEqual(result, {
    status: 'confirmed',
    request: { pokemonId: 5, name: 'Mon5', level: 10, shiny: false },
    confirmedBy: 'event',
    confidence: 'certain',
    gained: 250,
  });
});

test('if the `venda` event never comes, the window ends and the list alone confirms, without the gold', async () => {
  const { actions, feed, scheduler } = setupSell({ confirmGraceMs: 1000 });
  const pending = actions.sellPokemon(5, SELL);
  feed({ t: 'estado', estado: { pkFora: [5] } });
  scheduler.advance(999);
  let done = false;
  void pending.then(() => {
    done = true;
  });
  await tick();
  assert.equal(done, false); // still waiting inside the window
  scheduler.advance(1);
  const result = await pending;
  assert.deepEqual([result.status === 'confirmed' && result.confirmedBy, result.status === 'confirmed' && result.gained], ['state', null]);
  assert.equal(scheduler.pending, 0);
});

test('the grace window is not a way around the timeout, and a bad value is refused', async () => {
  assert.throws(() => new PokeIdleClient({ transport: new FakeTransport(), actions: { confirmGraceMs: Number.NaN } }), RangeError);
  const { actions, scheduler } = setupSell({ confirmGraceMs: 1000 });
  const pending = actions.sellPokemon(5, SELL);
  scheduler.advance(10_000); // nothing arrives at all
  assert.equal((await pending).status, 'unconfirmed');
});

test('`checks: false` turns off the sale protections too, `checks: { sellable: false }` only them', async () => {
  const all = setupSell({ checks: false });
  const pending = all.actions.sellPokemon(1, SELL); // the active pokémon: the game decides
  assert.equal(all.transport.sent.length, 1);
  all.scheduler.advance(10_000);
  await pending;
  const onlyGold = setupSell({ checks: { gold: false, notForSale: false } });
  assert.equal((await onlyGold.actions.sellPokemon(1, SELL)).status, 'not-sellable'); // `sellable` stays on
});

test('no timer is left behind after a sale: not after the event, not after repeated state changes inside the window', async () => {
  const { actions, feed, scheduler } = setupSell({ confirmGraceMs: 1000 });
  let pending = actions.sellPokemon(5, SELL);
  assert.equal(scheduler.pending, 1); // the timeout
  feed({ t: 'estado', estado: { pkFora: [5] } });
  assert.equal(scheduler.pending, 2); // + the grace window
  feed({ t: 'estado', estado: { gold: 5 } }); // an unrelated change inside the window
  feed({ t: 'estado', estado: { gold: 6 } });
  assert.equal(scheduler.pending, 2); // the window was not started again
  feed({ t: 'batalha', ev: [{ k: 'venda', nome: 'Mon5', ganho: 1 }] });
  await pending;
  assert.equal(scheduler.pending, 0);
  feed(sellWelcome([pokemon(1, { slot: 0 }), pokemon(6)]));
  scheduler.advance(3000);
  pending = actions.sellPokemon(6, SELL);
  feed({ t: 'estado', estado: { pkFora: [6] } });
  scheduler.advance(1000);
  await pending;
  assert.equal(scheduler.pending, 0);
});

// The real `venda` event names the pokémon WITH its level: { k: 'venda', nome: 'Charmander Nv 20', ganho: 4573, qtd: 1 }
const charmander = (id: number, level: number, extra: Record<string, unknown> = {}) => pokemon(id, { nome: 'Charmander', level, ...extra });
const saleEvent = (nome: string, ganho = 4573) => ({ t: 'batalha', ev: [{ k: 'venda', nome, ganho, qtd: 1 }] });

test('the real `venda` event ("Charmander Nv 20") confirms the sale and brings the gold', async () => {
  const { actions, feed } = setupSell();
  feed(sellWelcome([pokemon(1, { slot: 0 }), charmander(5, 20)]));
  const pending = actions.sellPokemon(5, SELL);
  feed(saleEvent('Charmander Nv 20'));
  assert.deepEqual(await pending, {
    status: 'confirmed',
    request: { pokemonId: 5, name: 'Charmander', level: 20, shiny: false },
    confirmedBy: 'event',
    confidence: 'certain',
    gained: 4573,
  });
});

test('pokémon of the same species at different levels are told apart by the level in the event: still certain', async () => {
  const { actions, feed } = setupSell();
  feed(sellWelcome([pokemon(1, { slot: 0 }), charmander(5, 20), charmander(6, 30), charmander(7, 40)]));
  const pending = actions.sellPokemon(5, SELL);
  feed(saleEvent('Charmander Nv 20'));
  const result = await pending;
  assert.equal(result.status === 'confirmed' && result.confidence, 'certain');
});

test('two with the same name AND level cannot be told apart by the event: probable', async () => {
  const { actions, feed } = setupSell();
  feed(sellWelcome([pokemon(1, { slot: 0 }), charmander(5, 20), charmander(6, 20)]));
  const pending = actions.sellPokemon(5, SELL);
  feed(saleEvent('Charmander Nv 20'));
  const result = await pending;
  assert.deepEqual(
    [
      result.status === 'confirmed' && result.confirmedBy,
      result.status === 'confirmed' && result.confidence,
      result.status === 'confirmed' && result.gained,
    ],
    ['event', 'probable', 4573],
  );
});

test('a `venda` event for another level or another species does not confirm', async () => {
  const { actions, feed, scheduler } = setupSell();
  feed(sellWelcome([pokemon(1, { slot: 0 }), charmander(5, 20)]));
  const pending = actions.sellPokemon(5, SELL);
  feed(saleEvent('Charmander Nv 21'));
  feed(saleEvent('Squirtle Nv 20'));
  scheduler.advance(10_000);
  assert.equal((await pending).status, 'unconfirmed');
});

test('an event name with no level matches by name only', async () => {
  const { actions, feed } = setupSell();
  feed(sellWelcome([pokemon(1, { slot: 0 }), charmander(5, 20)]));
  const pending = actions.sellPokemon(5, SELL);
  feed(saleEvent('Charmander'));
  const result = await pending;
  assert.deepEqual([result.status === 'confirmed' && result.confirmedBy, result.status === 'confirmed' && result.gained], ['event', 4573]);
});

test('a shiny mark or a "Shiny " prefix in the event name is ignored', async () => {
  for (const nome of ['✨ Charmander Nv 20', 'Shiny Charmander Nv 20']) {
    const { actions, feed } = setupSell();
    feed(sellWelcome([pokemon(1, { slot: 0 }), charmander(5, 20, { shiny: true })]));
    const pending = actions.sellPokemon(5, SELL);
    feed(saleEvent(nome));
    const result = await pending;
    assert.equal(result.status === 'confirmed' && result.confirmedBy, 'event', nome);
  }
});
