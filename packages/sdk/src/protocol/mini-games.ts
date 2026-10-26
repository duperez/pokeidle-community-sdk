import type { Packet } from '../packets.js';
import type { StatsWire } from './wire.js';

// The Mini Games ride on the packet type `mg`, discriminated by `op`. The ops below were verified in recorded rounds;
// the others (`feed`, `hoje`, `acerto`, `quase`, `aviso`, `del`, `off`) carry the room's chat and the player's score and
// are delivered as generic `mg` packets.

export type MiniGameKind = 'zoom' | 'sombra' | 'dex' | 'intervalo';

export interface MiniGameStages {
  /** start of the round (server time, ms) */
  inicio?: number;
  /** when each clue stage starts */
  estagios?: number[];
  palpitesAte?: number;
  revelaAte?: number;
  fim?: number;
}

/** The clues revealed so far (cumulative). Which ones exist depends on the kind of round. */
export interface MiniGameClues {
  /** path of the clue image */
  img?: string;
  tipos?: string[];
  regiao?: string;
  stats?: StatsWire;
  cadeia?: { total?: number; posicao?: number };
  letra?: string;
  tamanho?: number;
}

export interface MiniGameRoundPacket extends Packet {
  readonly t: 'mg';
  readonly op: 'rodada';
  readonly agora?: number;
  readonly k?: number;
  readonly tipo?: MiniGameKind;
  readonly fases?: MiniGameStages;
  readonly vista?: MiniGameClues;
  readonly sala?: { id?: string; idioma?: string; n?: number };
}

export interface MiniGameStagePacket extends Packet {
  readonly t: 'mg';
  readonly op: 'fase';
  readonly agora?: number;
  readonly k?: number;
  readonly estagio?: number;
  readonly vista?: MiniGameClues;
}

export interface MiniGameRevealPacket extends Packet {
  readonly t: 'mg';
  readonly op: 'revela';
  readonly agora?: number;
  readonly k?: number;
  readonly resposta?: { pokeId?: number; nome?: string; looktype?: number; dex?: number };
  readonly acertaram?: number;
  readonly jogando?: number;
}

/** The full picture, sent when you join a round in progress. */
export interface MiniGameSnapshotPacket extends Packet {
  readonly t: 'mg';
  readonly op: 'estado';
  readonly k?: number;
  readonly tipo?: MiniGameKind;
  readonly fases?: MiniGameStages;
  readonly estagio?: number;
  readonly vista?: MiniGameClues;
  readonly sala?: { id?: string; idioma?: string; n?: number };
  readonly anterior?: { k?: number; revela?: MiniGameRevealPacket['resposta'] };
  readonly acertaram?: number;
  readonly jogando?: number;
}

/** Any other `mg` op: the room's chat and the player's score. */
export interface MiniGameOtherPacket extends Packet {
  readonly t: 'mg';
  readonly op: string;
  readonly k?: number;
}

export type MiniGamePacket = MiniGameRoundPacket | MiniGameStagePacket | MiniGameRevealPacket | MiniGameSnapshotPacket | MiniGameOtherPacket;
