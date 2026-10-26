import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PokeIdleClient,
  type BattlePacket,
  type ChatPacket,
  type FieldInitPacket,
  type FieldPacket,
  type MarketPacket,
  type MiniGamePacket,
  type StatePacket,
  type Transport,
  type TransportHandlers,
  type WelcomePacket,
} from '../src/index.js';

// Samples with the SHAPE of real traffic and INVENTED values. The `satisfies` clauses make the compiler check that the
// types accept a real-looking packet: if a type is too narrow, this file stops compiling.

const welcome = {
  t: 'welcome',
  admin: false,
  estado: {
    cheio: true,
    id: 1,
    nick: 'TestPlayer',
    level: 10,
    gold: 100,
    diamonds: 0,
    orbs: 1,
    huntSlug: 'some_hunt',
    noCentro: false,
    centro: null,
    items: { '200': 3 },
    balls: { '1': 5 },
    pokemons: [
      {
        id: 1,
        speciesId: 9,
        nome: 'Blastoise',
        tipos: ['WATER'],
        level: 50,
        stats: { hp: 1, atk: 2, def: 3, spAtk: 4, spDef: 5, speed: 6 },
        ivs: { hp: 1 },
        shiny: false,
        heldItemId: null,
      },
    ],
    automation: { ballIds: [1, 5], autoRevive: true, reviveIds: [205], potionIds: [201], hpLimiar: 0.8 },
    loja: { vip: true, vipAte: 5, boosts: { xp: 1 } },
  },
  catalogoBolas: [{ id: 1, nome: 'Poke Ball', catchRate: 1, priceGold: 5, compravel: true }],
  itensCompraveis: [{ itemId: 70091, preco: 20, nome: 'Mystery Egg P2' }],
  itensNossos: [{ id: 70010, name: 'Escape Rope', icon: '/x.png', category: 'key-item', rare: false, npcPrice: 0 }],
  hunts: [
    {
      slug: 'caterpie',
      nome: 'Caterpie',
      area: 'kanto',
      nivel: 1,
      especies: [{ pokeId: 10, nome: 'Caterpie', pontos: 15 }],
      totalSpawns: 15,
    },
  ],
  tabelaTipos: { FIRE: { WATER: 0.5, GRASS: 2 } },
  economia: {
    taxaMercadoOrbPct: 13,
    faixasMercadoOrb: [
      { ate: 500, pct: 13 },
      { ate: null, pct: 7.5 },
    ],
  },
} satisfies WelcomePacket;

const stateUpdate = {
  t: 'estado',
  estado: { xp: 5, gold: 6, servidorAgora: 7, dexMud: { '2033': { k: 1, c: 2 } }, pkMud: [{ id: 1, nome: 'Blastoise', hp: 5, maxHp: 9 }] },
} satisfies StatePacket;

const battle = {
  t: 'batalha',
  ev: [
    { k: 'ataque', por: 'jogador', slot: 1, golpe: 'Tackle', tipo: 'NORMAL', dano: 5, ef: 1, stab: false, hpAlvo: 0, aoe: false },
    {
      k: 'morte',
      quem: 'selvagem',
      slot: 1,
      nome: 'Rattata',
      xp: 5,
      xpTreinador: 6,
      xpPokemon: 7,
      lootBoost: false,
      ouro: 8,
      ouroLoot: 9,
      drops: [{ nome: 'Rat Tail', itemId: 3 }],
    },
    { k: 'bola', ballId: 2, slot: 1, sucesso: false, chance: 0.005, shiny: false },
    { k: 'fugiu', nome: 'Rattata', level: 3, shiny: false },
    { k: 'spawn', slot: 2, speciesId: 19, nome: 'Rattata', looktype: 19, level: 3, hp: 10, maxHp: 10, tipos: ['NORMAL'] },
    { k: 'compra', gasto: 260, nome: 'Ultra Ball', qtd: 2 },
  ],
} satisfies BattlePacket;

