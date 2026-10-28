import assert from 'node:assert/strict';
import test from 'node:test';
import * as SDK from '../src/index.js';
import { welcome } from './helpers/fixtures.js';
import { ensurePageSession } from '../src/page-session.js';
import { FakeScheduler } from './helpers/fake-scheduler.js';

const SESSION = Symbol.for('pokeidle-community-sdk.page-session');
const HOOK = Symbol.for('pokeidle-community-sdk.page-hook');
const bootstrap = (options?: unknown): void => {
  const start = Reflect.get(SDK, 'bootstrapPageSession') as ((options?: unknown) => void) | undefined;
  assert.equal(typeof start, 'function');
  start?.(options);
};

function page(t: { after(fn: () => void): void }) {
  const keys = ['WebSocket', 'location', SESSION, HOOK];
  const saved = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  class Socket extends EventTarget {
    static writes: string[] = [];
    static onWrite: (() => void) | undefined;
    static error: Error | undefined;
    readyState = 0;
    constructor(public url: string) {
      super();
    }
    send(text: string): void {
      Socket.writes.push(text);
      Socket.onWrite?.();
      if (Socket.error) throw Socket.error;
    }
    open(): void {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    }
    feed(packet: object): void {
      this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(packet) }));
    }
    close(): void {
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
  }
  for (const key of keys) Reflect.deleteProperty(globalThis, key);
  Object.defineProperties(globalThis, {
    WebSocket: { value: Socket, writable: true, configurable: true },
    location: { value: { host: 'game.example', href: 'https://game.example/' }, configurable: true },
  });
  t.after(() => {
    keys.forEach((key, index) => {
      Reflect.deleteProperty(globalThis, key);
      const descriptor = saved[index];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    });
  });
  return {
    Socket,
    socket() {
      const ws = new globalThis.WebSocket('wss://game.example/');
      return ws as unknown as Socket;
    },
  };
}

test('one frame is parsed and applied once, not once per attached facade', (t) => {
  const fixture = page(t);
  const parse = JSON.parse;
  const frame = JSON.stringify(welcome());
  const apply = SDK.GameState.prototype.applyPacket;
  let parses = 0;
  let applies = 0;
  JSON.parse = (...args: Parameters<typeof JSON.parse>) => {
    if (args[0] === frame) parses++;
    return parse(...args);
  };
  t.after(() => {
    JSON.parse = parse;
  });
  t.mock.method(SDK.GameState.prototype, 'applyPacket', function (this: SDK.GameState, packet: SDK.Packet) {
    applies++;
    apply.call(this, packet);
  });
  bootstrap();
  const a = new SDK.PokeIdleClient();
  const b = new SDK.PokeIdleClient();
  a.start();
  b.start();
  const ws = fixture.socket();
  ws.open();
  ws.feed(welcome());
  assert.equal(parses, 1);
  assert.equal(applies, 1);
  assert.equal(a.state.player, b.state.player);
});

test('state subscriptions ignore packets that do not change game state', (t) => {
  const fixture = page(t);
  const client = new SDK.PokeIdleClient();
  client.start();
  const ws = fixture.socket();
  ws.open();
  let changes = 0;
  client.state.onChange(() => changes++);
  ws.feed({ t: 'pong' });
  ws.feed({ t: 'market', resumo: [] });
  assert.equal(changes, 0);
  ws.feed(welcome());
  assert.equal(changes, 1);
});

test('late adoption without an observed full state stays incomplete and never queries for one', (t) => {
  const fixture = page(t);
  const existing = fixture.socket();
  existing.open();
  existing.feed(welcome());
  bootstrap();
  const client = new SDK.PokeIdleClient();
  client.start();
  assert.equal(client.connected, false);
  existing.send('{"t":"ping"}');
  assert.equal(client.connected, true);
  assert.equal(client.state.complete, false);
  assert.equal(client.generation, 1);
  existing.feed({ t: 'estado', estado: { gold: 12 } });
  assert.equal(client.state.gold, 12);
  assert.equal(client.state.complete, false);
  assert.deepEqual(fixture.Socket.writes, ['{"t":"ping"}']);
});

test('generation invalidates on CONNECTING and stale sockets cannot restore current state', (t) => {
  const fixture = page(t);
  const client = new SDK.PokeIdleClient();
  client.start();
  const old = fixture.socket();
  old.open();
  old.feed(welcome());
  const observed: Array<[number, boolean, boolean]> = [];
  client.onConnectionChange(() => observed.push([client.generation, client.connected, client.state.complete]));
  const current = fixture.socket();
  assert.equal(client.generation, 2);
  assert.deepEqual(observed, [[2, false, false]]);
  old.feed(welcome());
  old.close();
  old.open();
  assert.equal(client.state.complete, false);
  current.open();
  assert.equal(client.generation, 2);
  current.feed(welcome());
  assert.equal(client.state.complete, true);
});

