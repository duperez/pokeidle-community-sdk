import assert from 'node:assert/strict';
import test from 'node:test';
import { Actions } from '../src/actions.js';
import { Ball, CommandRefusedError, Item, type SendOutcome } from '../src/index.js';
import { FakeHost } from './helpers/fake-host.js';
import { FakeScheduler } from './helpers/fake-scheduler.js';
import { sellWelcome } from './helpers/fixtures.js';
import { setup, setupSell, SELL } from './helpers/actions-setup.js';

test('onSend reports acceptance after accounting, before the terminal result, and cannot reenter an action', async () => {
  const { actions, feed } = setup();
  const outcomes: SendOutcome[] = [];
  let reentrant: Promise<unknown> | undefined;
  let spentAtHook: number | undefined;
  const pending = actions.buyBall(Ball.UltraBall, 10, {
    onSend: (outcome) => {
      outcomes.push(outcome);
      spentAtHook = actions.spentLastHour;
      reentrant = actions.buyBall(Ball.UltraBall, 1);
    },
  });
  assert.deepEqual(outcomes, [{ status: 'accepted' }]);
  assert.ok(Object.isFrozen(outcomes[0]));
  assert.equal(spentAtHook, 1300);
  assert.deepEqual(await reentrant, { status: 'busy' });
  feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 10, gasto: 1300 }] });
  assert.equal((await pending).status, 'confirmed');
  assert.equal(outcomes.length, 1);
});

test('buyItem and sale also report dispatch before their results', async () => {
  const buy = setup();
  const sell = setupSell();
  const outcomes: SendOutcome[] = [];
  const purchase = buy.actions.buyItem(Item.SmallPotion, 2, { onSend: (outcome) => outcomes.push(outcome) });
  assert.deepEqual(outcomes, [{ status: 'accepted' }]);
  buy.feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Small Potion', qtd: 2 }] });
  assert.equal((await purchase).status, 'confirmed');
  const pending = sell.actions.sellPokemon(5, { ...SELL, onSend: (outcome) => outcomes.push(outcome) });
  assert.deepEqual(outcomes, [{ status: 'accepted' }, { status: 'accepted' }]);
  sell.feed({ t: 'batalha', ev: [{ k: 'venda', nome: 'Mon5 Nv 10', qtd: 1 }] });
  assert.equal((await pending).status, 'confirmed');
});

test('false is definitely not sent, with one hook and no spending; a dispatch guard also reports not-sent before rejection', async () => {
  const host = new FakeHost();
  host.feed(sellWelcome([]));
  const actions = new Actions(host);
  const outcomes: SendOutcome[] = [];
  const options = { onSend: (outcome: SendOutcome) => outcomes.push(outcome) };
  host.sendResult = false;
  assert.deepEqual(await actions.buyBall(Ball.UltraBall, 1, options), { status: 'not-connected' });
  assert.deepEqual(outcomes, [{ status: 'not-sent' }]);
  assert.equal(actions.spentLastHour, 0);
  host.sendError = new CommandRefusedError('shop.buy', 'test guard');
  await assert.rejects(actions.buyBall(Ball.UltraBall, 1, options), /test guard/);
  assert.deepEqual(outcomes, [{ status: 'not-sent' }, { status: 'not-sent' }]);
  assert.equal(actions.spentLastHour, 0);
  assert.equal(host.subscriptions, 1);
});

test('a synchronous transport failure reports uncertain with the original error and keeps waiting conservatively', async () => {
  const host = new FakeHost();
  host.feed(sellWelcome([]));
  const scheduler = new FakeScheduler();
  const errors: unknown[] = [];
  const actions = new Actions(host, { scheduler, confirmGraceMs: 0 }, (error) => errors.push(error));
  host.sendError = new Error('socket write outcome unknown');
  const outcomes: SendOutcome[] = [];
  const pending = actions.buyBall(Ball.UltraBall, 1, { onSend: (outcome) => outcomes.push(outcome) });
  assert.deepEqual(outcomes, [{ status: 'uncertain', error: host.sendError }]);
  assert.deepEqual(errors, [host.sendError]);
  assert.equal(actions.spentLastHour, 130);
  scheduler.advance(10_000);
  assert.equal((await pending).status, 'unconfirmed');
  assert.equal(outcomes.length, 1);
});

test('a throwing send observer is reported, not mistaken for a failed send or allowed to break reconciliation', async () => {
  const host = new FakeHost();
  host.feed(sellWelcome([]));
  const errors: unknown[] = [];
  const actions = new Actions(host, { confirmGraceMs: 0 }, (error) => errors.push(error));
  const error = new Error('persistence failed');
  const pending = actions.buyBall(Ball.UltraBall, 1, {
    onSend: () => {
      throw error;
    },
  });
  assert.deepEqual(errors, [error]);
  assert.equal(actions.spentLastHour, 130);
  host.feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 1, gasto: 130 }] });
  assert.equal((await pending).status, 'confirmed');
  assert.equal(host.sent.length, 1);
  assert.equal(host.subscriptions, 1);
});

test('preflight refusal and dry-run do not claim a dispatch occurred', async () => {
  const { actions } = setup({}, false);
  let calls = 0;
  const onSend = () => {
    calls += 1;
  };
  assert.equal((await actions.buyBall(Ball.UltraBall, 1, { onSend })).status, 'no-state');
  await assert.rejects(actions.buyBall(Ball.UltraBall, 0, { onSend }), RangeError);
  const ready = setup();
  assert.equal((await ready.actions.buyBall(Ball.UltraBall, 1, { dryRun: true, onSend })).status, 'dry-run');
  ready.client.stop();
  assert.equal((await ready.actions.buyBall(Ball.UltraBall, 1, { onSend })).status, 'not-connected');
  assert.equal(calls, 0);
});

test('even an immediate game answer is delivered after the send observer', async () => {
  const host = new FakeHost();
  host.feed(sellWelcome([]));
  const actions = new Actions(host, { confirmGraceMs: 0 });
  host.onSent = () => host.feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 1 }] });
  const order: string[] = [];
  const result = await actions.buyBall(Ball.UltraBall, 1, { onSend: () => order.push('send') });
  order.push('result');
  assert.equal(result.status, 'confirmed');
  assert.deepEqual(order, ['send', 'result']);
});
