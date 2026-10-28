import assert from 'node:assert/strict';
import test from 'node:test';
import { Actions } from '../src/actions.js';
import { PageTransport, type PageLike } from '../src/page-transport.js';
import { PokeIdleClient } from '../src/client-core.js';
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
  assert.equal(host.subscriptions, 1); // Actions' host-lifetime connection subscription
  host.connected = true;
  host.feed(sellWelcome([pokemon(5)]));
  const next = await actions.sellPokemon(5, { dryRun: true });
  assert.equal(next.status, 'rate-limited'); // an unconfirmed order may have gone through: wait
  assert.equal(next.status === 'rate-limited' && next.reason, 'unconfirmed-cooldown');
});

test('stop invalidates completeness, notifies observers and finishes pending orders as unconfirmed', async () => {
  const { client, actions } = setupSell();
  const readiness: boolean[] = [];
  client.state.onChange(() => readiness.push(client.state.complete));
  const pending = actions.sellPokemon(5, SELL);
  client.stop();
  assert.equal(client.connected, false);
  assert.equal(client.state.complete, false);
  assert.deepEqual(readiness, [false]);
  assert.equal((await pending).status, 'unconfirmed');
  client.stop();
  assert.deepEqual(readiness, [false]);
});

test('callbacks retained by an old transport run are ignored after stop and restart', () => {
  const { client, transport, feed } = setupSell();
  const old = transport.handlers;
  client.stop();
  old?.onMessage(JSON.stringify(sellWelcome([pokemon(99)])));
  assert.equal(client.state.complete, false);
  client.start();
  feed(sellWelcome([pokemon(5)]));
  old?.onMessage(JSON.stringify(sellWelcome([pokemon(99)])));
  old?.onClose?.();
  assert.equal(client.state.complete, true);
  assert.equal(client.state.pokemon(99), undefined);
  assert.equal(client.state.pokemon(5)?.id, 5);
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

test('adopting a CONNECTING successor invalidates completeness before it opens', () => {
  class Socket extends EventTarget {
    readyState = 0;
    constructor(public url: string) {
      super();
    }
    send(): void {}
  }
  const page = { WebSocket: class extends Socket {}, location: { host: 'g', href: 'https://g/' } } as unknown as PageLike;
  const client = new PokeIdleClient({ transport: new PageTransport(page) });
  client.start();
  const first = new page.WebSocket('wss://g/');
  Object.assign(first, { readyState: 1 });
  first.dispatchEvent(new Event('open'));
  first.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(sellWelcome([pokemon(5)])) }));
  assert.equal(client.state.complete, true);
  const readiness: boolean[] = [];
  client.onConnectionChange(() => readiness.push(client.state.complete));
  new page.WebSocket('wss://g/');
  assert.equal(client.state.complete, false, 'adoption, not the later open event, ends the old generation');
  assert.deepEqual(readiness, [false]);
});
