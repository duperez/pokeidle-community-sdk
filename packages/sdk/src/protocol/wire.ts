import type { Packet } from '../packets.js';

// Raw shapes of the packets, exactly as the game sends them (the field names are the game's own). They describe what was
// verified against real traffic; every field is optional because the server can change or omit anything. Prefer the
// normalized view in `GameState` (English names, defensive reading) and use these types when you need the raw packet.

export interface BallCatalogEntryWire {
  id?: number;
  nome?: string;
  catchRate?: number;
  priceGold?: number;
  compravel?: boolean;
}

export interface ShopItemWire {
  itemId?: number;
  preco?: number;
  nome?: string;
}

export interface HuntWire {
  slug?: string;
  nome?: string;
  area?: string;
  nivel?: number;
  especies?: unknown[];
  totalSpawns?: number;
}

export interface AutomationWire {
  ballIds?: number[];
  reviveIds?: number[];
  potionIds?: number[];
  [key: string]: unknown;
}

/** The player's state. In `welcome` it is complete (`cheio: true`); in `estado` it is a delta with only what changed. */
export interface PlayerStateWire {
  cheio?: boolean;
  id?: number;
  nick?: string;
  level?: number;
  xp?: number;
  gold?: number;
  diamonds?: number;
  orbs?: number;
  huntSlug?: string;
  noCentro?: boolean;
  servidorAgora?: number;
  /** item id -> quantity (keys are numeric strings) */
  items?: Record<string, number>;
  /** ball id -> quantity */
  balls?: Record<string, number>;
  automation?: AutomationWire;
  /** Full list (welcome) of the player's pokémon. */
  pokemons?: Array<{ id?: number | string; [key: string]: unknown }>;
  /** Delta: pokémon that changed or appeared / ids that left. */
  pkMud?: Array<{ id?: number | string; [key: string]: unknown }>;
  pkFora?: Array<number | string>;
  /** Delta of the pokédex: entries that changed / keys that left. */
  dexMud?: Record<string, unknown>;
  dexFora?: string[];
  pokedex?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WelcomePacket extends Packet {
  readonly t: 'welcome';
  readonly estado?: PlayerStateWire;
  readonly hunts?: HuntWire[];
  readonly catalogoBolas?: BallCatalogEntryWire[];
  readonly itensCompraveis?: ShopItemWire[];
}

export interface StatePacket extends Packet {
  readonly t: 'estado';
  readonly estado?: PlayerStateWire;
}

/** The packet types with a verified shape. Others are delivered as a plain `Packet`. */
export interface PacketMap {
  welcome: WelcomePacket;
  estado: StatePacket;
}
