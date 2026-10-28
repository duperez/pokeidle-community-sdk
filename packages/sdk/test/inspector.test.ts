import assert from 'node:assert/strict';
import test from 'node:test';
import { BATTLE_EVENT_KINDS, CLIENT_COMMAND_TYPES, KNOWN_PACKET_TYPES, Inspector, TEXT_MASK } from '../src/index.js';
import { PokeIdleClient } from '../src/client-core.js';
import type { TransportHandlers } from '../src/transport.js';

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

test('samples of social packets (chat, friends, guilds...) keep the structure and drop every text', () => {
  const inspector = new Inspector();
  inspector.recordReceived({
    t: 'chat',
    canal: 'world',
    de: 'SomePlayer',
    texto: 'hello there, buy my stuff',
    ts: 123,
    nivel: 900,
    anuncioChat: { nome: 'Rattata', preco: 5 },
  });
  inspector.recordReceived({ t: 'amigos', lista: [{ nick: 'Friend', nivel: 5 }] });
  inspector.recordReceived({ t: 'batalha', ev: [{ k: 'ataque', por: 'jogador', golpe: 'Tackle' }] });
  const { samples } = inspector.dump();
  const chat = JSON.stringify(samples.chat);
  assert.ok(!chat.includes('SomePlayer') && !chat.includes('hello there') && !chat.includes('Rattata'));
  assert.deepEqual((samples.chat?.[0] as Record<string, unknown>)['ts'], 123); // numbers and structure survive
  assert.ok(!JSON.stringify(samples.amigos).includes('Friend'));
  assert.ok(JSON.stringify(samples.batalha).includes('Tackle')); // game data that is not about people is kept
});

test('the list of social packet types can be changed', () => {
  const inspector = new Inspector({ socialTypePrefixes: ['secret.'] });
  inspector.recordReceived({ t: 'secret.thing', note: 'private words' });
  inspector.recordReceived({ t: 'chat', texto: 'now visible' });
  const { samples } = inspector.dump();
  assert.ok(!JSON.stringify(samples['secret.thing']).includes('private words'));
  assert.ok(JSON.stringify(samples.chat).includes('now visible'));
});

test('the account id is masked by path, and other ids are kept', () => {
  const inspector = new Inspector();
  inspector.recordReceived({ t: 'welcome', estado: { id: 123456, level: 7 }, hunts: [{ id: 5 }] });
  const sample = inspector.dump().samples.welcome?.[0] as { estado: Record<string, unknown>; hunts: Array<Record<string, unknown>> };
  assert.equal(sample.estado['id'], '[redacted]');
  assert.equal(sample.estado['level'], 7);
  assert.equal(sample.hunts[0]?.['id'], 5);
});

test('battle events are sampled: game-only kinds keep their text, kinds that can mention people are masked', () => {
  const inspector = new Inspector({ maxSamplesPerType: 2 });
  for (let i = 0; i < 4; i++) inspector.recordBattleEvent('venda', { k: 'venda', nome: 'Charmander', ganho: 100 + i });
  inspector.recordBattleEvent('amigoPedidoRecebido', { k: 'amigoPedidoRecebido', de: 'SomePlayer', nick: 'x', n: 3 });
  const { battleEventSamples } = inspector.dump();
  assert.deepEqual(battleEventSamples.venda, [
    { k: 'venda', nome: 'Charmander', ganho: 100 },
    { k: 'venda', nome: 'Charmander', ganho: 101 },
  ]);
  assert.deepEqual(battleEventSamples.amigoPedidoRecebido, [{ k: '[text]', de: '[text]', nick: '[redacted]', n: 3 }]);
});

test('aggregate event policy preserves truncation and masks malformed event text', () => {
  const inspector = new Inspector({ redact: { maxArrayItems: 1 } });
  inspector.recordReceived({ t: 'batalha', ev: [{ texto: 'PrivateWords' }, { k: 'guildCriada', nome: 'PrivateGuild' }] });
  const sample = inspector.dump().samples.batalha?.[0] as { ev: unknown[] };
  assert.deepEqual(sample.ev, [{ texto: '[text]' }, '…+1']);
  const shallow = new Inspector({ redact: { maxDepth: 0 } });
  assert.doesNotThrow(() => shallow.recordReceived({ t: 'batalha', ev: [] }));
});

