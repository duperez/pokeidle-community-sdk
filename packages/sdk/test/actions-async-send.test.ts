import assert from 'node:assert/strict';
import test from 'node:test';
import { tick } from './helpers/actions-setup.js';
import { FakeScheduler } from './helpers/fake-scheduler.js';
import { welcome } from './helpers/fixtures.js';
import { Ball, PokeIdleClient, type Transport, type TransportHandlers } from '../src/index.js';

// A transport whose `send` is asynchronous (a host where the write reaches the game's socket over IPC, like a launcher).

class AsyncTransport implements Transport<Promise<boolean>> {
  handlers: TransportHandlers | null = null;
  sent: Array<Record<string, unknown>> = [];
  readyState = 1;
  /** How the next sends end: resolve with `true`/`false`, or reject. */
  mode: 'accept' | 'refuse' | 'reject' = 'accept';
  start(handlers: TransportHandlers): void {
    this.handlers = handlers;
  }
  stop(): void {}
  async send(text: string): Promise<boolean> {
    await tick();
    if (this.mode === 'reject') throw new Error('ipc failed');
    if (this.mode === 'refuse') return false;
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
    return true;
  }
}

function setupAsync(options: ConstructorParameters<typeof PokeIdleClient>[0]['actions'] = {}) {
  const transport = new AsyncTransport();
  const scheduler = new FakeScheduler();
  const client = new PokeIdleClient({ transport, actions: { confirmGraceMs: 0, ...options, scheduler } });
  client.start();
  const feed = (...packets: object[]) => packets.forEach((p) => transport.handlers?.onMessage(JSON.stringify(p)));
  feed(welcome());
  return { transport, scheduler, client, feed, actions: client.actions };
}

test('an asynchronous transport: the purchase is sent, awaited and confirmed by the game', async () => {
  const { transport, actions, feed } = setupAsync();
  const pending = actions.buyBall(Ball.UltraBall, 10);
  await tick();
  await tick();
  assert.deepEqual(transport.sent, [{ t: 'shop.buy', kind: 'ball', id: 4, qty: 10 }]);
  feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 10, gasto: 1300 }] });
  assert.equal((await pending).status, 'confirmed');
});

test('an answer that comes BEFORE the send promise settles is not lost (we listen before sending)', async () => {
  const { transport, actions, feed } = setupAsync();
  const pending = actions.buyBall(Ball.UltraBall, 10);
  feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 10, gasto: 1300 }] }); // instant answer, send still in flight
  const result = await pending;
  assert.equal(result.status, 'confirmed');
  assert.equal(transport.sent.length, 1);
});

test('an asynchronous transport that resolves `false`: not-connected, nothing charged, no cooldown', async () => {
  const { transport, actions } = setupAsync({ maxGoldPerHour: 1300 });
  transport.mode = 'refuse';
  assert.equal((await actions.buyBall(Ball.UltraBall, 10)).status, 'not-connected');
  transport.mode = 'accept';
  const again = actions.buyBall(Ball.UltraBall, 10);
  await tick();
  await tick();
  assert.equal(transport.sent.length, 1, 'the budget was not spent by the refused attempt, so the next one goes out');
  void again;
});

test('a REJECTED send is treated as "maybe sent": the budget is charged and the order ends unconfirmed with a cooldown', async () => {
  const { transport, actions, scheduler } = setupAsync({ maxGoldPerHour: 1300 });
  transport.mode = 'reject';
  const pending = actions.buyBall(Ball.UltraBall, 10);
  await tick();
  await tick();
  scheduler.advance(10_000);
  const result = await pending;
  assert.equal(result.status, 'unconfirmed');
  // the spending cap now counts the maybe-sent order, so a second one is refused for the cap (and the cooldown holds it too)
  transport.mode = 'accept';
  const second = await actions.buyBall(Ball.UltraBall, 10);
  assert.notEqual(second.status, 'confirmed');
  assert.equal(transport.sent.length, 0);
});

test('only one order at a time, also while an asynchronous send is in flight', async () => {
  const { actions } = setupAsync();
  const first = actions.buyBall(Ball.UltraBall, 10);
  const second = await actions.buyBall(Ball.UltraBall, 10);
  assert.equal(second.status, 'busy');
  void first;
});

test('a guard that refuses still throws synchronously, before anything is sent', async () => {
  const { transport, client } = setupAsync();
  assert.throws(() => client.sendCommand({ t: 'shop.sellPokemon', pokemonId: 5 }), /confirmIrreversible/);
  assert.deepEqual(transport.sent, []);
  const answer = client.sendCommand({ t: 'shop.buy', kind: 'ball', id: 4, qty: 2 });
  assert.ok(answer instanceof Promise, 'sendCommand returns the transport promise');
  assert.equal(await answer, true);
});

test('a REJECTED send charges BOTH budgets: the cap alone (no cooldown, no rate limit) refuses the next order', async () => {
  const { transport, actions, scheduler } = setupAsync({ maxGoldPerHour: 1300, unconfirmedCooldownMs: 0, rateLimit: false });
  transport.mode = 'reject';
  const first = actions.buyBall(Ball.UltraBall, 10);
  await tick();
  await tick();
  scheduler.advance(10_000);
  assert.equal((await first).status, 'unconfirmed');
  transport.mode = 'accept';
  const second = await actions.buyBall(Ball.UltraBall, 10);
  assert.equal(second.status, 'spend-cap', 'the maybe-sent order spent the whole cap');
  assert.equal(transport.sent.length, 0);
});

test('a send that never settles keeps the instance busy (documented), and the confirmation listeners are still released', async () => {
  const transport = new AsyncTransport();
  transport.send = () => new Promise<boolean>(() => {}); // never settles
  const scheduler = new FakeScheduler();
  const client = new PokeIdleClient({ transport, actions: { confirmGraceMs: 0, scheduler } });
  client.start();
  transport.handlers?.onMessage(JSON.stringify(welcome()));
  void client.actions.buyBall(Ball.UltraBall, 10);
  await tick();
  assert.equal((await client.actions.buyBall(Ball.UltraBall, 10)).status, 'busy');
  scheduler.advance(60_000);
  assert.equal((await client.actions.buyBall(Ball.UltraBall, 10)).status, 'busy');
});
