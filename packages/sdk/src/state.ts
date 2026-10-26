import { ballInfo, itemInfo } from './catalog/index.js';
import type { Packet } from './packets.js';
import type { PlayerStateWire, ShopItemWire, BallCatalogEntryWire } from './protocol/wire.js';

/** The player's state after applying the welcome packet and every update since. Field names are the game's own. */
export type PlayerState = PlayerStateWire & { pokemons: Array<{ id?: number | string; [key: string]: unknown }> };

/** A ball as the server describes it in the welcome packet. */
export interface BallEntry {
  id: number;
  name: string;
  catchRate: number | null;
  priceGold: number | null;
  buyable: boolean;
}

/** An item the shop sells, as the server describes it in the welcome packet. */
export interface ShopEntry {
  itemId: number;
  name: string;
  price: number | null;
}

const MAX_LIST = 500;
/** Keys that must never be copied from server data into our objects (they would change an object's prototype). */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const idKey = (id: unknown): string => String(id);

/** A copy of a record without the unsafe keys. Plain `Object.assign` would trigger the `__proto__` setter. */
function safeCopy(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) if (!UNSAFE_KEYS.has(key)) out[key] = value;
  return out;
}
/** `items` and `balls` are maps of id to quantity: copied so a listener that changes the packet cannot corrupt the state. */
const ownMaps = (fields: Record<string, unknown>): Record<string, unknown> => {
  for (const key of ['items', 'balls']) if (isObject(fields[key])) fields[key] = safeCopy(fields[key] as Record<string, unknown>);
  return fields;
};
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asText = (v: unknown, max = 60): string | null => (typeof v === 'string' ? v.slice(0, max) : null);
const rowsWithId = (v: unknown): Array<{ id?: number | string; [key: string]: unknown }> =>
  Array.isArray(v) ? v.filter((k): k is { id: number | string } => isObject(k) && k['id'] != null) : [];

/**
 * Keeps the player's state up to date. The game sends the whole state once (`welcome`, marked `cheio`) and then small
 * updates (`estado`); this class applies both so you can just read `state.gold`, `state.itemCount(Item.Revive)`, etc.
 * Anything malformed is ignored instead of throwing: the server's format can change without notice.
 */
export class GameState {
  private fields: Record<string, unknown> | null = null;
  /** Keyed by the id as text, so `11` and `"11"` are the same pokémon. */
  private pokemonById = new Map<string, { id?: number | string; [key: string]: unknown }>();
  private balls: BallEntry[] = [];
  private shop: ShopEntry[] = [];
  private readonly listeners = new Set<() => void>();

  /** The ball catalog from the last welcome packet. */
  get ballCatalog(): readonly BallEntry[] {
    return this.balls;
  }

  /** The items the shop sells, from the last welcome packet. */
  get shopItems(): readonly ShopEntry[] {
    return this.shop;
  }

  /**
   * Everything known about the player, or `null` before the first welcome. Treat it as read-only: it is a snapshot,
   * and changing it does not change the SDK's state.
   */
  get player(): PlayerState | null {
    return this.fields ? ({ ...this.fields, pokemons: [...this.pokemonById.values()] } as PlayerState) : null;
  }

  get nick(): string | null { return asText(this.fields?.['nick']); }
  get level(): number | null { return asNumber(this.fields?.['level']); }
  get xp(): number | null { return asNumber(this.fields?.['xp']); }
  get gold(): number | null { return asNumber(this.fields?.['gold']); }
  get diamonds(): number | null { return asNumber(this.fields?.['diamonds']); }
  get orbs(): number | null { return asNumber(this.fields?.['orbs']); }
  get huntSlug(): string | null { return asText(this.fields?.['huntSlug']); }

  /** How many of an item the player has (0 if none or unknown). Use the `Item` enum for the id. */
  itemCount(id: number): number {
    return count(this.fields?.['items'], id);
  }

  /** How many of a ball the player has. Use the `Ball` enum for the id. */
  ballCount(id: number): number {
    return count(this.fields?.['balls'], id);
  }

  /** Name of an item or ball id, from the server's catalogs and the SDK's own. */
  itemName(id: number): string | null {
    return this.shop.find((s) => s.itemId === id)?.name ?? itemInfo(id)?.name ?? null;
  }

  ballName(id: number): string | null {
    return this.balls.find((b) => b.id === id)?.name ?? ballInfo(id)?.name ?? null;
  }

  /** Called after every change. Returns a function that stops listening. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Feed it every incoming packet: it picks the ones it understands. */
  applyPacket(packet: Packet): void {
    if (packet.t === 'welcome') {
      this.readCatalogs(packet);
      this.merge(packet['estado'], true);
    } else if (packet.t === 'estado') {
      this.merge(packet['estado'], false);
    }
  }

  private readCatalogs(packet: Packet): void {
    const balls = packet['catalogoBolas'];
    if (Array.isArray(balls)) {
      this.balls = balls.slice(0, MAX_LIST).filter(isObject).flatMap((b: BallCatalogEntryWire) => {
        const id = asNumber(b.id);
        return id === null ? [] : [{ id, name: asText(b.nome, 40) ?? `Ball ${id}`, catchRate: asNumber(b.catchRate), priceGold: asNumber(b.priceGold), buyable: b.compravel === true }];
      });
    }
    const shop = packet['itensCompraveis'];
    if (Array.isArray(shop)) {
      this.shop = shop.slice(0, MAX_LIST).filter(isObject).flatMap((s: ShopItemWire) => {
        const itemId = asNumber(s.itemId);
        return itemId === null ? [] : [{ itemId, name: asText(s.nome, 60) ?? `Item ${itemId}`, price: asNumber(s.preco) }];
      });
    }
  }

  /**
   * Merges a full state or a delta. A full state starts over; a delta arriving first also becomes the base. Top-level
   * fields of a delta replace the old ones as a whole: `items` and `balls` are treated as complete maps, which is how the
   * game's own client has always read them (not verified against every packet the server can send).
   */
  private merge(partial: unknown, full: boolean): void {
    if (!isObject(partial)) return;
    const { cheio, pokemons, pkMud, pkFora, dexMud, dexFora, ...rest } = safeCopy(partial);
    const known = (list: unknown): Array<[string, { id?: number | string; [key: string]: unknown }]> => rowsWithId(list).map((k) => [idKey(k.id), k]);
    if (full || cheio === true || !this.fields) {
      this.fields = ownMaps({ ...rest });
      this.pokemonById = new Map(known(pokemons));
    } else {
      Object.assign(this.fields, ownMaps(rest)); // `rest` has no unsafe keys, so no setter can run
      // A complete list outside a full state replaces the collection instead of adding to it.
      if (Array.isArray(pokemons)) this.pokemonById = new Map(known(pokemons));
    }
    for (const [key, row] of known(pkMud)) this.pokemonById.set(key, row);
    if (Array.isArray(pkFora)) for (const id of pkFora) this.pokemonById.delete(idKey(id));
    if (dexMud !== undefined || dexFora !== undefined) {
      const dex: Record<string, unknown> = { ...safeCopy(isObject(this.fields['pokedex']) ? this.fields['pokedex'] : {}), ...safeCopy(isObject(dexMud) ? dexMud : {}) };
      if (Array.isArray(dexFora)) for (const key of dexFora) delete dex[String(key)];
      this.fields['pokedex'] = dex;
    }
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('[pokeidle-community-sdk] state listener failed', error);
      }
    }
  }
}

function count(map: unknown, id: number): number {
  if (!isObject(map)) return 0;
  const value = map[String(id)];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