test('the same per-event masking applies inside the batalha sample as in battleEventSamples', () => {
  const inspector = new Inspector();
  const packet = {
    t: 'batalha',
    ev: [
      { k: 'guildCriada', nome: 'Secret Guild Name' },
      { k: 'ataque', nome: 'Tackle' },
    ],
  };
  inspector.recordReceived(packet);
  for (const event of packet.ev) inspector.recordBattleEvent(event.k, event);
  const dump = inspector.dump();
  assert.equal(JSON.stringify(dump).includes('Secret Guild Name'), false);
  const events = (dump.samples['batalha'] as Array<{ ev: Array<{ k: string; nome: string }> }>)[0]?.ev;
  assert.equal(events?.[0]?.nome, TEXT_MASK);
  assert.equal(events?.[1]?.nome, 'Tackle'); // a game-only event keeps its text
});

test('counts-only never retains payloads or unknown names, including type, event and ignored-reason canaries', () => {
  const inspector = new Inspector({
    mode: 'counts-only',
    maxTypes: 256,
    maxSamplesPerType: 100,
    socialTypePrefixes: [],
    maskedPaths: [],
    redact: { maskStrings: false },
  });
  const canary = 'synthetic-private-canary';
  inspector.recordReceived({ t: 'welcome', token: canary, arbitrary: { [canary]: canary } });
  inspector.recordReceived({ t: 'chat', texto: canary, de: canary });
  inspector.recordSent({ t: 'ping', token: canary });
  inspector.recordSent({ t: 'mg.palpite', texto: canary });
  inspector.recordBattleEvent('ataque', { k: 'ataque', texto: canary });
  inspector.recordIgnored('oversized');
  inspector.recordIgnored('not-a-packet');
  for (let i = 0; i < 2000; i++) {
    const name = `${canary}-${i}`;
    inspector.recordReceived({ t: name, token: canary });
    inspector.recordSent({ t: name });
    inspector.recordBattleEvent(name, { k: name, texto: canary });
    inspector.recordIgnored(name as never); // A JavaScript caller can bypass the reason union.
  }
  const dump = inspector.dump();
  assert.deepEqual(dump.received, { welcome: 1, chat: 1, '(unknown)': 2000 });
  assert.deepEqual(dump.sent, { ping: 1, 'mg.palpite': 1, '(unknown)': 2000 });
  assert.deepEqual(dump.battleEvents, { ataque: 1, '(unknown)': 2000 });
  assert.deepEqual(dump.ignored, { oversized: 1, 'not-a-packet': 1, '(unknown)': 2000 });
  assert.deepEqual(dump.samples, {});
  assert.deepEqual(dump.battleEventSamples, {});
  assert.deepEqual(dump.unknownTypes, ['(unknown)']);
  assert.deepEqual(dump.unknownSentTypes, ['(unknown)']);
  assert.deepEqual(dump.unknownBattleEvents, ['(unknown)']);
  assert.equal(JSON.stringify(dump).includes(canary), false);
});

test('counts-only does not traverse payloads and classifies a packet type from a single read', () => {
  const inspector = new Inspector({ mode: 'counts-only', maxSamplesPerType: 100 });
  let reads = 0;
  const payload = {
    get secret() {
      throw new Error('a counts-only inspector must not read payload fields');
    },
  };
  inspector.recordReceived({
    get t() {
      return ++reads === 1 ? 'pong' : 'synthetic-private-name';
    },
    get token() {
      return payload.secret;
    },
  });
  inspector.recordBattleEvent('ataque', payload);
  assert.equal(reads, 1);
  assert.deepEqual(inspector.dump().received, { pong: 1 });
  assert.deepEqual(inspector.dump().battleEvents, { ataque: 1 });
});

test('counts-only requires an exact name in the matching registry, not a prefix or a name from another direction', () => {
  const inspector = new Inspector({ mode: 'counts-only' });
  inspector.recordReceived({ t: 'ping' });
  inspector.recordReceived({ t: `pong${'private'.repeat(20_000)}` });
  inspector.recordSent({ t: 'pong' });
  inspector.recordSent({ t: 'ping-private' });
  inspector.recordBattleEvent('ping');
  inspector.recordBattleEvent('ataque-private');
  inspector.recordIgnored('oversized-private' as never);
  const dump = inspector.dump();
  assert.deepEqual(dump.received, { '(unknown)': 2 });
  assert.deepEqual(dump.sent, { '(unknown)': 2 });
  assert.deepEqual(dump.battleEvents, { '(unknown)': 2 });
  assert.deepEqual(dump.ignored, { '(unknown)': 1 });
  assert.equal(JSON.stringify(dump).includes('private'), false);
});

