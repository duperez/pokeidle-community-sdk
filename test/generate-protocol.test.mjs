import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { extractProtocol, fieldsRead, renderRegistry, stripComments } from '../scripts/generate-protocol.mjs';

test('fieldsRead reads `param.x`, `param?.x` and destructuring, and never treats a letter as a dot', () => {
  const code = 'const a = m.alpha; const b = m?.beta; const { gamma, delta: d } = m; mesclar(x); const c = em.nope; const t = m.t;';
  assert.deepEqual([...fieldsRead(code, 'm')].sort(), ['alpha', 'beta', 'delta', 'gamma']); // `mesclar` and `em.nope` are not `m.` reads
});

test('stripComments removes // and /* */ comments but keeps strings', () => {
  const out = stripComments("const a = 'x // not a comment'; // a comment with m.fake\n/* block m.fake2 */ const b = m.real;");
  assert.ok(!out.includes('fake'));
  assert.ok(out.includes("'x // not a comment'"));
  assert.ok(out.includes('m.real'));
});

const LOW = { server: 0, events: 0, commands: 0 };
const CLIENT = `
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  // prose in a comment: m.shouldNotCount
  if (m.t === 'pong') return;
  if (m.t === 'welcome') { guardar(m.estado); }
  else if (m.t === 'batalha') for (const e of m.ev) aoEvento(e);
  else if (m.t === 'amigos') aoReceberAmigos(m);
  else if (m.t === 'erro') { toast(m.msg); }
};
ws.onclose = () => {};
function aoReceberAmigos(p) { return p.lista + p.max + p?.pedidos; }
function aoEvento(e) {
  switch (e.k) {
    case 'ataque':
      f(e.golpe, e.dano);
      break;
    case 'morte':
    case 'fugiu':
      g(e.nome);
      break;
  }
}
function pedir() { enviar({ t: 'shop.buy', kind: 'ball' }); mandar({ t: 'ping' }); }
`;

test('extractProtocol finds packet types, the fields the client reads, battle events and commands', () => {
  const { server, events, commands } = extractProtocol(CLIENT, { minimums: LOW });
  assert.deepEqual([...server.keys()].sort(), ['amigos', 'batalha', 'erro', 'pong', 'welcome']);
  assert.deepEqual([...server.get('amigos')].sort(), ['lista', 'max', 'pedidos']); // read inside the handler function
  assert.deepEqual([...server.get('erro')], ['msg']); // read inline
  assert.deepEqual([...server.get('welcome')], ['estado']);
  assert.deepEqual([...events.keys()].sort(), ['ataque', 'fugiu', 'morte']);
  assert.deepEqual([...events.get('ataque')].sort(), ['dano', 'golpe']);
  assert.deepEqual([...events.get('fugiu')], ['nome']); // `case 'morte': case 'fugiu':` share one body
  assert.deepEqual([...commands].sort(), ['ping', 'shop.buy']);
});

test('extractProtocol fails loudly when the client changes shape, instead of generating an empty registry', () => {
  assert.throws(() => extractProtocol('nothing useful here'), /onmessage/);
});

test('renderRegistry produces a TypeScript file with the four lists', () => {
  const text = renderRegistry(extractProtocol(CLIENT, { minimums: LOW }), 'app.js?v=1');
  assert.ok(text.includes('// Client version: app.js?v=1'));
  for (const name of ['SERVER_PACKET_TYPES', 'BATTLE_EVENT_KINDS', 'CLIENT_COMMAND_TYPES', 'SERVER_PACKET_READS', 'BATTLE_EVENT_READS'])
    assert.ok(text.includes(name), name);
  assert.ok(text.includes("'amigos': ['lista', 'max', 'pedidos']"));
});

test('compact generated names preserve exact sorted identifiers, empty suffixes and empty lists', () => {
  const commands = new Set(['guild.beta', 'guild', 'guild.alpha', 'guild.deep.inner', 'ping']);
  const registry = { server: new Map(), events: new Map([['event', new Set()]]), commands };
  const output = transformSync(renderRegistry(registry), { loader: 'ts', format: 'cjs' }).code;
  const context = vm.createContext({ module: { exports: {} } });
  vm.runInContext(output, context);
  const actual = context.module.exports;
  assert.deepEqual(JSON.parse(JSON.stringify(actual.CLIENT_COMMAND_TYPES)), [...commands].sort());
  assert.deepEqual(JSON.parse(JSON.stringify(actual.SERVER_PACKET_TYPES)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(actual.BATTLE_EVENT_KINDS)), ['event']);
  assert.equal(Object.isFrozen(actual.CLIENT_COMMAND_TYPES), true);
});

test('the extraction fails instead of writing a shrunken registry when it finds too little', () => {
  assert.throws(() => extractProtocol(CLIENT), /found too little/);
});

test('commands built dynamically are found: ternaries, spread objects and request tables', () => {
  const source = CLIENT.replace(
    'function pedir()',
    `function pedir() { enviar({ ...extra, t: 'csv.pedir', tipo }); mandar({ t: ok ? 'showdown.fita' : 'campeonato.fita' }); }
const MODOS = { a: { msg: 'market.historico' }, b: { mensagem: 'showdown.equipe' } };
function pedir2()`,
  );
  const { commands } = extractProtocol(source, { minimums: LOW });
  for (const name of ['csv.pedir', 'showdown.fita', 'campeonato.fita', 'market.historico', 'showdown.equipe', 'shop.buy'])
    assert.ok(commands.has(name), name);
});

test('a handler only counts when it receives the packet itself (m), not another object', () => {
  const source = `
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.t === 'campo.init') { aplicarHeroiAtivo(estado.eu); desenhar(m); }
  else if (m.t === 'batalha') for (const e of m.ev) aoEvento(e);
};
ws.onclose = () => {};
function aplicarHeroiAtivo(e) { return e.activeId + e.pokemons; }
function desenhar(p) { return p.slug + p.mobs; }
function aoEvento(e) { switch (e.k) { case 'ataque': f(e.golpe); break; } }
`;
  const { server } = extractProtocol(source, { minimums: LOW });
  assert.deepEqual([...server.get('campo.init')].sort(), ['mobs', 'slug']); // not activeId / pokemons
  assert.deepEqual([...server.get('batalha')], ['ev']); // not the event's own fields
});
