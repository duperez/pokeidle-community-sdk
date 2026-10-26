import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/index.js';
import { Ball, Item, PokeIdleClient, type ActionsOptions, type Scheduler, type Transport, type TransportHandlers } from '../src/index.js';

class FakeTransport implements Transport {
  handlers: TransportHandlers | null = null;
  sent: Array<Record<string, unknown>> = [];
  readyState = 1;
  start(handlers: TransportHandlers): void { this.handlers = handlers; }
  stop(): void {}
  send(text: string): boolean {
    if (this.readyState !== 1) return false;
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
    return true;
  }
}

class FakeScheduler implements Scheduler {
  time = 1_000_000;
  private timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private next = 1;
  now(): number { return this.time; }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.timers.push({ at: this.time + ms, fn, id });
    return id;
  }
  clearTimeout(handle: unknown): void { this.timers = this.timers.filter((t) => t.id !== handle); }
  advance(ms: number): void {
    this.time += ms;
    for (const timer of this.timers.filter((t) => t.at <= this.time)) {
      this.timers = this.timers.filter((t) => t !== timer);
      timer.fn();
    }
  }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

// Invented values with the shape of the real packets.
const welcome = (estado: Record<string, unknown> = {}) => ({
  t: 'welcome',
  estado: { cheio: true, gold: 100_000, items: { '200': 10 }, balls: { '1': 100, '4': 72, '5': 0 }, pokemons: [], ...estado },
  catalogoBolas: [
    { id: 1, nome: 'Poke Ball', catchRate: 1, priceGold: 5, compravel: true },
    { id: 4, nome: 'Ultra Ball', catchRate: 4, priceGold: 130, compravel: true },
    { id: 5, nome: 'Beast Ball', catchRate: 8, compravel: false },
  ],
  itensCompraveis: [{ itemId: 70091, preco: 20_000_000, nome: 'Mystery Egg P2' }],
});

function setup(options: ActionsOptions = {}, withWelcome = true) {
  const transport = new FakeTransport();
  const scheduler = new FakeScheduler();
  const client = new PokeIdleClient({ transport, actions: { ...options, scheduler } });
  client.start();
  const feed = (...packets: object[]) => packets.forEach((p) => transport.handlers?.onMessage(JSON.stringify(p)));
  if (withWelcome) feed(welcome());
  return { transport, scheduler, client, feed, actions: client.actions };
}

test('dry run says what it would send and sends nothing', async () => {
  const { transport, actions } = setup();
  const result = await actions.buyBall(Ball.UltraBall, 10, { dryRun: true });
  assert.deepEqual(result, { status: 'dry-run', request: { kind: 'ball', id: 4, quantity: 10, unitPrice: 130, totalPrice: 1300 }, command: { t: 'shop.buy', kind: 'ball', id: 4, qty: 10 } });
  assert.deepEqual(transport.sent, []);
  const everything = setup({ dryRun: true });
  assert.equal((await everything.actions.buyItem(Item.SmallPotion, 5)).status, 'dry-run'); // the option on the client
  assert.deepEqual(everything.transport.sent, []);
});

test('a purchase is sent and confirmed by the game\'s own `compra` event', async () => {
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
  if (result.status === 'confirmed') assert.deepEqual([result.confirmedBy, result.before, result.after, result.spent], ['inventory', 72, 82, 1300]);
});

test('a `compra` event for another quantity or another item does not confirm', async () => {
  const { actions, feed, scheduler } = setup();
  const pending = actions.buyBall(Ball.UltraBall, 10);
  feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 3 }, { k: 'compra', nome: 'Revive', qtd: 10 }] });
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