const field = {
  t: 'campo',
  seq: 1,
  ts: 2,
  alvo: null,
  heroi: { c: 1, r: 2, dc: 1, dr: 2, d: 3, em: 4, ms: 260 },
  treinador: { c: 1, r: 2, d: 3, ms: 290 },
  mobs: [{ s: 5, c: 1, r: 2, hp: 3, mhp: 4, x: 0, lt: 401, n: 'Rattata', nv: 3, sh: 0 }],
  fora: [9],
} satisfies FieldPacket;
const fieldInit = {
  t: 'campo.init',
  slug: 'a',
  mapa: 'a',
  ts: 1,
  box: [-1, -2, 3, 4],
  groundZ: 6,
  heroi: { c: 1 },
  treinador: { c: 2, lt: 159, vs: [57, 121, 70, 41] },
  mobs: [],
  alvo: 5,
} satisfies FieldInitPacket;
const chat = {
  t: 'chat',
  id: 'x',
  canal: 'world',
  idioma: 'pt',
  de: 'SomePlayer',
  texto: 'hi',
  ts: 1,
  cargo: 'anuncio',
  nivel: 5,
  anuncioChat: {
    id: 1,
    tipo: 'pokemon',
    qtd: 1,
    preco: 5,
    moeda: 'orb',
    itemId: null,
    numerado: false,
    nome: 'Rattata',
    level: 3,
    shiny: true,
  },
} satisfies ChatPacket;
const market = {
  t: 'market',
  aba: 'itens',
  medias: { '2': { gold: { media: 5, unidades: 1 }, orb: { media: 2, unidades: 3 } } },
} satisfies MarketPacket;
const round = {
  t: 'mg',
  op: 'rodada',
  agora: 1,
  k: 649,
  tipo: 'zoom',
  fases: { inicio: 1, estagios: [1, 2, 3, 4], palpitesAte: 5, revelaAte: 6, fim: 7 },
  vista: { img: '/mg/i/649/x.png' },
} satisfies MiniGamePacket;
const reveal = {
  t: 'mg',
  op: 'revela',
  agora: 1,
  k: 649,
  resposta: { pokeId: 769, nome: 'Sandygast', looktype: 60769, dex: 769 },
  acertaram: 86,
  jogando: 188,
} satisfies MiniGamePacket;

class FakeTransport implements Transport {
  handlers: TransportHandlers | null = null;
  sent: string[] = [];
  readyState = 1;
  start(handlers: TransportHandlers): void {
    this.handlers = handlers;
  }
  stop(): void {
    this.handlers = null;
  }
  send(text: string): boolean {
    this.sent.push(text);
    return true;
  }
}
const feed = (transport: FakeTransport, ...packets: object[]) => packets.forEach((p) => transport.handlers?.onMessage(JSON.stringify(p)));

test('real-shaped packets flow through the client and the state', () => {
  const transport = new FakeTransport();
  const client = new PokeIdleClient({ transport });
  client.start();
  const seen: string[] = [];
  client.on('campo', (p) => seen.push(`campo ${p.mobs?.[0]?.n}`));
  client.on('chat', (p) => seen.push(`chat ${p.anuncioChat?.moeda}`));
  client.on('market', (p) => seen.push(`market ${p.medias?.['2']?.orb?.media}`));
  client.on('mg', (p) => seen.push(`mg ${p.op}`));
  client.on('raidFichas', (p) => seen.push(`raidFichas ${typeof p.fichas}`)); // client-code level: a known field, value unknown
  feed(transport, welcome, stateUpdate, field, fieldInit, chat, market, round, reveal, { t: 'raidFichas', fichas: [] });
  assert.deepEqual(seen, ['campo Rattata', 'chat orb', 'market 2', 'mg rodada', 'mg revela', 'raidFichas object']);
  assert.equal(client.state.gold, 6);
  assert.equal(client.state.complete, true);
  assert.deepEqual(client.inspector?.dump().unknownTypes, []);
});

