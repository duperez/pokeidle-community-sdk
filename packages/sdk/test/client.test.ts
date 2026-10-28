import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PokeIdleClient as Core } from '../src/client-core.js';
import { PokeIdleClient, bootstrapPageSession } from '../src/index.js';
import { page } from './helpers/fake-page.js';
import type { Transport, TransportHandlers } from '../src/transport.js';

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

const setup = (t: TestContext) => {
  const fixture = page(t);
  const errors: unknown[] = [];
  const client = new PokeIdleClient({ onError: (e) => errors.push(e) });
  client.start();
  const socket = fixture.socket();
  socket.open();
  return { socket, client, errors, fixture };
};

test('delivers packets by type and to the catch-all listener', (t) => {
  const { socket, client } = setup(t);
  const typed: string[] = [];
  const all: string[] = [];
  client.on('pong', (p) => typed.push(p.t));
  client.onPacket((p) => all.push(p.t));
  socket.raw('{"t":"pong"}');
  socket.raw('{"t":"other"}');
  assert.deepEqual(typed, ['pong']);
  assert.deepEqual(all, ['pong', 'other']);
});

test('ignores frames that are not packets', (t) => {
  const { socket, client } = setup(t);
  let calls = 0;
  client.onPacket(() => (calls += 1));
  for (const bad of ['', 'nope', '[]', '{"x":1}']) socket.raw(bad);
  assert.equal(calls, 0);
});

test('a throwing listener does not break the others and is reported', (t) => {
  const { socket, client, errors } = setup(t);
  const seen: string[] = [];
  client.on('pong', () => {
    throw new Error('boom');
  });
  client.on('pong', (p) => seen.push(p.t));
  socket.raw('{"t":"pong"}');
  assert.deepEqual(seen, ['pong']);
  assert.equal(errors.length, 1);
});

test('unsubscribe stops delivery', (t) => {
  const { socket, client } = setup(t);
  let calls = 0;
  const off = client.on('pong', () => (calls += 1));
  socket.raw('{"t":"pong"}');
  off();
  socket.raw('{"t":"pong"}');
  assert.equal(calls, 1);
});

test('observes outgoing packets, connection changes and records in the inspector', (t) => {
  const { socket, client } = setup(t);
  const out: string[] = [];
  const states: boolean[] = [];
  client.onOutgoing((p) => out.push(p.t));
  client.onConnectionChange((c) => states.push(c));
  socket.send('{"t":"ping"}');
  socket.open();
  socket.raw('{"t":"pong"}');
  socket.close();
  assert.deepEqual(out, ['ping']);
  assert.deepEqual(states, [true, false]);
  const dump = client.inspector?.dump();
  assert.deepEqual(dump?.sent, { ping: 1 });
  assert.deepEqual(dump?.received, { pong: 1 });
});

test('start is idempotent, stop detaches only the consumer, sendRaw uses the page socket', async (t) => {
  const { socket, client, fixture } = setup(t);
  const hook = globalThis.WebSocket;
  client.start();
  assert.equal(globalThis.WebSocket, hook);
  assert.equal(await client.sendRaw('{"t":"ping"}'), true);
  assert.deepEqual(fixture.Socket.writes, ['{"t":"ping"}']);
  client.stop();
  assert.equal(socket.readyState, 1, 'consumer stop never closes the game socket');
  assert.equal(await client.sendRaw('x'), false);
  assert.equal(client.connected, false);
});

test('a failed start detaches partial handlers and can be retried', () => {
  const transport = new FakeTransport();
  const start = transport.start.bind(transport);
  let first = true;
  transport.start = (handlers) => {
    start(handlers);
    if (first) {
      first = false;
      handlers.onMessage('{"t":"welcome","estado":{"gold":1}}');
      throw new Error('startup failed');
    }
  };
  const client = new Core({ transport });
  assert.throws(() => client.start(), /startup failed/);
  assert.equal(transport.handlers, null);
  assert.equal(client.connected, false);
  assert.equal(client.state.complete, false);
  client.start();
  assert.equal(client.connected, true);
  assert.equal(transport.starts, 2);
});

test('the inspector can be turned off', () => {
  const client = new PokeIdleClient({ inspector: false });
  assert.equal(client.inspector, null);
});

test('on() gives a typed packet for known types, and client.state is updated before the listener runs', (t) => {
  const { socket, client } = setup(t);
  const seen: Array<number | undefined> = [];
  client.on('welcome', (packet) => {
    const gold: number | undefined = packet.estado?.gold; // typed: a wrong field type would not compile
    seen.push(gold, client.state.gold ?? undefined);
  });
  socket.raw('{"t":"welcome","estado":{"cheio":true,"gold":42}}');
  assert.deepEqual(seen, [42, 42]);
  client.onType('some.other.type', (packet) => seen.push(Object.keys(packet).length)); // a type the SDK does not know
  socket.raw('{"t":"some.other.type","a":1}');
  assert.equal(seen.at(-1), 2);
});

test('a frame that is ignored is counted by the inspector, never dropped silently', (t) => {
  const fixture = page(t);
  bootstrapPageSession({ maxPacketBytes: 50 });
  const client = new PokeIdleClient();
  client.start();
  const socket = fixture.socket();
  socket.open();
  socket.raw(`{"t":"welcome","big":"${'a'.repeat(100)}"}`);
  socket.raw('garbage');
  socket.raw('{"t":"pong"}');
  assert.deepEqual(client.inspector?.dump().ignored, { oversized: 1, 'not-a-packet': 1 });
  assert.deepEqual(client.inspector?.dump().received, { pong: 1 });
});
