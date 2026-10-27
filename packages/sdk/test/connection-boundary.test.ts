import assert from 'node:assert/strict';
import test from 'node:test';
import { Actions } from '../src/actions.js';
import { PageTransport, PokeIdleClient, type PageLike } from '../src/index.js';
import { SELL, setupSell } from './helpers/actions-setup.js';
import { FakeHost } from './helpers/fake-host.js';
import { FakeScheduler } from './helpers/fake-scheduler.js';
import { pokemon, sellWelcome } from './helpers/fixtures.js';

// A new connection is a new session: nothing learned on the old one may be used to send an order on the new one.

test('after the socket drops, actions refuse until the new welcome arrives (the old state is not trusted)', async () => {
  const ctx = setupSell();
  assert.equal((await ctx.actions.sellPokemon(5, { dryRun: true })).status, 'dry-run');
  ctx.transport.handlers?.onClose?.();
  assert.equal(ctx.client.state.complete, false);
  assert.equal((await ctx.actions.sellPokemon(5, { dryRun: true })).status, 'no-state');
  ctx.transport.handlers?.onOpen?.(); // a new socket is open, but its welcome has not come
  assert.equal(ctx.client.state.complete, false);
  assert.equal((await ctx.actions.sellPokemon(5, SELL)).status, 'no-state');
  assert.deepEqual(ctx.transport.sent, []);
  ctx.feed(sellWelcome([pokemon(5)]));
  assert.equal(ctx.client.state.complete, true);
});

test('a purchase or sale waiting for the game when the connection drops ends as unconfirmed, with the cooldown', async () => {
  const host = new FakeHost();
  host.feed(sellWelcome([pokemon(5)]));
  const actions = new Actions(host, { scheduler: new FakeScheduler(), rateLimit: false });
  const sale = actions.sellPokemon(5, SELL);
  host.disconnect();
  assert.equal((await sale).status, 'unconfirmed');
  assert.equal(host.subscriptions, 0);
  host.connected = true;
  host.feed(sellWelcome([pokemon(5)]));
  const next = await actions.sellPokemon(5, { dryRun: true });
  assert.equal(next.status, 'rate-limited'); // an unconfirmed order may have gone through: wait
  assert.equal(next.status === 'rate-limited' && next.reason, 'unconfirmed-cooldown');
});

test('a replaced socket is silent, so the OPEN of its successor is what makes the old state stale', async () => {
  class Sock extends EventTarget {
    readyState = 1;
    constructor(public url: string) {
      super();
    }
    send(): void {}
  }
  const page = { WebSocket: class extends Sock {}, location: { host: 'g', href: 'https://g/app' } } as unknown as PageLike;
  const client = new PokeIdleClient({ transport: new PageTransport(page) });
  client.start();
  const Socket = (page as unknown as { WebSocket: new (url: string) => Sock }).WebSocket;
  const first = new Socket('wss://g/');
  first.dispatchEvent(new Event('open'));
  first.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(sellWelcome([pokemon(5)])) }));
  assert.equal(client.state.complete, true);
  const second = new Socket('wss://g/'); // the game reconnects without the first one ever announcing its close
  second.dispatchEvent(new Event('open'));
  assert.equal(client.state.complete, false);
  assert.equal((await client.actions.sellPokemon(5, { dryRun: true })).status, 'no-state');
  second.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(sellWelcome([pokemon(5)])) }));
  assert.equal(client.state.complete, true);
});