for (const occupied of [
  null,
  {},
  { abi: 999 },
  { abi: 1, capabilities: ['shared-state', 'shared-writer', 'consumer-lifecycle'], runtime: 1 },
]) {
  test(`incompatible runtime slot is refused without replacing native hooks (${JSON.stringify(occupied)})`, (t) => {
    page(t);
    const Original = globalThis.WebSocket;
    const send = Original.prototype.send;
    Object.defineProperty(globalThis, SESSION, { value: occupied, configurable: true });
    assert.throws(
      () => bootstrap(),
      (error: unknown) => error instanceof SDK.PageSessionError && error.code === 'incompatible-runtime',
    );
    assert.equal(globalThis.WebSocket, Original);
    assert.equal(globalThis.WebSocket.prototype.send, send);
    assert.equal(Reflect.get(globalThis, SESSION), occupied);
  });
}

test('a legacy hook is explicitly rejected before patching, and start can retry after correction', (t) => {
  page(t);
  const Original = globalThis.WebSocket;
  const occupied = { version: 1 };
  Object.defineProperty(globalThis, HOOK, { value: occupied, configurable: true });
  const client = new SDK.PokeIdleClient();
  assert.throws(() => client.start(), SDK.PageSessionError);
  assert.equal(client.connected, false);
  assert.equal(globalThis.WebSocket, Original);
  Reflect.deleteProperty(globalThis, HOOK);
  client.start();
  assert.notEqual(globalThis.WebSocket, Original);
});

test('policy inputs are copied and equivalent normalized options reuse the live runtime', (t) => {
  const fixture = page(t);
  const options = { actions: { dryRun: true, checks: { gold: true }, rateLimit: { minIntervalMs: 0, maxPerMinute: 99 } } };
  bootstrap(options);
  options.actions.dryRun = false;
  options.actions.checks.gold = false;
  options.actions.rateLimit.maxPerMinute = 0;
  const client = new SDK.PokeIdleClient();
  client.start();
  const ws = fixture.socket();
  ws.open();
  ws.feed(welcome());
  return client.actions.buyBall(SDK.Ball.UltraBall, 1).then((result) => {
    assert.equal(result.status, 'dry-run');
    assert.deepEqual(fixture.Socket.writes, []);
    bootstrap({ actions: { dryRun: true, rateLimit: { minIntervalMs: 0, maxPerMinute: 99 } } });
  });
});

test('Inspectors and captured error options belong to their consumers', (t) => {
  const fixture = page(t);
  const errors: unknown[] = [];
  const options = { onError: (error: unknown) => errors.push(error) };
  const a = new SDK.PokeIdleClient(options);
  const b = new SDK.PokeIdleClient();
  options.onError = () => {
    throw new Error('must not replace captured handler');
  };
  a.start();
  b.start();
  a.onPacket(() => {
    throw new Error('local observer');
  });
  const ws = fixture.socket();
  ws.open();
  ws.feed({ t: 'pong' });
  a.inspector?.reset();
  assert.equal(b.inspector?.dump().received.pong, 1);
  assert.equal(errors.length, 1);
});

test('owner detach keeps the original timeout, including when cooldown is disabled', async (t) => {
  const fixture = page(t);
  const clock = new FakeScheduler();
  ensurePageSession(globalThis, { actions: { confirmTimeoutMs: 100, unconfirmedCooldownMs: 0, rateLimit: false } }, clock);
  const a = new SDK.PokeIdleClient();
  const b = new SDK.PokeIdleClient();
  a.start();
  b.start();
  const ws = fixture.socket();
  ws.open();
  ws.feed(welcome());
  const pending = a.actions.buyBall(SDK.Ball.UltraBall, 1);
  clock.advance(40);
  a.stop();
  assert.equal((await pending).status, 'unconfirmed');
  clock.advance(59);
  assert.equal((await b.actions.buyBall(SDK.Ball.UltraBall, 1)).status, 'busy');
  clock.advance(1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal((await b.actions.buyBall(SDK.Ball.UltraBall, 1, { dryRun: true })).status, 'dry-run');
});

test('stopping a reader cannot cancel a peer action, and immediate evidence precedes public observers', async (t) => {
  const fixture = page(t);
  bootstrap({ actions: { rateLimit: false, confirmGraceMs: 0 } });
  const a = new SDK.PokeIdleClient();
  const b = new SDK.PokeIdleClient();
  a.start();
  b.start();
  const ws = fixture.socket();
  ws.open();
  ws.feed(welcome());
  const order: string[] = [];
  fixture.Socket.onWrite = () => ws.feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 1 }] });
  const pending = a.actions.buyBall(SDK.Ball.UltraBall, 1, {
    onSend: () => {
      order.push('send');
      a.stop();
    },
  });
  b.stop();
  const result = await pending;
  order.push('terminal');
  assert.equal(result.status, 'confirmed', 'already matched evidence survives owner stop');
  assert.deepEqual(order, ['send', 'terminal']);
});

