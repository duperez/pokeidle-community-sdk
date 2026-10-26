import assert from 'node:assert/strict';
import test from 'node:test';
import { GameState, normalizePokemon, type Packet } from '../src/index.js';
import { pokemon, sellWelcome, welcome } from './helpers/fixtures.js';

test('normalizePokemon: game field names in, English model out', () => {
  assert.deepEqual(normalizePokemon({ id: 7, nome: 'Charmander', level: 20, shiny: true, slot: 2, heldItemId: 70050 }), {
    id: 7,
    name: 'Charmander',
    level: 20,
    shiny: true,
    inTeam: true,
    heldItemId: 70050,
    heldItemKnown: true,
  });
  assert.deepEqual(normalizePokemon({ id: 7 }), {
    id: 7,
    name: null,
    level: null,
    shiny: null,
    inTeam: false,
    heldItemId: null,
    heldItemKnown: true,
  });
});

test('normalizePokemon: text ids work, rows without a usable id are refused, odd values become null', () => {
  assert.equal(normalizePokemon({ id: '12' as never })?.id, 12);
  assert.equal(normalizePokemon({}), null);
  assert.equal(normalizePokemon({ id: 'abc' as never }), null);
  const odd = normalizePokemon({ id: 1, nome: 5 as never, level: NaN, shiny: 'yes' as never, heldItemId: 'x' as never });
  assert.deepEqual(odd, { id: 1, name: null, level: null, shiny: null, inTeam: false, heldItemId: null, heldItemKnown: false });
});

test('normalizePokemon fails closed on the team: any slot value but null/absent means team', () => {
  assert.equal(normalizePokemon({ id: 1, slot: 0 })?.inTeam, true);
  assert.equal(normalizePokemon({ id: 1, slot: 'a' as never })?.inTeam, true);
  assert.equal(normalizePokemon({ id: 1, slot: null as never })?.inTeam, false);
});

const stateWith = (packet: object): GameState => {
  const state = new GameState();
  state.applyPacket(packet as Packet);
  return state;
};

test('state.pokemon / pokemons: normalized, and the list is the same array until something changes', () => {
  const state = stateWith(sellWelcome([pokemon(1), pokemon(2, { nome: 'Pidgey', level: 5 })]));
  assert.equal(state.pokemon(2)?.name, 'Pidgey');
  assert.equal(state.pokemon(99), undefined);
  assert.deepEqual(
    state.pokemons.map((p) => p.id),
    [1, 2],
  );
  assert.equal(state.pokemons, state.pokemons);
  const before = state.pokemons;
  state.applyPacket({ t: 'estado', estado: { pkMud: [pokemon(3)] } });
  assert.notEqual(state.pokemons, before);
  assert.equal(state.pokemons.length, 3);
  state.applyPacket({ t: 'estado', estado: { pkFora: [1] } });
  assert.equal(state.pokemon(1), undefined);
});

test('three-valued questions: answers when known, null when not', () => {
  const state = stateWith(sellWelcome([pokemon(1), pokemon(2, { slot: 0 }), pokemon(3), pokemon(4, { heldItemId: 70050 })]));
  assert.deepEqual(
    [1, 2, 3, 4].map((id) => state.isActive(id)),
    [true, false, false, false],
  );
  assert.deepEqual(
    [1, 2, 3, 4].map((id) => state.isInTeam(id)),
    [false, true, false, false],
  );
  assert.deepEqual(
    [1, 2, 3, 4].map((id) => state.isInCollection(id)),
    [false, false, true, false],
  );
  assert.deepEqual(
    [1, 2, 3, 4].map((id) => state.holdsExpShare(id)),
    [false, false, false, true],
  );
  assert.equal(state.isInTeam(99), null); // not in the list
  assert.equal(state.holdsExpShare(99), null);
});

test('three-valued questions: a state without the data says null, never false', () => {
  const state = stateWith(welcome({ pokemons: [pokemon(1)] }));
  assert.equal(state.isActive(1), null);
  assert.equal(state.isInCollection(1), null);
  assert.equal(state.holdsExpShare(1), null);
  assert.equal(new GameState().isActive(1), null);
});

test('state.player is the same snapshot until an update; pokemonCount follows the list', () => {
  const state = stateWith(sellWelcome([pokemon(1), pokemon(2)]));
  const first = state.player;
  assert.equal(state.player, first);
  assert.equal(state.pokemonCount, 2);
  state.applyPacket({ t: 'estado', estado: { gold: 5 } });
  assert.notEqual(state.player, first);
  assert.equal(state.player?.gold, 5);
  assert.equal(first?.gold, 100_000); // the old snapshot did not change
  state.applyPacket({ t: 'estado', estado: { pkFora: [1] } });
  assert.equal(state.pokemonCount, 1);
  assert.equal(state.player?.pokemons.length, 1);
});

test('an unreadable held item is UNKNOWN, not "nothing": holdsExpShare answers null (fail closed)', () => {
  const state = stateWith(sellWelcome([pokemon(5, { heldItemId: ' 70050 ' }), pokemon(6, { heldItemId: null }), pokemon(7)]));
  assert.equal(state.pokemon(5)?.heldItemKnown, false);
  assert.equal(state.holdsExpShare(5), null);
  assert.equal(state.holdsExpShare(6), false);
  assert.equal(state.holdsExpShare(7), false);
});

test('state.player is frozen, and rows without a numeric id are left out everywhere', () => {
  const state = stateWith(sellWelcome([pokemon(1), { id: 'abc', nome: 'Bad' }]));
  assert.equal(Object.isFrozen(state.player), true);
  assert.equal(Object.isFrozen(state.player?.pokemons), true);
  assert.equal(state.pokemonCount, 1);
  assert.equal(state.pokemons.length, 1);
  assert.equal(state.findPokemon(1)?.id, 1);
});
