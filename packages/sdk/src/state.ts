import { BALL_CATALOG } from './catalog/balls.generated.js';
import { NPC_SHOP_ITEMS } from './catalog/npc-shop.generated.js';
import { defaultErrorHandler, guarded, type ErrorHandler } from './errors.js';
import { asId, asNumber, asText, isObject } from './coerce.js';
import type { Packet } from './packets.js';
import { normalizePokemon, type Pokemon } from './pokemon.js';
import { deepFreeze } from './immutable.js';
import { normalizeAutomation, normalizeTwitch, type AutomationState, type TwitchState } from './player-details.js';
import type { PlayerStateWire, PokemonWire, ShopItemWire, BallCatalogEntryWire, ExtraItemWire } from './protocol/wire.js';

/** The player's state after applying the welcome packet and every update since. Field names are the game's own. */
export type PlayerState = PlayerStateWire & { pokemons: PokemonWire[] };

/** A ball as the server describes it in the welcome packet. */
export interface BallEntry {
  id: number;
  name: string;
  catchRate: number | null;
  priceGold: number | null;
  buyable: boolean;
}

/** An item that belongs to this game and is not in the public items catalog, as the server describes it in the welcome packet. */
export interface ExtraItemEntry {
  id: number;
  name: string;
  category: string;
  rare: boolean;
  npcPrice: number | null;
}

/** An item the shop sells, as the server describes it in the welcome packet. */
export interface ShopEntry {
  itemId: number;
  name: string;
  price: number | null;
}

const MAX_LIST = 2000;
/** Keys that must never be copied from server data into our objects (they would change an object's prototype). */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const idKey = (id: unknown): string => String(id);

/** A copy of a record without the unsafe keys. Plain `Object.assign` would trigger the `__proto__` setter. */
function safeCopy(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) if (!UNSAFE_KEYS.has(key)) out[key] = value;
  return out;
}
/** A private, frozen copy: neither a listener that holds the packet nor whoever reads `state.player` can change it. */
const frozenCopy = <T>(value: T): T => deepFreeze(structuredClone(value));

const rowsWithId = (v: unknown): PokemonWire[] =>
  Array.isArray(v) ? v.filter((k): k is PokemonWire => isObject(k) && asId(k['id']) !== null) : [];

/**
 * Keeps the player's state up to date. The game sends the whole state once (`welcome`, marked `cheio`) and then small
 * updates (`estado`); this class applies both so you can just read `state.gold`, `state.itemCount(Item.Revive)`, etc.
 * Anything malformed is ignored instead of throwing: the server's format can change without notice.
 */
export class GameState {
  constructor(private readonly options: { onError?: ErrorHandler } = {}) {}

  #fields: Record<string, unknown> | null = null;
  /** Keyed by the id as text, so `11` and `"11"` are the same pokémon. */
  #pokemonById = new Map<string, PokemonWire>();
  #pokemonCache: readonly Pokemon[] | null = null;
  #playerCache: PlayerState | null = null;
  #automationCache: AutomationState | null = null;
  #twitchCache: TwitchState | null = null;
  #balls: readonly BallEntry[] = Object.freeze([]);
  #shop: readonly ShopEntry[] = Object.freeze([]);
  #huntNames = new Map<string, string>();
  #extra: readonly ExtraItemEntry[] = Object.freeze([]);
  #xpShareId: number | null = null;
  readonly #listeners = new Set<() => void>();
  #full = false;

  /** @internal Captures last-known values without reapplying or retaining a raw packet. */
  snapshot(): GameState {
    const copy = new GameState();
    copy.#fields = this.#fields === null ? null : { ...this.#fields };
    copy.#pokemonById = new Map(this.#pokemonById);
    copy.#pokemonCache = this.#pokemonCache;
    copy.#playerCache = this.#playerCache;
    copy.#automationCache = this.#automationCache;
    copy.#twitchCache = this.#twitchCache;
    copy.#balls = this.#balls;
    copy.#shop = this.#shop;
    copy.#huntNames = this.#huntNames;
    copy.#extra = this.#extra;
    copy.#xpShareId = this.#xpShareId;
    copy.#full = this.#full;
    return copy;
  }

