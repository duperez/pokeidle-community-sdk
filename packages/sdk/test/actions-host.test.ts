import assert from 'node:assert/strict';
import test from 'node:test';
import { Actions } from '../src/actions.js';
import { Ball } from '../src/index.js';
import type { ActionsOptions } from '../src/index.js';
import { FakeHost } from './helpers/fake-host.js';
import { FakeScheduler } from './helpers/fake-scheduler.js';
import { pokemon, sellWelcome, welcome } from './helpers/fixtures.js';

// Actions depend on `ActionsHost`, not on the client: these tests use no client, no transport and no JSON.

function make(options: ActionsOptions = {}, packet: Record<string, unknown> = welcome()) {
  const host = new FakeHost();
  const scheduler = new FakeScheduler();
  const actions = new Actions(host, { confirmGraceMs: 0, ...options, scheduler });
  host.feed(packet);
  return { host, scheduler, actions };
}
const purchased = { t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 10 }] };
const SELL = { confirmIrreversible: true } as const;

test("actions run on any host: a purchase is sent as a command and confirmed by the game's event", async () => {
  const { host, actions } = make();
  const pending = actions.buyBall(Ball.UltraBall, 10);
  assert.deepEqual(host.sent, [{ command: { t: 'shop.buy', kind: 'ball', id: 4, qty: 10 }, options: { confirmIrreversible: false } }]);
  host.feed(purchased);
  assert.equal((await pending).status, 'confirmed');
});

test('a purchase never asks for the irreversible confirmation, and a sale always does (the flag cannot leak between them)', async () => {
  const { host, scheduler, actions } = make({ rateLimit: false }, sellWelcome([pokemon(1, { slot: 0 }), pokemon(5)]));
  const buy = actions.buyBall(Ball.UltraBall, 10);
  host.feed(purchased);
  await buy;
  const sale = actions.sellPokemon(5, SELL);
  host.feed({ t: 'estado', estado: { pkFora: [5] } });
  await sale;
  assert.deepEqual(
    host.sent.map((s) => [s.command.t, s.options?.confirmIrreversible]),
    [
      ['shop.buy', false],
      ['shop.sellPokemon', true],
    ],
  );
  assert.equal(scheduler.pending, 0);
});

test('no subscription is left behind on any path of a purchase: event, inventory, error, timeout', async () => {
  const { host, scheduler, actions } = make({ rateLimit: false, unconfirmedCooldownMs: 0 });
  let pending = actions.buyBall(Ball.UltraBall, 10);
  assert.ok(host.subscriptions > 0, 'listening while it waits');
  host.feed(purchased);
  assert.equal((await pending).status, 'confirmed');
  assert.equal(host.subscriptions, 0);
  pending = actions.buyBall(Ball.UltraBall, 10);
  host.feed({ t: 'estado', estado: { balls: { '1': 100, '4': 200, '5': 0 } } });
  assert.equal((await pending).status, 'confirmed');
  assert.equal(host.subscriptions, 0);
  pending = actions.buyBall(Ball.UltraBall, 10);
  host.feed({ t: 'erro', chave: 'x' });
  assert.equal((await pending).status, 'rejected');
  assert.equal(host.subscriptions, 0);
  pending = actions.buyBall(Ball.UltraBall, 10);
  scheduler.advance(10_000);
  assert.equal((await pending).status, 'unconfirmed');
  assert.equal(host.subscriptions, 0);
  assert.equal(scheduler.pending, 0);
});

test('no subscription is left behind on any path of a sale, and a refused send leaves nothing in flight', async () => {
  const { host, scheduler, actions } = make(
    { rateLimit: false, unconfirmedCooldownMs: 0 },
    sellWelcome([pokemon(1, { slot: 0 }), pokemon(5), pokemon(6), pokemon(7), pokemon(8), pokemon(9)]),
  );
  let pending = actions.sellPokemon(5, SELL);
  host.feed({ t: 'batalha', ev: [{ k: 'venda', nome: 'Mon5', ganho: 1 }] });
  assert.equal((await pending).status, 'confirmed');
  pending = actions.sellPokemon(6, SELL);
  host.feed({ t: 'estado', estado: { pkFora: [6] } });
  assert.equal((await pending).status, 'confirmed');
  pending = actions.sellPokemon(7, SELL);
  host.feed({ t: 'erro', chave: 'x' });
  assert.equal((await pending).status, 'rejected');
  pending = actions.sellPokemon(8, SELL);
  scheduler.advance(10_000);
  assert.equal((await pending).status, 'unconfirmed');
  assert.equal(host.subscriptions, 0);
  assert.equal(scheduler.pending, 0);
  host.sendResult = false;
  assert.deepEqual(await actions.sellPokemon(9, SELL), { status: 'not-connected' });
  assert.equal(host.subscriptions, 0);
  host.sendResult = true;
  const again = actions.sellPokemon(9, SELL); // not busy: the refused send left nothing in flight
  assert.equal(host.sent.length, 6);
  host.feed({ t: 'estado', estado: { pkFora: [9] } });
  await again;
});

test('when the host refuses the frame nothing is left in flight, listening or counted', async () => {
  const { host, scheduler, actions } = make();
  host.sendResult = false;
  assert.deepEqual(await actions.buyBall(Ball.UltraBall, 10), { status: 'not-connected' });
  assert.equal(host.subscriptions, 0);
  assert.equal(scheduler.pending, 0);
  host.sendResult = true;
  const next = actions.buyBall(Ball.UltraBall, 10); // not busy, not rate limited: the failed send counted for nothing
  assert.equal(host.sent.length, 2);
  scheduler.advance(10_000);
  await next;
});

test('when sending throws, the error reaches the caller and nothing is left in flight, listening or counted', async () => {
  const { host, scheduler, actions } = make();
  host.sendError = new Error('boom');
  await assert.rejects(actions.buyBall(Ball.UltraBall, 10), /boom/);
  assert.equal(host.subscriptions, 0);
  assert.equal(scheduler.pending, 0);
  host.sendError = null;
  const next = actions.buyBall(Ball.UltraBall, 10);
  assert.equal(host.sent.length, 1);
  scheduler.advance(10_000);
  await next;
});

test('an answer that arrives from inside the send is not missed', async () => {
  const { host, actions } = make();
  host.onSent = () => host.feed(purchased);
  assert.equal((await actions.buyBall(Ball.UltraBall, 10)).status, 'confirmed');
  assert.equal(host.subscriptions, 0);
});

test('a host that is not connected sends nothing', async () => {
  const { host, actions } = make();
  host.connected = false;
  assert.deepEqual(await actions.buyBall(Ball.UltraBall, 10), { status: 'not-connected' });
  assert.deepEqual(host.sent, []);
});

test('the grace window leaves no timer and no subscription behind when the event never comes', async () => {
  const { host, scheduler, actions } = make({ confirmGraceMs: 1000 }, sellWelcome([pokemon(1, { slot: 0 }), pokemon(5)]));
  const pending = actions.sellPokemon(5, SELL);
  host.feed({ t: 'estado', estado: { pkFora: [5] } });
  assert.equal(scheduler.pending, 2); // the timeout and the window
  scheduler.advance(1000);
  assert.equal((await pending).status, 'confirmed');
  assert.equal(host.subscriptions, 0);
  assert.equal(scheduler.pending, 0);
});
