import type { Packet } from '../packets.js';
import { BATTLE_EVENT_READS, type BATTLE_EVENT_KINDS } from './registry.generated.js';

// The events inside a `batalha` packet (`ev[]`). Each has a string `k` (its kind). Five kinds were verified in real
// traffic and have typed fields; all the others are known by name and by the field names the client reads from them,
// with values `unknown` until they are seen (see `coverage.ts`).

export type BattleEventKind = (typeof BATTLE_EVENT_KINDS)[number];

/** An event typed only from the field names the game's client reads: the values are `unknown`. */
export type ClientCodeEvent<K extends BattleEventKind> = { readonly k: K } & { readonly [F in (typeof BATTLE_EVENT_READS)[K][number]]?: unknown } & { readonly [field: string]: unknown };

export interface AttackEvent {
  readonly k: 'ataque';
  /** who attacked (seen: `jogador`) */
  readonly por?: string;
  readonly slot?: number;
  readonly golpe?: string;
  readonly tipo?: string;
  readonly dano?: number;
  /** type effectiveness multiplier */
  readonly ef?: number;
  readonly stab?: boolean;
  readonly hpAlvo?: number;
  readonly aoe?: boolean;
  readonly [field: string]: unknown;
}

export interface DeathEvent {
  readonly k: 'morte';
  /** who died (seen: `selvagem`) */
  readonly quem?: string;
  readonly slot?: number;
  readonly nome?: string;
  readonly xp?: number;
  readonly xpTreinador?: number;
  readonly xpPokemon?: number;
  readonly lootBoost?: boolean;
  readonly ouro?: number;
  readonly ouroLoot?: number;
  /** items dropped: the client reads `nome` and `itemId` from each */
  readonly drops?: Array<{ nome?: string; itemId?: number; [key: string]: unknown }>;
  readonly safari?: boolean;
  readonly [field: string]: unknown;
}

export interface BallEvent {
  readonly k: 'bola';
  readonly ballId?: number;
  readonly slot?: number;
  readonly sucesso?: boolean;
  /** the catch chance that was rolled */
  readonly chance?: number;
  readonly shiny?: boolean;
  readonly [field: string]: unknown;
}

/** The game confirming an NPC-shop purchase. Verified in real traffic; it arrives BEFORE the `estado` with the new count. */
export interface PurchaseEvent {
  readonly k: 'compra';
  /** the item or ball name as the shop shows it */
  readonly nome?: string;
  readonly qtd?: number;
  /** the gold it cost */
  readonly gasto?: number;
  readonly [field: string]: unknown;
}

export interface FledEvent {
  readonly k: 'fugiu';
  readonly nome?: string;
  readonly level?: number;
  readonly shiny?: boolean;
  readonly [field: string]: unknown;
}

export interface SpawnEvent {
  readonly k: 'spawn';
  readonly slot?: number;
  readonly speciesId?: number;
  readonly nome?: string;
  readonly looktype?: number;
  readonly level?: number;
  readonly hp?: number;
  readonly maxHp?: number;
  readonly tipos?: string[];
  readonly [field: string]: unknown;
}

/** Events with fields verified in real traffic. */
export interface TrafficBattleEvents {
  ataque: AttackEvent;
  morte: DeathEvent;
  bola: BallEvent;
  fugiu: FledEvent;
  spawn: SpawnEvent;
  compra: PurchaseEvent;
}

/** Every battle event kind, mapped to its event type. */
export type BattleEventMap = {
  [K in BattleEventKind]: K extends keyof TrafficBattleEvents ? TrafficBattleEvents[K] : ClientCodeEvent<K>;
};

/** Any battle event: switch on `k` to narrow it. */
export type BattleEvent = BattleEventMap[BattleEventKind];

export interface BattlePacket extends Packet {
  readonly t: 'batalha';
  readonly ev?: BattleEvent[];
}

const TRAFFIC_EVENTS = ['ataque', 'morte', 'bola', 'fugiu', 'spawn', 'compra'] as const satisfies ReadonlyArray<keyof TrafficBattleEvents>;
const TRAFFIC_EVENT_SET = new Set<string>(TRAFFIC_EVENTS);

// Compile-time proof that the list above is exactly the set of verified event types.
type SameKeys<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const trafficEventsMatchTypes: SameKeys<(typeof TRAFFIC_EVENTS)[number], keyof TrafficBattleEvents> = true;
void trafficEventsMatchTypes;

/** `traffic` for the six kinds verified in real traffic, `client-code` for all the others. */
export const battleEventCoverage = (kind: BattleEventKind): 'traffic' | 'client-code' => (TRAFFIC_EVENT_SET.has(kind) ? 'traffic' : 'client-code');
