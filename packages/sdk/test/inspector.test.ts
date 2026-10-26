import assert from 'node:assert/strict';
import test from 'node:test';
import { Inspector } from '../src/index.js';

test('counts received and sent packets and flags unknown types', () => {
  const inspector = new Inspector();
  inspector.recordReceived({ t: 'pong' });
  inspector.recordReceived({ t: 'pong' });
  inspector.recordReceived({ t: 'brand.new.type', x: 1 });
  inspector.recordSent({ t: 'ping' });
  const dump = inspector.dump();
  assert.deepEqual(dump.received, { pong: 2, 'brand.new.type': 1 });
  assert.deepEqual(dump.sent, { ping: 1 });
  assert.deepEqual(dump.unknownTypes, ['brand.new.type']);
});

test('samples are redacted at recording time and capped per type', () => {
  const inspector = new Inspector({ maxSamplesPerType: 2 });
  for (let i = 0; i < 5; i++) inspector.recordReceived({ t: 'welcome', token: 'secret-value', nick: 'SomeName', n: i });
  const samples = inspector.dump().samples.welcome as Array<Record<string, unknown>>;
  assert.equal(samples.length, 2);
  assert.ok(!JSON.stringify(samples).includes('secret-value'));
  assert.ok(!JSON.stringify(samples).includes('SomeName'));
  assert.equal(samples[0]?.n, 0);
});

test('the number of distinct types is capped', () => {
  const inspector = new Inspector({ maxTypes: 3 });
  for (let i = 0; i < 10; i++) inspector.recordReceived({ t: `type${i}` });
  const dump = inspector.dump();
  assert.ok(Object.keys(dump.received).length <= 4);
  assert.equal(dump.received['(other)'], 7);
  assert.ok(!dump.unknownTypes.includes('(other)'));
});

test('reset clears everything', () => {
  const inspector = new Inspector();
  inspector.recordReceived({ t: 'pong' });
  inspector.reset();
  assert.deepEqual(inspector.dump().received, {});
});
