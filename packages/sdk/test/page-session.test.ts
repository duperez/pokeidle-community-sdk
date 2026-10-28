import assert from 'node:assert/strict';
import test from 'node:test';
import * as SDK from '../src/index.js';
import { welcome } from './helpers/fixtures.js';
import { ensurePageSession } from '../src/page-session.js';
import { FakeScheduler } from './helpers/fake-scheduler.js';
import { page } from './helpers/fake-page.js';

const SESSION = Symbol.for('pokeidle-community-sdk.page-session');
const HOOK = Symbol.for('pokeidle-community-sdk.page-hook');
const bootstrap = (options?: unknown): void => {
  const start = Reflect.get(SDK, 'bootstrapPageSession') as ((options?: unknown) => void) | undefined;
  assert.equal(typeof start, 'function');
  start?.(options);
};

test('one frame is parsed and applied once, not once per attached facade', (t) => {
  const fixture = page(t);
  const parse = JSON.parse;
  const frame = JSON.stringify(welcome());
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoked below with the original state receiver.
  const apply = SDK.GameState.prototype.applyPacket;
  let parses = 0;
  let applies = 0;
  JSON.parse = (...args: Parameters<typeof JSON.parse>) => {
    if (args[0] === frame) parses++;
    const value: unknown = parse(...args);
    return value;
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
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Identity comparison only; never invoked unbound.
    const send = Original.prototype.send;
    Object.defineProperty(globalThis, SESSION, { value: occupied, configurable: true });
    assert.throws(
      () => bootstrap(),
      (error: unknown) => error instanceof SDK.PageSessionError && error.code === 'incompatible-runtime',
    );
    assert.equal(globalThis.WebSocket, Original);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Identity comparison only.
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
  const client = new SDK.PokeIdleClient();
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
  const a = new SDK.PokeIdleClient();
  assert.equal(globalThis.WebSocket, Original);
  bootstrap();
  const b = new SDK.PokeIdleClient();
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
  const client = new SDK.PokeIdleClient();
  client.start();
  assert.equal(globalThis.WebSocket, patched, 'default start adopts existing explicit policy');
});

test('two consumers cannot mutate shared event payloads or stop a peer callback run', (t) => {
  const fixture = page(t);
  bootstrap();
  const errors: unknown[] = [];
  const a = new SDK.PokeIdleClient({ onError: (error) => errors.push(error) });
  const b = new SDK.PokeIdleClient();
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

for (const phase of ['packet', 'battle', 'outgoing', 'connection', 'state'] as const) {
  test(`a reentrant replacement interrupts old-generation ${phase} tails and peer delivery`, (t) => {
    const fixture = page(t);
    bootstrap();
    const a = new SDK.PokeIdleClient();
    const b = new SDK.PokeIdleClient();
    a.start();
    b.start();
    const ws = fixture.socket();
    ws.open();
    ws.feed(welcome());
    const seen: string[] = [];
    let replaced = false;
    const replace = () => {
      if (replaced) return;
      replaced = true;
      seen.push('first');
      fixture.socket();
    };
    if (phase === 'packet') {
      a.on('welcome', replace);
      a.on('welcome', () => seen.push('a-type-tail'));
      a.onPacket(() => seen.push('a-packet-tail'));
      b.on('welcome', () => seen.push('b-packet'));
      ws.feed(welcome());
    } else if (phase === 'battle') {
      a.onBattleEvent('compra', replace);
      a.onBattleEvent('compra', () => seen.push('a-battle-tail'));
      a.onAnyBattleEvent(() => seen.push('a-any-tail'));
      b.onAnyBattleEvent(() => seen.push('b-battle'));
      ws.feed({ t: 'batalha', ev: [{ k: 'compra' }, { k: 'compra' }] });
    } else if (phase === 'outgoing') {
      a.onOutgoing(replace);
      a.onOutgoing(() => seen.push('a-outgoing-tail'));
      b.onOutgoing(() => seen.push('b-outgoing'));
      ws.send('{"t":"ping"}');
    } else if (phase === 'connection') {
      a.onConnectionChange((connected) => {
        if (connected) replace();
      });
      a.onConnectionChange((connected) => {
        if (connected) seen.push('a-open-tail');
      });
      b.onConnectionChange((connected) => {
        if (connected) seen.push('b-open');
      });
      ws.open();
    } else {
      a.state.onChange(() => {
        if (a.state.complete) replace();
      });
      a.state.onChange(() => {
        if (a.state.complete) seen.push('a-state-tail');
      });
      a.on('estado', () => seen.push('a-state-packet'));
      b.on('estado', () => seen.push('b-state-packet'));
      ws.feed({ t: 'estado', estado: { gold: 101 } });
    }
    assert.deepEqual(seen, ['first']);
    assert.equal(b.generation, 2);
    assert.equal(b.state.complete, false);
  });
}

test('a restart during stop cannot receive a stale false tail or an unsubscribed callback', (t) => {
  const fixture = page(t);
  const client = new SDK.PokeIdleClient();
  client.start();
  const ws = fixture.socket();
  ws.open();
  ws.feed(welcome());
  const seen: boolean[] = [];
  let restart = true;
  client.state.onChange(() => {
    if (restart) {
      restart = false;
      client.start();
    }
  });
  client.onConnectionChange((connected) => seen.push(connected));
  client.stop();
  assert.deepEqual(seen, [true]);
  assert.equal(client.connected, true);
  let removedCalls = 0;
  let off = () => {};
  client.onConnectionChange(() => off());
  off = client.onConnectionChange(() => removedCalls++);
  client.stop();
  assert.equal(removedCalls, 0);
});

test('a not-sent receipt that stops its owner cannot become unconfirmed or invent cooldown', async (t) => {
  const fixture = page(t);
  const clock = new FakeScheduler();
  ensurePageSession(globalThis, { actions: { rateLimit: false } }, clock);
  const a = new SDK.PokeIdleClient();
  const b = new SDK.PokeIdleClient();
  a.start();
  b.start();
  const ws = fixture.socket();
  ws.open();
  ws.feed(welcome());
  const now = clock.now.bind(clock);
  let reads = 0;
  clock.now = () => {
    if (++reads === 2) ws.close(); // internal seam: lose the socket after preflight but before dispatch
    return now();
  };
  const receipts: string[] = [];
  const result = await a.actions.buyBall(SDK.Ball.UltraBall, 1, {
    onSend: (outcome) => {
      receipts.push(outcome.status);
      a.stop();
    },
  });
  assert.deepEqual(receipts, ['not-sent']);
  assert.equal(result.status, 'not-connected');
  assert.equal(clock.pending, 0);
  assert.equal(fixture.Socket.writes.length, 0);
  assert.equal(b.actions.spentLastHour, 0);
  const successor = fixture.socket();
  successor.open();
  successor.feed(welcome());
  assert.equal((await b.actions.buyBall(SDK.Ball.UltraBall, 1, { dryRun: true })).status, 'dry-run');
});

test('owner detach risk retains cooldown after the original waiter later confirms', async (t) => {
  const fixture = page(t);
  const clock = new FakeScheduler();
  ensurePageSession(globalThis, { actions: { rateLimit: false, confirmGraceMs: 0, unconfirmedCooldownMs: 20 } }, clock);
  const a = new SDK.PokeIdleClient();
  const b = new SDK.PokeIdleClient();
  a.start();
  b.start();
  const ws = fixture.socket();
  ws.open();
  ws.feed(welcome());
  const pending = a.actions.buyBall(SDK.Ball.UltraBall, 1);
  a.stop();
  assert.equal((await pending).status, 'unconfirmed');
  clock.advance(21);
  assert.equal((await b.actions.buyBall(SDK.Ball.UltraBall, 1)).status, 'busy');
  ws.feed({ t: 'batalha', ev: [{ k: 'compra', nome: 'Ultra Ball', qtd: 1 }] });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal((await b.actions.buyBall(SDK.Ball.UltraBall, 1, { dryRun: true })).status, 'rate-limited');
  clock.advance(20);
  assert.equal((await b.actions.buyBall(SDK.Ball.UltraBall, 1, { dryRun: true })).status, 'dry-run');
  assert.equal(clock.pending, 0);
});

test('a generation change inside onSend preserves accepted before the unconfirmed terminal', async (t) => {
  const fixture = page(t);
  bootstrap({ actions: { rateLimit: false, unconfirmedCooldownMs: 0 } });
  const client = new SDK.PokeIdleClient();
  client.start();
  const ws = fixture.socket();
  ws.open();
  ws.feed(welcome());
  const order: string[] = [];
  const result = await client.actions.buyBall(SDK.Ball.UltraBall, 1, {
    onSend: (outcome) => {
      order.push(outcome.status);
      fixture.socket();
    },
  });
  order.push(result.status);
  assert.deepEqual(order, ['accepted', 'unconfirmed']);
  assert.equal(fixture.Socket.writes.length, 1);
  assert.equal(client.generation, 2);
  assert.equal(client.state.complete, false);
});

test('invalid action arguments reject before lifecycle or busy refusals without bootstrapping', async (t) => {
  page(t);
  const Original = globalThis.WebSocket;
  const client = new SDK.PokeIdleClient();
  await assert.rejects(client.actions.buyBall(-1, 1), RangeError);
  await assert.rejects(client.actions.buyItem(1, 0), RangeError);
  await assert.rejects(client.actions.sellPokemon(NaN), RangeError);
  assert.equal(globalThis.WebSocket, Original);
  assert.equal(Reflect.get(globalThis, SESSION), undefined);
});

test('owner stop keeps the shared writer reserved until original reconciliation finishes', async (t) => {
  const fixture = page(t);
  bootstrap({ actions: { rateLimit: false, confirmGraceMs: 0, unconfirmedCooldownMs: 0 } });
  const a = new SDK.PokeIdleClient();
  const b = new SDK.PokeIdleClient();
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
  await assert.rejects(b.actions.buyBall(SDK.Ball.UltraBall, 0), RangeError);
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
