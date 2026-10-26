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
