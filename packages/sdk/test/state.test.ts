import assert from 'node:assert/strict';
import test from 'node:test';
import { Ball, GameState, Item, type Packet } from '../src/index.js';

// Packets here are invented: they only copy the SHAPE of the real ones (names, nesting, types), never real values.
const welcome = (extra: Record<string, unknown> = {}): Packet => ({
  t: 'welcome',
  estado: {
    cheio: true,
    id: 1,
    nick: 'TestPlayer',
    level: 10,
    xp: 500,
    gold: 1000,
    diamonds: 3,
    orbs: 2,
    huntSlug: 'some-hunt',
    items: { '200': 5, '205': 1 },
    balls: { '1': 100, '2': 20 },
    pokemons: [
      { id: 11, nome: 'a' },
      { id: 12, nome: 'b' },
    ],
    pokedex: { '1': { seen: true } },
  },
  catalogoBolas: [
    { id: 1, nome: 'Poke Ball', catchRate: 1, priceGold: 5, compravel: true },
    { id: 2, nome: 'Great Ball', catchRate: 2, priceGold: 20, compravel: true },
    { id: 9, nome: 'Not Sold Ball', catchRate: 4, priceGold: 0, compravel: false },
  ],
  itensCompraveis: [{ itemId: 70091, preco: 20_000_000, nome: 'Mystery Egg P2' }],
  ...extra,
});
const delta = (estado: Record<string, unknown>): Packet => ({ t: 'estado', estado });

test('before any packet there is no player and the helpers are safe', () => {
  const state = new GameState();
  assert.equal(state.player, null);
  assert.equal(state.gold, null);
  assert.equal(state.itemCount(Item.Revive), 0);
  assert.equal(state.ballCount(Ball.PokeBall), 0);
});

test('welcome fills the player, the counts and the catalogs', () => {
  const state = new GameState();
  state.applyPacket(welcome());
  assert.deepEqual([state.level, state.xp, state.gold, state.diamonds, state.orbs, state.huntSlug], [10, 500, 1000, 3, 2, 'some-hunt']);
  assert.equal(state.itemCount(Item.SmallPotion), 5);
  assert.equal(state.itemCount(Item.Revive), 1);
  assert.equal(state.itemCount(Item.MaxRevive), 0);
  assert.equal(state.ballCount(Ball.GreatBall), 20);
  assert.deepEqual(
    state.ballCatalog.map((b) => [b.id, b.name, b.buyable]),
    [
      [1, 'Poke Ball', true],
      [2, 'Great Ball', true],
      [9, 'Not Sold Ball', false],
    ],
  );
  assert.deepEqual(state.shopItems, [{ itemId: 70091, name: 'Mystery Egg P2', price: 20_000_000 }]);
  assert.equal(state.player?.pokemons.length, 2);
});

test('updates change only what they carry', () => {
  const state = new GameState();
  state.applyPacket(welcome());
  state.applyPacket(delta({ gold: 1500, balls: { '1': 99, '2': 20 } }));
  assert.equal(state.gold, 1500);
  assert.equal(state.level, 10); // untouched
  assert.equal(state.ballCount(Ball.PokeBall), 99);
});

test('pokémon and pokédex deltas add, change and remove entries', () => {
  const state = new GameState();
  state.applyPacket(welcome());
  state.applyPacket(
    delta({
      pkMud: [
        { id: 12, nome: 'b2' },
        { id: 13, nome: 'c' },
      ],
      pkFora: [11],
      dexMud: { '2': { seen: true } },
    }),
  );
  const ids = state.player?.pokemons.map((k) => k.id);
  assert.deepEqual(ids, [12, 13]);
  assert.equal(state.player?.pokemons[0]?.['nome'], 'b2');
  assert.deepEqual(Object.keys(state.player?.pokedex ?? {}).sort(), ['1', '2']);
  state.applyPacket(delta({ dexFora: ['1'] }));
  assert.deepEqual(Object.keys(state.player?.pokedex ?? {}), ['2']);
});

