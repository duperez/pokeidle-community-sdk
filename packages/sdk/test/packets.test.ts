import assert from 'node:assert/strict';
import test from 'node:test';
import { KNOWN_PACKET_TYPES, isKnownPacketType, parsePacket } from '../src/index.js';

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
