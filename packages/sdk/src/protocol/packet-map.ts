import type { Packet } from '../packets.js';
import type { BattlePacket } from './events.js';
import type { MiniGamePacket } from './mini-games.js';
import type { SERVER_PACKET_READS, SERVER_PACKET_TYPES } from './registry.generated.js';
import type {
  BlocklistPacket,
  ChatDeletedPacket,
  ChatHistoryPacket,
  ChatPacket,
  ChatPinnedListPacket,
  ChatPinnedPacket,
  ChatStoppedPacket,
  FieldInitPacket,
  FieldPacket,
  FriendsPacket,
  GuildPacket,
  MarketPacket,
  RaidPacket,
  RankingCardPacket,
  ShinyCapturePacket,
  StatePacket,
  WelcomePacket,
} from './wire.js';

export type ServerPacketType = (typeof SERVER_PACKET_TYPES)[number];

/** A packet typed only from the field names the game's client reads: the values are `unknown`. */
export type ClientCodePacket<T extends ServerPacketType> = Packet & { readonly t: T } & {
  readonly [F in (typeof SERVER_PACKET_READS)[T][number]]?: unknown;
};

/** Packets whose fields were verified in real traffic. */
export interface TrafficPackets {
  welcome: WelcomePacket;
  estado: StatePacket;
  batalha: BattlePacket;
  campo: FieldPacket;
  'campo.init': FieldInitPacket;
  chat: ChatPacket;
  'chat.historico': ChatHistoryPacket;
  'chat.fixadas': ChatPinnedListPacket;
  'chat.fixada': ChatPinnedPacket;
  'chat.del': ChatDeletedPacket;
  'chat.interrompido': ChatStoppedPacket;
  amigos: FriendsPacket;
  bloqueios: BlocklistPacket;
  market: MarketPacket;
  'ranking.ficha': RankingCardPacket;
  'shiny.captura': ShinyCapturePacket;
  raid: RaidPacket;
  guild: GuildPacket;
  mg: MiniGamePacket;
  pong: Packet & { readonly t: 'pong' };
}

/** Small packets typed from how the client uses them (not seen with a payload in our traffic yet). */
export interface ClientCodeTypedPackets {
  vivo: Packet & { readonly t: 'vivo' };
  /** Sent when the server renews the session; the client stores the new token. */
  'sessao.renovada': Packet & { readonly t: 'sessao.renovada'; readonly token?: string };
  /** The server refused or failed something. `chave` is a translation key, `params` fill it in. */
  erro: Packet & {
    readonly t: 'erro';
    readonly chave?: string;
    readonly msg?: string;
    readonly params?: Record<string, unknown>;
    readonly motivoBan?: unknown;
  };
}

type HandWritten = TrafficPackets & ClientCodeTypedPackets;

// Compile-time check: a hand-written type for a packet the registry no longer has is an error.
const handWrittenAreRealTypes: [keyof HandWritten] extends [ServerPacketType] ? true : false = true;
void handWrittenAreRealTypes;

/** Every packet type the game's client handles, mapped to its type. Switch on `t` to narrow a packet. */
export type PacketMap = { [K in ServerPacketType]: K extends keyof HandWritten ? HandWritten[K] : ClientCodePacket<K> };

/** Any packet the game's client handles. */
export type ServerPacket = PacketMap[ServerPacketType];

/**
 * How well each packet type is known:
 * - `traffic`: the fields were verified in real traffic (values are typed, every field is optional).
 * - `client-code`: only the field names the client reads are known; values are `unknown` until seen.
 */
export type Coverage = 'traffic' | 'client-code';

/** Exhaustive on purpose: a packet type the game adds fails to compile here until someone classifies it. */
export const PACKET_COVERAGE = {
  welcome: 'traffic',
  estado: 'traffic',
  batalha: 'traffic',
  campo: 'traffic',
  'campo.init': 'traffic',
  chat: 'traffic',
  'chat.historico': 'traffic',
  'chat.fixadas': 'traffic',
  'chat.fixada': 'traffic',
  'chat.del': 'traffic',
  'chat.interrompido': 'traffic',
  amigos: 'traffic',
  bloqueios: 'traffic',
  market: 'traffic',
  'ranking.ficha': 'traffic',
  'shiny.captura': 'traffic',
  raid: 'traffic',
  guild: 'traffic',
  mg: 'traffic',
  pong: 'traffic',
  vivo: 'client-code',
  'sessao.renovada': 'client-code',
  erro: 'client-code',
  'bicicletas.lista': 'client-code',
  campeonato: 'client-code',
  'casas.lista': 'client-code',
  'chat.aviso': 'client-code',
  'chat.mute': 'client-code',
  comercio: 'client-code',
  convite: 'client-code',
  csv: 'client-code',
  'drop.raro': 'client-code',
  economia: 'client-code',
  estatisticas: 'client-code',
  ginasio: 'client-code',
  'lendario.captura': 'client-code',
  'mercado.favPreco': 'client-code',
  oferenda: 'client-code',
  orbs: 'client-code',
  'p5.lista': 'client-code',
  passe: 'client-code',
  perfil: 'client-code',
  'perfil.sobre': 'client-code',
  pvp: 'client-code',
  raidFichas: 'client-code',
  ranking: 'client-code',
  'shiny.lista': 'client-code',
  showdown: 'client-code',
  ticket: 'client-code',
  topCatch: 'client-code',
  treino: 'client-code',
} as const satisfies Record<ServerPacketType, Coverage>;

// Compile-time proof that `PACKET_COVERAGE` and the hand-written types agree: every `traffic` entry has a verified type and vice versa.
type TrafficKeys = { [K in ServerPacketType]: (typeof PACKET_COVERAGE)[K] extends 'traffic' ? K : never }[ServerPacketType];
type SameKeys<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const coverageMatchesTypes: SameKeys<TrafficKeys, keyof TrafficPackets> = true;
void coverageMatchesTypes;