test('a second welcome starts over, and a complete list outside a full state replaces the collection', () => {
  const state = new GameState();
  state.applyPacket(welcome());
  state.applyPacket(delta({ pokemons: [{ id: 99 }] }));
  assert.deepEqual(
    state.player?.pokemons.map((k) => k.id),
    [99],
  );
  state.applyPacket(welcome({ estado: { cheio: true, gold: 7 } }));
  assert.equal(state.gold, 7);
  assert.equal(state.level, null); // the old state is gone
  assert.deepEqual(state.player?.pokemons, []);
});

test('an update that arrives before any welcome becomes the base', () => {
  const state = new GameState();
  state.applyPacket(delta({ gold: 5, pkMud: [{ id: 1 }] }));
  assert.equal(state.gold, 5);
  assert.equal(state.player?.pokemons.length, 1);
});

test('malformed data is ignored instead of throwing', () => {
  const state = new GameState();
  assert.doesNotThrow(() => {
    state.applyPacket({ t: 'welcome', estado: 'nope', catalogoBolas: 'x', itensCompraveis: [null, 5, { itemId: 'a' }] });
    state.applyPacket({ t: 'estado', estado: [1, 2] });
    state.applyPacket(
      welcome({
        catalogoBolas: [null, { id: 'x' }, { id: 4 }],
        estado: { cheio: true, gold: 'rich', items: { '200': 'many' }, pokemons: [null, 7, { id: 1 }] },
      }),
    );
  });
  assert.equal(state.gold, null); // not a number
  assert.equal(state.itemCount(Item.SmallPotion), 0);
  assert.deepEqual(
    state.ballCatalog.map((b) => [b.id, b.name]),
    [[4, 'Ball 4']],
  );
  assert.equal(state.player?.pokemons.length, 1);
});

test('names come from the server catalogs first and the SDK catalogs after', () => {
  const state = new GameState();
  assert.equal(state.ballName(Ball.PokeBall), 'Poke Ball'); // SDK catalog
  state.applyPacket(welcome({ catalogoBolas: [{ id: 1, nome: 'Server Name', compravel: true }] }));
  assert.equal(state.ballName(1), 'Server Name');
  assert.equal(state.itemName(70091), 'Mystery Egg P2');
  assert.equal(state.itemName(Item.Revive), 'Revive');
  assert.equal(state.itemName(-5), null);
});

test('onChange fires after each applied state and a throwing listener does not break the others', () => {
  const state = new GameState();
  let calls = 0;
  const quiet = console.error;
  console.error = () => {};
  try {
    state.onChange(() => {
      throw new Error('boom');
    });
    const off = state.onChange(() => (calls += 1));
    state.applyPacket(welcome());
    state.applyPacket(delta({ gold: 1 }));
    off();
    state.applyPacket(delta({ gold: 2 }));
  } finally {
    console.error = quiet;
  }
  assert.equal(calls, 2);
});

test("keys that would change an object's prototype are never copied from server data", () => {
  const state = new GameState();
  state.applyPacket(JSON.parse('{"t":"welcome","estado":{"cheio":true,"gold":1,"__proto__":{"gold":999,"items":{"200":999}}}}') as Packet);
  state.applyPacket(
    JSON.parse('{"t":"estado","estado":{"level":3,"__proto__":{"orbs":999},"dexMud":{"__proto__":{"x":1},"7":{"seen":true}}}}') as Packet,
  );
  assert.equal(state.gold, 1);
  assert.equal(state.orbs, null);
  assert.equal(state.itemCount(Item.SmallPotion), 0);
  assert.equal(Object.getPrototypeOf(state.player), Object.prototype);
  assert.deepEqual(Object.keys(state.player?.pokedex ?? {}), ['7']);
  assert.equal(({} as Record<string, unknown>)['orbs'], undefined); // and the global prototype is untouched
});

