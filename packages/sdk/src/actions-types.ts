// The vocabulary of `Actions`: what you configure and what each call answers.

export interface RateLimit {
  /** Minimum time between two actions. Default 3000. */
  minIntervalMs?: number;
  /** Most actions in any 60 seconds. Default 10. */
  maxPerMinute?: number;
}

export interface ActionsOptions {
  /** Report what would be sent and send nothing. Default false. Can also be set per call. */
  dryRun?: boolean;
  /** Pass `false` to turn the rate limit off. */
  rateLimit?: RateLimit | false;
  /** Estimated gold you allow to spend per hour. Counted when the order is sent. Default: no cap. */
  maxGoldPerHour?: number;
  /** How long to wait for the game to confirm. Default 10000. */
  confirmTimeoutMs?: number;
  /**
   * A sale is confirmed as soon as the pokémon leaves your list, but the game's `venda` event (which carries the gold)
   * can arrive a moment later: this is how long to wait for it before answering. Default 1000; 0 answers at once.
   */
  confirmGraceMs?: number;
  /**
   * After an action that was not confirmed, or that the game answered with an error, how long before the next one is
   * allowed. The game's error packets carry no request id, so an error can be unrelated to the order and the order can
   * still have gone through: waiting is what keeps a retry from paying twice. Default 30000.
   */
  unconfirmedCooldownMs?: number;
  /**
   * The checks made before sending. `true` (default) turns them all on, `false` all off and lets the game decide;
   * an object turns each on or off: `notForSale` (a purchase the catalogs say is not sold), `gold` (not enough gold) and
   * `sellable` (a pokémon the game's client would not sell: active, team, Collection, Exp. Share).
   */
  checks?: boolean | { notForSale?: boolean; gold?: boolean; sellable?: boolean };
  /** Clock and timers, replaceable for tests. @internal */
  scheduler?: Scheduler;
}

export interface Scheduler {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** An action held back by a limit; `retryInMs` says for how long. */
export interface RateLimited {
  status: 'rate-limited';
  reason: 'interval' | 'per-minute' | 'unconfirmed-cooldown';
  retryInMs: number;
}

export interface BuyRequest {
  kind: 'ball' | 'item';
  id: number;
  quantity: number;
  /** Gold per unit according to the catalogs, or `null` if the SDK does not know. */
  unitPrice: number | null;
  /** `unitPrice × quantity`, or `null`. */
  totalPrice: number | null;
}

export type BuyResult =
  /**
   * `confidence` is `certain` when the game's own `compra` event matched (same quantity and name) and `probable` when
   * only the inventory grew by at least the quantity. `after` is the inventory when the confirmation arrived: when the
   * `compra` event comes first, the `estado` update with the new count may still be on its way.
   */
  | {
      status: 'confirmed';
      request: BuyRequest;
      confirmedBy: 'event' | 'inventory';
      confidence: 'certain' | 'probable';
      before: number;
      after: number;
      spent: number | null;
    }
  | { status: 'dry-run'; request: BuyRequest; command: { t: 'shop.buy'; kind: 'ball' | 'item'; id: number; qty: number } }
  /** Sent, but the game did not confirm in time. It may still have happened: do not assume it failed. */
  | { status: 'unconfirmed'; request: BuyRequest; waitedMs: number }
  /**
   * The game answered with an error while we waited: the first one that arrived. Errors carry no request id, so it is
   * only `probable` that it was about this order (it could even be that the order went through): the next action waits.
   */
  | {
      status: 'rejected';
      request: BuyRequest;
      confidence: 'probable';
      error: { chave?: string; msg?: string; params?: Record<string, unknown> };
    }
  | { status: 'not-connected' }
  /** The full state (the `welcome` packet) has not arrived: see `GameState.complete`. */
  | { status: 'no-state' }
  | { status: 'not-for-sale'; request: BuyRequest; reason: string }
  | { status: 'insufficient-gold'; request: BuyRequest; needed: number; have: number }
  | RateLimited
  | { status: 'spend-cap'; request: BuyRequest; spentLastHour: number; cap: number }
  | { status: 'busy' };

export interface SellRequest {
  pokemonId: number;
  name: string | null;
  level: number | null;
  shiny: boolean | null;
}

export type SellResult =
  /**
   * `gained` is the gold the game reports for the sale (from its `venda` event), or `null` when only the state confirmed it.
   * `state` means the pokémon left your list, which is strong evidence but not proof of a sale (a partial list, a new
   * `welcome`, or a market listing also remove it).
   */
  | { status: 'confirmed'; request: SellRequest; confirmedBy: 'event' | 'state'; confidence: 'certain' | 'probable'; gained: number | null }
  | { status: 'dry-run'; request: SellRequest; command: { t: 'shop.sellPokemon'; pokemonId: number } }
  /** Sent, but the game did not confirm in time. It may still have been sold: do not assume it was not. */
  | { status: 'unconfirmed'; request: SellRequest; waitedMs: number }
  /** The game answered with an error while we waited (see `BuyResult`): only `probable` that it was about this sale. */
  | {
      status: 'rejected';
      request: SellRequest;
      confidence: 'probable';
      error: { chave?: string; msg?: string; params?: Record<string, unknown> };
    }
  | { status: 'not-connected' }
  | { status: 'no-state' }
  /** The pokémon is not in your list (the state may be partial, or it was already sold). */
  | { status: 'not-found'; pokemonId: number }
  /** The game does not let this one be sold, going by the same rules its client uses: see `reason`. */
  | { status: 'not-sellable'; request: SellRequest; reason: string }
  | RateLimited
  | { status: 'busy' };
