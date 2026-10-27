import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './helpers/actions-setup.js';
import { Ball, Item } from '../src/index.js';

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