/** Counts the subscriptions the actions open and close on the client, so a leak shows up as a number. */
function watchSubscriptions(client: PokeIdleClient) {
  let active = 0;
  const wrap = <A extends unknown[]>(fn: (...args: A) => () => void) => (...args: A): (() => void) => {
    active += 1;
    const off = fn(...args);
    let closed = false;
    return () => {
      if (!closed) { closed = true; active -= 1; }
      off();
    };
  };
  const target = client as unknown as { onType: (...a: never[]) => () => void; onBattleEvent: (...a: never[]) => () => void };
  const state = client.state as unknown as { onChange: (...a: never[]) => () => void };
  target.onType = wrap(target.onType.bind(client) as never) as never;
  target.onBattleEvent = wrap(target.onBattleEvent.bind(client) as never) as never;
  state.onChange = wrap(state.onChange.bind(client.state) as never) as never;
  return () => active;
}

test('no listener is left behind on any path: confirmed by event, by inventory, rejected, unconfirmed', async () => {
  const { actions, client, feed, scheduler } = setup({ rateLimit: false, unconfirmedCooldownMs: 0 });
  const leaked = watchSubscriptions(client);
  let p = actions.buyBall(Ball.UltraBall, 10);
  assert.ok(leaked() > 0, 'listening while waiting');
  feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 10 }] });
  assert.equal((await p).status, 'confirmed');
  assert.equal(leaked(), 0);
  p = actions.buyBall(Ball.UltraBall, 10);
  feed({ t: 'estado', estado: { balls: { '1': 100, '4': 200, '5': 0 } } });
  assert.equal((await p).status, 'confirmed');
  assert.equal(leaked(), 0);
  p = actions.buyBall(Ball.UltraBall, 10);
  feed({ t: 'erro', chave: 'x' });
  assert.equal((await p).status, 'rejected');
  assert.equal(leaked(), 0);
  p = actions.buyBall(Ball.UltraBall, 10);
  scheduler.advance(10_000);
  assert.equal((await p).status, 'unconfirmed');
  assert.equal(leaked(), 0);
});

test('when the socket refuses the frame nothing is left in flight, listening or counted', async () => {
  const { actions, client, transport, scheduler } = setup();
  const leaked = watchSubscriptions(client);
  transport.send = () => false; // the socket looks open but does not take the frame
  assert.deepEqual(await actions.buyBall(Ball.UltraBall, 10), { status: 'not-connected' });
  assert.equal(leaked(), 0);
  transport.send = (text: string) => { transport.sent.push(JSON.parse(text) as Record<string, unknown>); return true; };
  const next = actions.buyBall(Ball.UltraBall, 10); // not busy, not rate limited: the failed send counted for nothing
  assert.equal(transport.sent.length, 1);
  scheduler.advance(10_000);
  await next;
});

test('when sending throws, the error reaches the caller and nothing is left in flight, listening or counted', async () => {
  const { actions, client, transport, scheduler } = setup();
  const leaked = watchSubscriptions(client);
  const real = client.sendCommand.bind(client);
  client.sendCommand = () => { throw new Error('boom'); };
  await assert.rejects(actions.buyBall(Ball.UltraBall, 10), /boom/);
  assert.equal(leaked(), 0);
  client.sendCommand = real;
  const next = actions.buyBall(Ball.UltraBall, 10);
  assert.equal(transport.sent.length, 1);
  scheduler.advance(10_000);
  await next;
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
  feed({ t: 'batalha', ev: [{ k: 'compra', qtd: 10 }, { k: 'compra', nome: 'Great Ball', qtd: 10 }] });
  scheduler.advance(10_000);
  assert.equal((await pending).status, 'unconfirmed');
});

test('confidence: certain for the game\'s own event, probable for the inventory and for an error', async () => {
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
  for (const bad of [{ maxGoldPerHour: Number.NaN }, { maxGoldPerHour: -1 }, { confirmTimeoutMs: Number.POSITIVE_INFINITY }, { rateLimit: { minIntervalMs: Number.NaN } }, { rateLimit: { maxPerMinute: -5 } }, { unconfirmedCooldownMs: -1 }]) {
    assert.throws(() => new PokeIdleClient({ transport, actions: bad }), RangeError, JSON.stringify(bad));
  }
});

test('the Actions class is not exported: the limits belong to client.actions', () => {
  assert.equal('Actions' in sdk, false);
  const { client } = setup();
  assert.equal(typeof client.actions.buyBall, 'function');
});