test('battle events are delivered one by one, typed by kind', () => {
  const transport = new FakeTransport();
  const client = new PokeIdleClient({ transport });
  client.start();
  const log: string[] = [];
  client.onBattleEvent('morte', (e) => log.push(`morte ${e.nome} +${e.ouro}`));
  client.onBattleEvent('bola', (e) => log.push(`bola ${e.ballId} ${e.sucesso}`));
  client.onBattleEvent('compra', (e) => log.push(`compra ${typeof e.gasto}`)); // client-code level
  client.onBattle((e) => log.push(`any ${e.k}`));
  feed(transport, battle);
  assert.deepEqual(
    log.filter((l) => !l.startsWith('any')),
    ['morte Rattata +8', 'bola 2 false', 'compra number'],
  );
  assert.deepEqual(
    log.filter((l) => l.startsWith('any')),
    ['any ataque', 'any morte', 'any bola', 'any fugiu', 'any spawn', 'any compra'],
  );
  assert.deepEqual(client.inspector?.dump().battleEvents, { ataque: 1, morte: 1, bola: 1, fugiu: 1, spawn: 1, compra: 1 });
});

test('malformed battle events are ignored and a throwing battle listener does not break the others', () => {
  const transport = new FakeTransport();
  const errors: unknown[] = [];
  const client = new PokeIdleClient({ transport, onError: (e) => errors.push(e) });
  client.start();
  const seen: string[] = [];
  client.onBattleEvent('morte', () => {
    throw new Error('boom');
  });
  client.onBattleEvent('morte', (e) => seen.push(e.k));
  feed(transport, { t: 'batalha', ev: [null, 5, 'x', { x: 1 }, { k: 7 }, { k: 'morte' }] }, { t: 'batalha', ev: 'nope' }, { t: 'batalha' });
  assert.deepEqual(seen, ['morte']);
  assert.equal(errors.length, 1);
});

test('the inspector flags what the game adds: packet types, battle events and commands', () => {
  const transport = new FakeTransport();
  const client = new PokeIdleClient({ transport });
  client.start();
  feed(transport, { t: 'a.brand.new.packet' }, { t: 'batalha', ev: [{ k: 'aBrandNewEvent' }, { k: 'morte' }] });
  transport.handlers?.onOutgoing?.(JSON.stringify({ t: 'shop.buy', kind: 'ball', id: 4, qty: 1 }));
  transport.handlers?.onOutgoing?.(JSON.stringify({ t: 'a.new.command' }));
  transport.handlers?.onOutgoing?.(JSON.stringify({ t: 'mg.palpite', k: 1, texto: 'x' }));
  const dump = client.inspector?.dump();
  assert.deepEqual(dump?.unknownTypes, ['a.brand.new.packet']);
  assert.deepEqual(dump?.unknownBattleEvents, ['aBrandNewEvent']);
  assert.deepEqual(dump?.unknownSentTypes, ['a.new.command']);
});

test('sendCommand sends the command as JSON through the transport', () => {
  const transport = new FakeTransport();
  const client = new PokeIdleClient({ transport });
  assert.equal(client.sendCommand({ t: 'shop.buy', kind: 'ball', id: 4, qty: 10 }), true);
  assert.equal(client.sendCommand({ t: 'market.comprar', id: 1, qtd: 1, preco: 5, moeda: 'gold' }, { confirmIrreversible: true }), true);
  assert.equal(client.sendCommand({ t: 'guild.info' }), true); // known by name only: a plain object
  assert.deepEqual(
    transport.sent.map((s) => (JSON.parse(s) as { t: string }).t),
    ['shop.buy', 'market.comprar', 'guild.info'],
  );
  assert.deepEqual(JSON.parse(transport.sent[0] ?? ''), { t: 'shop.buy', kind: 'ball', id: 4, qty: 10 });
  transport.readyState = 3;
  transport.send = () => false;
  assert.equal(client.sendCommand({ t: 'ping' }), false);
});