test('counts-only preserves total counts with bounded series, including overflow and a zero-series limit', () => {
  for (const maxTypes of [0, 3, 256]) {
    const inspector = new Inspector({ mode: 'counts-only', maxTypes });
    for (const t of [...KNOWN_PACKET_TYPES, 'synthetic-private-name']) inspector.recordReceived({ t });
    for (const t of [...CLIENT_COMMAND_TYPES, 'synthetic-private-name']) inspector.recordSent({ t });
    for (const k of [...BATTLE_EVENT_KINDS, 'synthetic-private-name']) inspector.recordBattleEvent(k, { k });
    const dump = inspector.dump();
    for (const [counts, total] of [
      [dump.received, KNOWN_PACKET_TYPES.length + 1],
      [dump.sent, CLIENT_COMMAND_TYPES.length + 1],
      [dump.battleEvents, BATTLE_EVENT_KINDS.length + 1],
    ] as const) {
      assert.ok(Object.keys(counts).length <= maxTypes + 1);
      assert.equal(
        Object.values(counts).reduce((sum, count) => sum + count, 0),
        total,
      );
      assert.equal(Object.hasOwn(counts, '(other)'), maxTypes < 256);
    }
    assert.equal(JSON.stringify(dump).includes('synthetic-private-name'), false);
  }
});

test('reset preserves counts-only privacy and a dumped counter cannot mutate retained counters', () => {
  const inspector = new Inspector({ mode: 'counts-only' });
  inspector.recordReceived({ t: 'pong' });
  inspector.recordBattleEvent('ataque', { texto: 'synthetic-private-name' });
  inspector.recordIgnored('oversized');
  const dump = inspector.dump();
  dump.received['pong'] = 999;
  assert.equal(inspector.dump().received['pong'], 1);
  inspector.reset();
  assert.deepEqual(inspector.dump(), {
    received: {},
    sent: {},
    unknownTypes: [],
    samples: {},
    unknownSentTypes: [],
    battleEvents: {},
    battleEventSamples: {},
    unknownBattleEvents: [],
    ignored: {},
  });
  inspector.recordReceived({ t: 'synthetic-private-name', token: 'synthetic-token' });
  inspector.recordBattleEvent('synthetic-private-name', { token: 'synthetic-token' });
  assert.deepEqual(inspector.dump().received, { '(unknown)': 1 });
  assert.deepEqual(inspector.dump().samples, {});
  assert.deepEqual(inspector.dump().battleEventSamples, {});
});

test('invalid inspector modes and effective limits fail loudly instead of silently enabling samples or losing counts', () => {
  for (const mode of [null, '', 'counts', 7]) assert.throws(() => new Inspector({ mode: mode as never }), TypeError);
  for (const value of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.throws(() => new Inspector({ maxTypes: value as number }), RangeError);
    assert.throws(() => new Inspector({ maxSamplesPerType: value as number }), RangeError);
  }
  assert.doesNotThrow(() => new Inspector({ mode: 'counts-only', maxSamplesPerType: -1 }));
  assert.doesNotThrow(() => new Inspector({ mode: 'redacted-samples', maxTypes: 0, maxSamplesPerType: 0 }));
});

test('client counts-only integration records incoming drops and observed game commands, not SDK sends', () => {
  const bridge: { handlers?: TransportHandlers } = {};
  const inspector = new Inspector({ mode: 'counts-only', maxTypes: 256 });
  const client = new PokeIdleClient({
    inspector,
    maxPacketBytes: 512,
    transport: {
      readyState: 1,
      start(handlers: TransportHandlers) {
        bridge.handlers = handlers;
      },
      stop() {},
      send() {
        return true;
      },
    },
  });
  client.start();
  assert.equal(client.sendCommand({ t: 'ping' }), true);
  assert.deepEqual(inspector.dump().sent, {}, 'SDK sends deliberately bypass observation of the game client');
  const canary = 'synthetic-private-canary';
  bridge.handlers?.onOutgoing?.(JSON.stringify({ t: 'ping', token: canary }));
  bridge.handlers?.onMessage(JSON.stringify({ t: 'batalha', ev: [{ k: canary, texto: canary }] }));
  bridge.handlers?.onMessage(JSON.stringify({ t: canary, token: canary }));
  bridge.handlers?.onMessage('not-json');
  bridge.handlers?.onMessage('x'.repeat(513));
  const dump = inspector.dump();
  assert.deepEqual(dump.sent, { ping: 1 });
  assert.deepEqual(dump.received, { batalha: 1, '(unknown)': 1 });
  assert.deepEqual(dump.battleEvents, { '(unknown)': 1 });
  assert.deepEqual(dump.ignored, { 'not-a-packet': 1, oversized: 1 });
  assert.equal(JSON.stringify(dump).includes(canary), false);
  client.stop();
});
