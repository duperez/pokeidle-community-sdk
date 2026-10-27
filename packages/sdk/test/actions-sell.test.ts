import assert from 'node:assert/strict';
import test from 'node:test';
import { PokeIdleClient } from '../src/index.js';
import { FakeTransport, tick, setup, setupSell, SELL, charmander, saleEvent } from './helpers/actions-setup.js';
import { pokemon, sellWelcome, welcome } from './helpers/fixtures.js';
import { CommandRefusedError } from '../src/index.js';

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