test('public sends are promises of local acceptance and native failures remain uncertain', async (t) => {
  const fixture = page(t);
  const clock = new FakeScheduler();
  ensurePageSession(globalThis, { actions: { confirmTimeoutMs: 10, rateLimit: false, confirmGraceMs: 0 } }, clock);
  const errors: unknown[] = [];
  const client = new SDK.PokeIdleClient({ onError: (error) => errors.push(error) });
  client.start();
  const ws = fixture.socket();
  ws.open();
  ws.feed(welcome());
  const accepted = client.sendCommand({ t: 'market.itens' });
  assert.equal(fixture.Socket.writes.length, 1, 'Promise does not defer the local write or wait for an ACK');
  assert.equal(await accepted, true);
  assert.throws(() => client.sendCommand({ t: 'shop.sellPokemon', pokemonId: 5 }), SDK.CommandRefusedError);
  const error = new Error('invented native failure');
  fixture.Socket.error = error;
  await assert.rejects(client.sendRaw('{"t":"ping"}'), (actual) => actual === error);
  const outcomes: SDK.SendOutcome[] = [];
  const pending = client.actions.buyBall(SDK.Ball.UltraBall, 1, { onSend: (outcome) => outcomes.push(outcome) });
  assert.deepEqual(outcomes, [{ status: 'uncertain', error }]);
  assert.deepEqual(errors, [error]);
  clock.advance(10);
  assert.equal((await pending).status, 'unconfirmed');
});

test('observed low-level/manual interference prevents isolated inventory confirmation and certain attribution', async (t) => {
  const fixture = page(t);
  const clock = new FakeScheduler();
  ensurePageSession(
    globalThis,
    { actions: { confirmTimeoutMs: 10, confirmGraceMs: 0, rateLimit: false, unconfirmedCooldownMs: 0 } },
    clock,
  );
  const client = new SDK.PokeIdleClient();
  client.start();
  const ws = fixture.socket();
  ws.open();
  ws.feed(welcome());
  await client.sendCommand({ t: 'market.itens' });
  const pending = client.actions.buyBall(SDK.Ball.UltraBall, 1);
  ws.feed({ t: 'estado', estado: { balls: { 4: 1000 } } });
  clock.advance(10);
  assert.equal((await pending).status, 'unconfirmed');
  await new Promise<void>((resolve) => setImmediate(resolve));
  const next = client.actions.buyBall(SDK.Ball.UltraBall, 1);
  ws.send('{"t":"ping"}');
  ws.feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 1 }] });
  const result = await next;
  assert.equal(result.status, 'confirmed');
  if (result.status === 'confirmed') assert.equal(result.confidence, 'probable');
});
test('early standalone bootstrap collects full state before the first consumer attaches', (t) => {
  const fixture = page(t);
  const bootstrap = Reflect.get(SDK, 'bootstrapPageSession') as (() => void) | undefined;
  assert.equal(typeof bootstrap, 'function', 'early capture must be available independently of a consumer');
  bootstrap?.();
  const ws = fixture.socket();
  ws.open();
  ws.feed(welcome());
  const client = Reflect.construct(SDK.PokeIdleClient, []) as SDK.PokeIdleClient;
  let packets = 0;
  client.onPacket(() => packets++);
  client.start();
  assert.equal(client.connected, true);
  assert.equal(client.state.complete, true, 'attach uses state actually collected by bootstrap');
  assert.equal(packets, 0, 'attach must not replay old welcome or domain events');
  assert.deepEqual(fixture.Socket.writes, [], 'capture and subscription send no commands');
});