  /**
   * Has the full state arrived? The game sends it once, in the `welcome` packet right after login. If your code starts
   * listening after that (for example the extension was reloaded with the game already open), you only get updates:
   * `gold` may be known but `level`, the inventory and the catalogs are not, until the page reloads.
   */
  get complete(): boolean {
    return this.#full;
  }

  /**
   * The connection this state came from is gone (or a new one just opened): what is held is the LAST KNOWN, no longer
   * current, so `complete` turns `false` until the next `welcome`. Nothing is erased: you can still read the last values.
   */
  markStale(): void {
    if (!this.#full) return;
    this.#full = false;
    this.#notify();
  }

  /** The ball catalog from the last welcome packet. */
  get ballCatalog(): readonly BallEntry[] {
    return this.#balls;
  }

  /** The item id of the Exp. Share a pokémon can hold (a pokémon holding it cannot be sold), or `null` before the welcome packet. */
  get xpShareItemId(): number | null {
    return this.#xpShareId;
  }

  /** The id of the pokémon that is out in the hunt right now, or `null`. */
  get activePokemonId(): number | null {
    return asId(this.#fields?.['activeId']);
  }

  /** One of the player's pokémon by id (the id may come as a number or as text) in the game's own field names, or `undefined`. Prefer `pokemon`. */
  findPokemon(id: number): PokemonWire | undefined {
    return this.#pokemonById.get(String(id));
  }

  /** One of the player's pokémon by id, normalized, or `undefined`. */
  pokemon(id: number): Pokemon | undefined {
    const wire = this.#pokemonById.get(String(id));
    return wire === undefined ? undefined : (normalizePokemon(wire) ?? undefined);
  }

  /** All the player's pokémon, normalized (rows without a usable id are left out). The same array until something changes. */
  get pokemons(): readonly Pokemon[] {
    this.#pokemonCache ??= deepFreeze([...this.#pokemonById.values()].flatMap((wire) => normalizePokemon(wire) ?? []));
    return this.#pokemonCache;
  }

  // The questions below are three-valued on purpose: `null` means "I do not know" (a partial state, a pokémon that is not
  // in the list), and a caller that is about to do something irreversible must treat it as "no", never as "false".

  /** Is this pokémon the one out in the hunt? `null` when the active pokémon is not known. */
  isActive(id: number): boolean | null {
    const active = this.activePokemonId;
    return active === null ? null : active === id;
  }

  /** Is this pokémon in your team? `null` when it is not in your list. */
  isInTeam(id: number): boolean | null {
    return this.pokemon(id)?.inTeam ?? null;
  }

  /** Is this pokémon in the Collection (the game calls it locked: it is kept out of the Depot's sales)? `null` when the Collection is not known. */
  isInCollection(id: number): boolean | null {
    const locked = (this.#fields?.['automation'] as { pokemonTravado?: unknown } | undefined)?.pokemonTravado;
    return Array.isArray(locked) ? locked.some((x) => Number(x) === id) : null;
  }

  /** Does this pokémon hold the Exp. Share? `null` when the pokémon or the Exp. Share item is not known. */
  holdsExpShare(id: number): boolean | null {
    const pokemon = this.pokemon(id);
    if (pokemon === undefined || this.#xpShareId === null || !pokemon.heldItemKnown) return null;
    return pokemon.heldItemId === this.#xpShareId;
  }

  /** The game's own items (not in the public items catalog), from the last welcome packet. */
  get extraItems(): readonly ExtraItemEntry[] {
    return this.#extra;
  }

  /** The display name of a hunt from the last welcome packet's hunt list, or `null` (unknown slug, or no list yet). */
  huntName(slug: string): string | null {
    return this.#huntNames.get(slug) ?? null;
  }

  /** The items the shop sells, from the last welcome packet. */
  get shopItems(): readonly ShopEntry[] {
    return this.#shop;
  }

  /**
   * Everything known about the player, or `null` before the first welcome. Treat it as read-only: it is a snapshot, the
   * same object until the next update. All nested data is privately owned and frozen, including the wire rows and
   * arbitrary server fields: changing a packet or a reader cannot mutate the SDK's state.
   */
  get player(): PlayerState | null {
    if (!this.#fields) return null;
    this.#playerCache ??= Object.freeze({ ...this.#fields, pokemons: Object.freeze([...this.#pokemonById.values()]) as PokemonWire[] });
    return this.#playerCache;
  }

  /** How many pokémon you have (without building a list). */
  get pokemonCount(): number {
    return this.#pokemonById.size;
  }

  get nick(): string | null {
    return asText(this.#fields?.['nick']);
  }
  get level(): number | null {
    return asNumber(this.#fields?.['level']);
  }
  get xp(): number | null {
    return asNumber(this.#fields?.['xp']);
  }
  get gold(): number | null {
    return asNumber(this.#fields?.['gold']);
  }
  get diamonds(): number | null {
    return asNumber(this.#fields?.['diamonds']);
  }
  get orbs(): number | null {
    return asNumber(this.#fields?.['orbs']);
  }
  get huntSlug(): string | null {
    return asText(this.#fields?.['huntSlug']);
  }

  /** Whether the player is in the Pokemon Center, or `null` when the server has not supplied a boolean. */
  get inCenter(): boolean | null {
    const value = this.#fields?.['noCentro'];
    return typeof value === 'boolean' ? value : null;
  }

  /** Selected automation consumables, normalized and frozen. Invalid ids are omitted; unknown lists stay `null`. */
  get automation(): AutomationState | null {
    this.#automationCache ??= normalizeAutomation(this.#fields?.['automation']);
    return this.#automationCache;
  }

  /** Twitch facts without UI limits or inferred live/watching status. Missing or malformed values stay `null`. */
  get twitch(): TwitchState | null {
    this.#twitchCache ??= normalizeTwitch(this.#fields?.['twitch']);
    return this.#twitchCache;
  }

  /** Known quantity, including zero for an absent id in a known map; `null` for an unknown map or invalid value/id. Last-known like other getters. */
  itemQuantity(id: number): number | null {
    return quantity(this.#fields?.['items'], id);
  }

  /** Known ball quantity, with the same unknown/zero distinction as `itemQuantity`. */
  ballQuantity(id: number): number | null {
    return quantity(this.#fields?.['balls'], id);
  }

  /** How many of an item the player has (0 if none or unknown). Use the `Item` enum for the id. */
  itemCount(id: number): number {
    return count(this.#fields?.['items'], id);
  }

  /** How many of a ball the player has. Use the `Ball` enum for the id. */
  ballCount(id: number): number {
    return count(this.#fields?.['balls'], id);
  }

  /**
   * Name of an item id from what the server told us (its shop and its own items) and from the NPC shop table. It does NOT
   * consult the full items catalog (that is 70 KB you may not want): for any item, use `itemInfo(id)?.name`.
   */
  itemName(id: number): string | null {
    return (
      this.#shop.find((s) => s.itemId === id)?.name ??
      this.#extra.find((e) => e.id === id)?.name ??
      NPC_SHOP_ITEMS.find((i) => i.id === id)?.name ??
      null
    );
  }

  ballName(id: number): string | null {
    return this.#balls.find((b) => b.id === id)?.name ?? BALL_CATALOG.find((b) => b.id === id)?.name ?? null;
  }

  /** Called after every change. Returns a function that stops listening. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  /** Feed it every incoming packet: it picks the ones it understands. */
  applyPacket(packet: Packet): void {
    if (packet.t === 'welcome') {
      this.markStale();
      this.#readCatalogs(packet);
      this.#merge(packet['estado'], true);
    } else if (packet.t === 'estado') {
      this.#merge(packet['estado'], false);
    }
  }

  #readCatalogs(packet: Packet): void {
    this.#balls = Object.freeze([]);
    this.#shop = Object.freeze([]);
    this.#extra = Object.freeze([]);
    this.#huntNames = new Map();
    this.#xpShareId = null;
    const balls = packet['catalogoBolas'];
    if (Array.isArray(balls)) {
      this.#balls = deepFreeze(
        balls
          .slice(0, MAX_LIST)
          .filter(isObject)
          .flatMap((b: BallCatalogEntryWire) => {
            const id = asNumber(b.id);
            return id === null
              ? []
              : [
                  {
                    id,
                    name: asText(b.nome, 40) ?? `Ball ${id}`,
                    catchRate: asNumber(b.catchRate),
                    priceGold: asNumber(b.priceGold),
                    buyable: b.compravel === true,
                  },
                ];
          }),
      );
    }
    const xpShare = packet['xpShareHeld'];
    if (isObject(xpShare)) this.#xpShareId = asId(xpShare['itemId']);
    const extra = packet['itensNossos'];
    if (Array.isArray(extra)) {
      this.#extra = deepFreeze(
        extra
          .slice(0, MAX_LIST)
          .filter(isObject)
          .flatMap((e: ExtraItemWire) => {
            const id = asNumber(e.id);
            const name = asText(e.name, 60);
            return id === null || name === null
              ? []
              : [{ id, name, category: asText(e.category, 30) ?? 'unknown', rare: e.rare === true, npcPrice: asNumber(e.npcPrice) }];
          }),
      );
    }
    const hunts = packet['hunts'];
    if (Array.isArray(hunts)) {
      const names = new Map<string, string>();
      for (const h of hunts.slice(0, MAX_LIST).filter(isObject) as Array<{ slug?: unknown; nome?: unknown }>) {
        const slug = asText(h.slug, 80);
        const name = asText(h.nome, 80);
        if (slug !== null && name !== null) names.set(slug, name);
      }
      this.#huntNames = names;
    }
    const shop = packet['itensCompraveis'];
    if (Array.isArray(shop)) {
      this.#shop = deepFreeze(
        shop
          .slice(0, MAX_LIST)
          .filter(isObject)
          .flatMap((s: ShopItemWire) => {
            const itemId = asNumber(s.itemId);
            return itemId === null ? [] : [{ itemId, name: asText(s.nome, 60) ?? `Item ${itemId}`, price: asNumber(s.preco) }];
          }),
      );
    }
  }

  /**
   * Merges a full state or a delta. A full state starts over; a delta arriving first also becomes the base. Top-level
   * fields of a delta replace the old ones as a whole: `items` and `balls` are treated as complete maps, which is how the
   * game's own client has always read them (not verified against every packet the server can send).
   */
  #merge(partial: unknown, full: boolean): void {
    try {
      this.#mergeInto(partial, full);
    } catch (error) {
      // Half applied (new fields, old pokémon): never leave that looking complete. Actions refuse until the next welcome.
      this.markStale();
      throw error;
    }
  }

  #mergeInto(partial: unknown, full: boolean): void {
    if (!isObject(partial)) return;
    this.#pokemonCache = null;
    this.#playerCache = null;
    this.#automationCache = null;
    this.#twitchCache = null;
    const { cheio, pokemons, pkMud, pkFora, dexMud, dexFora, ...rest } = frozenCopy(safeCopy(partial));
    const known = (list: unknown): Array<[string, PokemonWire]> => rowsWithId(list).map((k) => [idKey(k.id), k]);
    if (full || cheio === true || !this.#fields) {
      this.#fields = { ...rest };
      if (full || cheio === true) this.#full = true; // a delta that arrives first becomes the base but is not a complete state
      this.#pokemonById = new Map(known(pokemons));
    } else {
      Object.assign(this.#fields, rest); // `rest` has no unsafe keys, so no setter can run
      // A complete list outside a full state replaces the collection instead of adding to it.
      if (Array.isArray(pokemons)) this.#pokemonById = new Map(known(pokemons));
    }
    for (const [key, row] of known(pkMud)) this.#pokemonById.set(key, row);
    if (Array.isArray(pkFora)) for (const id of pkFora) this.#pokemonById.delete(idKey(id));
    if (dexMud !== undefined || dexFora !== undefined) {
      const dex: Record<string, unknown> = {
        ...safeCopy(isObject(this.#fields['pokedex']) ? this.#fields['pokedex'] : {}),
        ...safeCopy(isObject(dexMud) ? dexMud : {}),
      };
      if (Array.isArray(dexFora)) for (const key of dexFora) delete dex[String(key)];
      this.#fields['pokedex'] = Object.freeze(dex);
    }
    this.#notify();
  }

  #notify(): void {
    const onError = this.options.onError ?? defaultErrorHandler;
    for (const listener of [...this.#listeners]) guarded(onError, listener);
  }
}

function quantity(map: unknown, id: number): number | null {
  if (!Number.isSafeInteger(id) || id < 0 || !isObject(map)) return null;
  if (!Object.hasOwn(map, String(id))) return 0;
  const value = asNumber(map[String(id)]);
  return value !== null && value >= 0 ? value : null;
}

function count(map: unknown, id: number): number {
  if (!isObject(map)) return 0;
  const value = map[String(id)];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
