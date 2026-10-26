import assert from 'node:assert/strict';
import test from 'node:test';
import { PokeIdleClient, type Transport, type TransportHandlers } from '../src/index.js';

class FakeTransport implements Transport {
  handlers: TransportHandlers | null = null;
  sent: string[] = [];
  readyState = 1;
  starts = 0;
  start(handlers: TransportHandlers): void {
    this.starts += 1;
    this.handlers = handlers;
  }
  stop(): void {
    this.handlers = null;
  }
  send(text: string): boolean {
    if (this.readyState !== 1) return false;
    this.sent.push(text);
    return true;
  }
}

const setup = () => {
  const transport = new FakeTransport();
  const errors: unknown[] = [];
  const client = new PokeIdleClient({ transport, onError: (e) => errors.push(e) });
  client.start();
  return { transport, client, errors };
};

test('delivers packets by type and to the catch-all listener', () => {
  const { transport, client } = setup();
  const typed: string[] = [];
  const all: string[] = [];
  client.on('pong', (p) => typed.push(p.t));
  client.onPacket((p) => all.push(p.t));
  transport.handlers?.onMessage('{"t":"pong"}');
  transport.handlers?.onMessage('{"t":"other"}');
  assert.deepEqual(typed, ['pong']);
  assert.deepEqual(all, ['pong', 'other']);
});

test('ignores frames that are not packets', () => {
  const { transport, client } = setup();
  let calls = 0;
  client.onPacket(() => (calls += 1));
  for (const bad of ['', 'nope', '[]', '{"x":1}']) transport.handlers?.onMessage(bad);
  assert.equal(calls, 0);
});

test('a throwing listener does not break the others and is reported', () => {
  const { transport, client, errors } = setup();
  const seen: string[] = [];
  client.on('pong', () => {
    throw new Error('boom');
  });
  client.on('pong', (p) => seen.push(p.t));
  transport.handlers?.onMessage('{"t":"pong"}');
  assert.deepEqual(seen, ['pong']);
  assert.equal(errors.length, 1);
});

test('unsubscribe stops delivery', () => {
  const { transport, client } = setup();
  let calls = 0;
  const off = client.on('pong', () => (calls += 1));
  transport.handlers?.onMessage('{"t":"pong"}');
  off();
  transport.handlers?.onMessage('{"t":"pong"}');
  assert.equal(calls, 1);
});

test('observes outgoing packets, connection changes and records in the inspector', () => {
  const { transport, client } = setup();
  const out: string[] = [];
  const states: boolean[] = [];
  client.onOutgoing((p) => out.push(p.t));
  client.onConnectionChange((c) => states.push(c));
  transport.handlers?.onOutgoing?.('{"t":"ping"}');
  transport.handlers?.onOpen?.();
  transport.handlers?.onClose?.();
  transport.handlers?.onMessage('{"t":"pong"}');
  assert.deepEqual(out, ['ping']);
  assert.deepEqual(states, [true, false]);
  const dump = client.inspector?.dump();
  assert.deepEqual(dump?.sent, { ping: 1 });
  assert.deepEqual(dump?.received, { pong: 1 });
});

test('start is idempotent, stop detaches, sendRaw goes through the transport', () => {
  const { transport, client } = setup();
  client.start();
  assert.equal(transport.starts, 1);
  assert.equal(client.sendRaw('{"t":"ping"}'), true);
  assert.deepEqual(transport.sent, ['{"t":"ping"}']);
  transport.readyState = 3;
  assert.equal(client.sendRaw('x'), false);
  assert.equal(client.connected, false);
  client.stop();
  assert.equal(transport.handlers, null);
});

test('the inspector can be turned off', () => {
  const client = new PokeIdleClient({ transport: new FakeTransport(), inspector: false });
  assert.equal(client.inspector, null);
});