test('construction is inert and stop detaches only one consumer while capture continues', (t) => {
  const fixture = page(t);
  const Original = globalThis.WebSocket;
  const a = Reflect.construct(SDK.PokeIdleClient, []) as SDK.PokeIdleClient;
  assert.equal(globalThis.WebSocket, Original);
  bootstrap();
  const b = Reflect.construct(SDK.PokeIdleClient, []) as SDK.PokeIdleClient;
  a.start();
  b.start();
  const ws = fixture.socket();
  ws.open();
  ws.feed(welcome());
  a.stop();
  ws.feed({ t: 'estado', estado: { gold: 123 } });
  assert.equal(a.state.complete, false);
  assert.notEqual(a.state.gold, 123, 'stopped facade retains last-known, not live peer data');
  assert.equal(b.state.gold, 123);
  b.stop();
  ws.feed({ t: 'estado', estado: { gold: 456 } });
  a.start();
  assert.equal(a.state.complete, true);
  assert.equal(a.state.gold, 456);
  assert.equal(ws.readyState, 1);
});

test('policy conflicts and legacy configuration fail before changing the page hook', (t) => {
  page(t);
  const Original = globalThis.WebSocket;
  assert.throws(() => Reflect.construct(SDK.PokeIdleClient, [{ transport: {} }]));
  assert.equal(globalThis.WebSocket, Original);
  bootstrap({ maxPacketBytes: 1000 });
  const patched = globalThis.WebSocket;
  bootstrap({ maxPacketBytes: 1000 });
  assert.equal(globalThis.WebSocket, patched);
  assert.throws(
    () => bootstrap(),
    (error: unknown) => Reflect.get(Object(error), 'code') === 'configuration-conflict',
  );
  assert.equal(globalThis.WebSocket, patched);
  const client = Reflect.construct(SDK.PokeIdleClient, []) as SDK.PokeIdleClient;
  client.start();
  assert.equal(globalThis.WebSocket, patched, 'default start adopts existing explicit policy');
});

test('two consumers cannot mutate shared event payloads or stop a peer callback run', (t) => {
  const fixture = page(t);
  bootstrap();
  const errors: unknown[] = [];
  const a = Reflect.construct(SDK.PokeIdleClient, [{ onError: (error: unknown) => errors.push(error) }]) as SDK.PokeIdleClient;
  const b = Reflect.construct(SDK.PokeIdleClient, []) as SDK.PokeIdleClient;
  a.start();
  b.start();
  const seen: unknown[] = [];
  a.onPacket((packet) => {
    Reflect.set(packet, 'changed', true);
    throw new Error('consumer only');
  });
  b.onPacket((packet) => seen.push(packet['changed']));
  const ws = fixture.socket();
  ws.open();
  ws.feed({ t: 'pong' });
  assert.deepEqual(seen, [undefined]);
  assert.equal(errors.length, 1);
  a.on('pong', () => b.stop());
  ws.feed({ t: 'pong' });
  assert.equal(seen.length, 1, 'reentrant stop invalidates an already captured delivery run');
  assert.equal(Reflect.get(a.state, 'applyPacket'), undefined);
});

test('owner stop keeps the shared writer reserved until original reconciliation finishes', async (t) => {
  const fixture = page(t);
  bootstrap({ actions: { rateLimit: false, confirmGraceMs: 0, unconfirmedCooldownMs: 0 } });
  const a = Reflect.construct(SDK.PokeIdleClient, []) as SDK.PokeIdleClient;
  const b = Reflect.construct(SDK.PokeIdleClient, []) as SDK.PokeIdleClient;
  a.start();
  b.start();
  const ws = fixture.socket();
  ws.open();
  ws.feed(welcome());
  const order: string[] = [];
  const pending = a.actions.buyBall(SDK.Ball.UltraBall, 1, { onSend: () => order.push('send') });
  a.stop();
  const terminal = await pending;
  order.push('terminal');
  assert.equal(terminal.status, 'unconfirmed');
  if (terminal.status === 'unconfirmed')
    assert.equal(Object.isFrozen(terminal.request), true, 'detached callers cannot mutate the live waiter request');
  assert.deepEqual(order, ['send', 'terminal']);
  assert.equal((await b.actions.buyBall(SDK.Ball.UltraBall, 1)).status, 'busy');
  assert.throws(
    () => b.sendCommand({ t: 'market.itens' }),
    (error: unknown) => Reflect.get(Object(error), 'code') === 'busy',
  );
  assert.equal(fixture.Socket.writes.length, 1);
  ws.feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 1 }] });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const next = b.actions.buyBall(SDK.Ball.UltraBall, 1);
  ws.feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 1 }] });
  assert.equal((await next).status, 'confirmed');
  assert.equal(
    (await b.actions.buyBall(SDK.Ball.UltraBall, 1, { dryRun: true })).status,
    'dry-run',
    'terminal resolution releases the writer before consumer continuations',
  );
});
