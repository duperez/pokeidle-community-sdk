import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BATTLE_EVENT_KINDS, BATTLE_EVENT_READS, CLIENT_COMMAND_TYPES, KNOWN_PACKET_TYPES, PACKET_COVERAGE, SERVER_PACKET_READS, SERVER_PACKET_TYPES,
  battleEventCoverage, commandCoverage, isKnownPacketType,
} from '../src/index.js';

const unique = (list: readonly string[]) => new Set(list).size === list.length;

test('the registries are non-empty and have no duplicates', () => {
  for (const list of [SERVER_PACKET_TYPES, BATTLE_EVENT_KINDS, CLIENT_COMMAND_TYPES]) {
    assert.ok(list.length > 20);
    assert.ok(unique(list));
  }
});

test('the registry is the SDK\'s list of known packet types', () => {
  assert.deepEqual([...KNOWN_PACKET_TYPES], [...SERVER_PACKET_TYPES]);
  for (const t of ['welcome', 'estado', 'batalha', 'mg', 'raid', 'drop.raro', 'vivo']) assert.ok(isKnownPacketType(t), t);
  assert.ok(!isKnownPacketType('something.the.game.adds.later'));
});

test('every server packet type is classified, and has its list of fields the client reads', () => {
  assert.deepEqual(Object.keys(PACKET_COVERAGE).sort(), [...SERVER_PACKET_TYPES].sort());
  assert.deepEqual(Object.keys(SERVER_PACKET_READS).sort(), [...SERVER_PACKET_TYPES].sort());
  const traffic = Object.entries(PACKET_COVERAGE).filter(([, level]) => level === 'traffic').map(([type]) => type);
  assert.ok(traffic.includes('welcome') && traffic.includes('estado') && traffic.includes('batalha'));
  assert.ok(Object.values(PACKET_COVERAGE).every((level) => level === 'traffic' || level === 'client-code'));
});

test('every battle event kind is classified: five verified in traffic, the rest from the client\'s code', () => {
  assert.deepEqual(Object.keys(BATTLE_EVENT_READS).sort(), [...BATTLE_EVENT_KINDS].sort());
  const verified = BATTLE_EVENT_KINDS.filter((kind) => battleEventCoverage(kind) === 'traffic');
  assert.deepEqual([...verified].sort(), ['ataque', 'bola', 'fugiu', 'morte', 'spawn']);
  assert.ok(BATTLE_EVENT_KINDS.every((kind) => ['traffic', 'client-code'].includes(battleEventCoverage(kind))));
});

test('commands are classified as traffic, client-code or name-only; the money-out command stays name-only on purpose', () => {
  assert.equal(commandCoverage('shop.buy'), 'traffic');
  assert.equal(commandCoverage('ping'), 'traffic');
  assert.equal(commandCoverage('market.comprar'), 'client-code');
  assert.equal(commandCoverage('mg.palpite'), 'client-code');
  assert.equal(commandCoverage('orbs.sacar'), 'name-only'); // withdraws real cryptocurrency: no typed helper
  assert.equal(commandCoverage('guild.entrar'), 'name-only');
  for (const type of CLIENT_COMMAND_TYPES) assert.ok(['traffic', 'client-code', 'name-only'].includes(commandCoverage(type)), type);
});

test('the commands we will need for buying and selling exist in the game\'s client', () => {
  for (const t of ['shop.buy', 'shop.sellPokemon', 'shop.sellAllPokemons', 'loja.comprar', 'market.comprar', 'market.criar', 'market.cancelar', 'item.use']) {
    assert.ok((CLIENT_COMMAND_TYPES as readonly string[]).includes(t), t);
  }
});
