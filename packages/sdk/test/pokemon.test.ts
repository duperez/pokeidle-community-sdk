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
  });
  assert.deepEqual(normalizePokemon({ id: 7 }), { id: 7, name: null, level: null, shiny: null, inTeam: false, heldItemId: null });
});

test('normalizePokemon: text ids work, rows without a usable id are refused, odd values become null', () => {
  assert.equal(normalizePokemon({ id: '12' as never })?.id, 12);
  assert.equal(normalizePokemon({}), null);
  assert.equal(normalizePokemon({ id: 'abc' as never }), null);
  const odd = normalizePokemon({ id: 1, nome: 5 as never, level: NaN, shiny: 'yes' as never, heldItemId: 'x' as never });
  assert.deepEqual(odd, { id: 1, name: null, level: null, shiny: null, inTeam: false, heldItemId: null });
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
