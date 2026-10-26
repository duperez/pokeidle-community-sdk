import assert from 'node:assert/strict';
import test from 'node:test';
import { KNOWN_PACKET_TYPES, isKnownPacketType, parsePacket, readFrame } from '../src/index.js';

test('parsePacket accepts JSON objects with a string type', () => {
  assert.deepEqual(parsePacket('{"t":"pong","n":1}'), { t: 'pong', n: 1 });
});

test('parsePacket returns null for anything else and never throws', () => {
  for (const bad of ['', 'not json', '[1,2]', '"text"', '42', 'null', '{"x":1}', '{"t":5}', '{"t":', '{'.repeat(10)]) {
    assert.equal(parsePacket(bad), null, bad);
  }
  assert.equal(parsePacket(undefined as unknown as string), null);
});

test('parsePacket ignores frames above the size limit', () => {
  const big = `{"t":"chat","x":"${'a'.repeat(200)}"}`;
  assert.equal(parsePacket(big, 100), null);
  assert.notEqual(parsePacket(big, 1000), null);
});

test('known packet types', () => {
  assert.ok(isKnownPacketType('welcome'));
  assert.ok(!isKnownPacketType('something.new'));
  assert.equal(new Set(KNOWN_PACKET_TYPES).size, KNOWN_PACKET_TYPES.length, 'no duplicates');
});

test('readFrame says why a frame was ignored', () => {
  assert.deepEqual(readFrame('nope'), { ignored: 'not-a-packet' });
  assert.deepEqual(readFrame('{"t":"x","a":"aaaaaaaaaaaaaaaaaaaa"}', 10), { ignored: 'oversized' });
  assert.deepEqual(readFrame('{"t":"pong"}'), { packet: { t: 'pong' } });
});

test('the default limit lets through a multi-megabyte welcome (big accounts send one)', () => {
  const frame = `{"t":"welcome","pokemons":"${'a'.repeat(5_000_000)}"}`;
  assert.equal(parsePacket(frame)?.t, 'welcome');
});