test('pokémon ids match whether they come as numbers or as text', () => {
  const state = new GameState();
  state.applyPacket(welcome());
  state.applyPacket(delta({ pkFora: ['11'], pkMud: [{ id: '12', nome: 'b3' }] }));
  assert.deepEqual(
    state.player?.pokemons.map((k) => [k.id, k['nome']]),
    [['12', 'b3']],
  ); // 11 removed, 12 replaced (not duplicated)
});

test('changing the packet or the returned snapshot afterwards does not change the state', () => {
  const state = new GameState();
  const packet = welcome();
  state.applyPacket(packet);
  ((packet['estado'] as Record<string, unknown>)['items'] as Record<string, number>)['200'] = 999;
  assert.equal(state.itemCount(Item.SmallPotion), 5);
});

test('complete is false until a full state arrives, so late listeners can tell their data is partial', () => {
  const state = new GameState();
  assert.equal(state.complete, false);
  state.applyPacket(delta({ gold: 5 })); // updates only: what a late listener sees
  assert.equal(state.gold, 5);
  assert.equal(state.level, null);
  assert.equal(state.complete, false);
  state.applyPacket(welcome());
  assert.equal(state.complete, true);
});

test("the game's own items (not in the public catalog) are read from the welcome packet and named", () => {
  const state = new GameState();
  state.applyPacket(
    welcome({
      itensNossos: [
        { id: 70000, name: 'Bronze Boss Token', icon: '/x.png', category: 'key-item', rare: false, npcPrice: 0 },
        { id: 'x' },
        null,
      ],
    }),
  );
  assert.deepEqual(state.extraItems, [{ id: 70000, name: 'Bronze Boss Token', category: 'key-item', rare: false, npcPrice: 0 }]);
  assert.equal(state.itemName(70000), 'Bronze Boss Token');
});

test('itemName knows the server names and the NPC shop items, not the whole catalog (use itemInfo for that)', () => {
  const state = new GameState();
  assert.equal(state.itemName(Item.SmallPotion), 'Small Potion');
  assert.equal(state.itemName(Item.AirTank), null);
});

test('a failure while merging leaves the state stale, never half-applied and complete', () => {
  const state = new GameState();
  state.applyPacket(welcome());
  assert.equal(state.complete, true);
  let deep: Record<string, unknown> = {};
  for (let i = 0; i < 200_000; i++) deep = { a: deep };
  assert.throws(() => state.applyPacket({ t: 'estado', estado: { automation: deep } }), RangeError);
  assert.equal(state.complete, false);
});

test('huntName: the display name from the welcome hunt list, null for an unknown slug or before any list', () => {
  const state = new GameState();
  assert.equal(state.huntName('some-hunt'), null);
  state.applyPacket(
    welcome({
      hunts: [
        { slug: 'some-hunt', nome: 'Some Hunt', area: 'x', nivel: 5 },
        { slug: 'other', nome: 'Other' },
      ],
    }),
  );
  assert.equal(state.huntName('some-hunt'), 'Some Hunt');
  assert.equal(state.huntName('other'), 'Other');
  assert.equal(state.huntName('missing'), null);
});

test('huntName ignores malformed hunt entries and a later welcome replaces the list', () => {
  const state = new GameState();
  state.applyPacket(welcome({ hunts: [null, 5, {}, { slug: 'a' }, { nome: 'no slug' }, { slug: 'ok', nome: 'Ok' }] }));
  assert.equal(state.huntName('a'), null);
  assert.equal(state.huntName('ok'), 'Ok');
  state.applyPacket(welcome({ hunts: [{ slug: 'new', nome: 'New' }] }));
  assert.equal(state.huntName('ok'), null);
  assert.equal(state.huntName('new'), 'New');
  state.applyPacket(welcome()); // a welcome without a list keeps the last one
  assert.equal(state.huntName('new'), 'New');
});
