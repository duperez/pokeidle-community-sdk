import { itemInfo } from './catalog/index.js';
import type { ActionsHost } from './actions-host.js';
import { isIrreversibleCommand, type SendableCommand } from './protocol/commands.js';
import { CommandRefusedError } from './protocol/send-guard.js';

// Actions: the things you DO in the game, as functions that tell you what happened. Each one checks what it can before
// sending, sends the game's own command, and then waits for the game to confirm it instead of assuming it worked.
//
// Safety nets, all configurable and all meant to protect your account (none of them stops you from turning it off):
// - `dryRun`: say what would be sent, send nothing;
// - a rate limit (default: 3 s between actions and at most 10 per minute);
// - an optional spending cap per hour;
// - one action in flight at a time, and a pause after an unconfirmed one (it may only be late: buying again would pay twice).

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

const MAX_PER_ORDER = 9999; // the game's own client never asks for more
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DEFAULTS = {
  minIntervalMs: 3000,
  maxPerMinute: 10,
  confirmTimeoutMs: 10_000,
  unconfirmedCooldownMs: 30_000,
  confirmGraceMs: 1000,
} as const;
const realScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Created for you as `client.actions`; it depends only on `ActionsHost`, not on the client class. The limits live in memory and are per instance: a page reload starts them over. */
export class Actions {
  private readonly options: ActionsOptions;
  private readonly scheduler: Scheduler;
  private inFlight = false;
  private blockedUntil = 0;
  private lastSentAt = -Infinity;
  private sends: number[] = [];
  private spending: Array<{ at: number; gold: number }> = [];

  constructor(
    private readonly host: ActionsHost,
    options: ActionsOptions = {},
  ) {
    validateOptions(options);
    this.options = options;
    this.scheduler = options.scheduler ?? realScheduler;
  }

  /** Buys balls from the NPC shop. Use the `Ball` enum for the id. */
  buyBall(ball: number, quantity: number, options: { dryRun?: boolean } = {}): Promise<BuyResult> {
    return this.buy('ball', ball, quantity, options);
  }

  /** Buys items (potions, revives) from the NPC shop. Use the `Item` enum for the id. */
  buyItem(item: number, quantity: number, options: { dryRun?: boolean } = {}): Promise<BuyResult> {
    return this.buy('item', item, quantity, options);
  }

  /** Estimated gold sent in orders during the last hour. */
  get spentLastHour(): number {
    const since = this.scheduler.now() - HOUR_MS;
    return this.spending.filter((s) => s.at > since).reduce((sum, s) => sum + s.gold, 0);
  }

  private async buy(kind: 'ball' | 'item', id: number, quantity: number, options: { dryRun?: boolean }): Promise<BuyResult> {
    if (!Number.isInteger(id) || id < 0) throw new RangeError(`the ${kind} id must be a non-negative integer, got ${String(id)}`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PER_ORDER)
      throw new RangeError(`the quantity must be an integer from 1 to ${MAX_PER_ORDER}, got ${String(quantity)}`);

    if (this.inFlight) return { status: 'busy' };
    if (!this.host.connected) return { status: 'not-connected' };
    const state = this.host.state;
    if (!state.complete) return { status: 'no-state' };

    const price = this.priceOf(kind, id);
    const request: BuyRequest = {
      kind,
      id,
      quantity,
      unitPrice: price.unit,
      totalPrice: price.unit === null ? null : price.unit * quantity,
    };
    const command = { t: 'shop.buy', kind, id, qty: quantity } as const;
    const dryRun = options.dryRun ?? this.options.dryRun ?? false;

    const checks = resolveChecks(this.options.checks);
    if (checks.notForSale && price.reason) return { status: 'not-for-sale', request, reason: price.reason };
    const gold = state.gold;
    if (checks.gold && request.totalPrice !== null && gold !== null && gold < request.totalPrice)
      return { status: 'insufficient-gold', request, needed: request.totalPrice, have: gold };

    // A dry run predicts the real outcome: it goes through the same limits, but does not record anything.
    const now = this.scheduler.now();
    const limited = this.checkRateLimit(now);
    if (limited) return limited;
    const cap = this.options.maxGoldPerHour;
    if (cap !== undefined) {
      const spent = this.spentLastHour;
      // Fail closed: with a cap set, an order whose price is unknown cannot be counted, so it is not allowed.
      if (request.totalPrice === null || spent + request.totalPrice > cap)
        return { status: 'spend-cap', request, spentLastHour: spent, cap };
    }
    if (dryRun) return { status: 'dry-run', request, command: { ...command } };

    const before = kind === 'ball' ? state.ballCount(id) : state.itemCount(id);
    return this.dispatch({
      command: { ...command },
      confirmIrreversible: false,
      now,
      spendGold: request.totalPrice,
      wait: () => this.waitForConfirmation(request, before),
    });
  }

  /**
   * The part every action shares: one at a time, listen BEFORE sending (the answer can be instant), send, record the
   * rate and spending budgets, wait, and after an unconfirmed or rejected order hold the next one back.
   */
  private async dispatch<R extends { status: string }>(spec: {
    command: SendableCommand;
    confirmIrreversible: boolean;
    now: number;
    spendGold: number | null;
    wait: () => { result: Promise<R>; cancel: () => void };
  }): Promise<R | { status: 'not-connected' }> {
    this.inFlight = true;
    try {
      const confirmation = spec.wait();
      let sent = false;
      try {
        sent = this.host.sendCommand(spec.command, { confirmIrreversible: spec.confirmIrreversible });
      } catch (error) {
        confirmation.cancel(); // a guard refused it (CommandRefusedError): nothing was sent
        throw error;
      }
      if (!sent) {
        confirmation.cancel();
        return { status: 'not-connected' };
      }
      this.lastSentAt = spec.now;
      this.sends = [...this.sends.filter((t) => spec.now - t < MINUTE_MS), spec.now];
      if (spec.spendGold !== null)
        this.spending = [...this.spending.filter((e) => spec.now - e.at < HOUR_MS), { at: spec.now, gold: spec.spendGold }];
      const result = await confirmation.result;
      if (result.status === 'unconfirmed' || result.status === 'rejected')
        this.blockedUntil = this.scheduler.now() + (this.options.unconfirmedCooldownMs ?? DEFAULTS.unconfirmedCooldownMs);
      return result;
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Sells ONE pokémon from your Depot to the NPC shop. IRREVERSIBLE: it needs `{ confirmIrreversible: true }` (not for a
   * dry run). It refuses what the game's own client refuses (your active pokémon, your team, the Collection, one holding
   * the Exp. Share) and waits for the game's `venda` event or for the pokémon to leave your list.
   */
  async sellPokemon(pokemonId: number, options: { dryRun?: boolean; confirmIrreversible?: boolean } = {}): Promise<SellResult> {
    if (!Number.isInteger(pokemonId) || pokemonId < 0)
      throw new RangeError(`the pokémon id must be a non-negative integer, got ${String(pokemonId)}`);
    const dryRun = options.dryRun ?? this.options.dryRun ?? false;
    if (!dryRun && options.confirmIrreversible !== true && isIrreversibleCommand('shop.sellPokemon')) {
      throw new CommandRefusedError(
        'shop.sellPokemon',
        'selling a pokémon cannot be undone: pass { confirmIrreversible: true } if you mean it',
      );
    }
    if (this.inFlight) return { status: 'busy' };
    if (!this.host.connected) return { status: 'not-connected' };
    const state = this.host.state;
    if (!state.complete) return { status: 'no-state' };

    const pokemon = state.findPokemon(pokemonId);
    if (!pokemon) return { status: 'not-found', pokemonId };
    const request: SellRequest = {
      pokemonId,
      name: typeof pokemon.nome === 'string' ? pokemon.nome : null,
      level: typeof pokemon.level === 'number' ? pokemon.level : null,
      shiny: typeof pokemon.shiny === 'boolean' ? pokemon.shiny : null,
    };
    if (resolveChecks(this.options.checks).sellable) {
      const reason = this.whyNotSellable(pokemon);
      if (reason) return { status: 'not-sellable', request, reason };
    }

    const now = this.scheduler.now();
    const limited = this.checkRateLimit(now);
    if (limited) return limited;
    const command = { t: 'shop.sellPokemon', pokemonId } as const;
    if (dryRun) return { status: 'dry-run', request, command: { ...command } };

    return this.dispatch({
      command: { ...command },
      confirmIrreversible: true,
      now,
      spendGold: null,
      wait: () => this.waitForSale(request),
    });
  }

  /**
   * The rules of the game's own client for what the Depot sells. `null` when the pokémon can be sold.
   * Fails CLOSED: selling cannot be undone, so when a protection depends on data that is missing or unreadable (a partial
   * state) the answer is "no", never "nothing protects it".
   */
  private whyNotSellable(pokemon: { id?: number; slot?: number | null; heldItemId?: number | null }): string | null {
    const state = this.host.state;
    const id = Number(pokemon.id);
    if (!Number.isFinite(id)) return 'the pokémon has no id';
    const active = state.activePokemonId;
    if (active === null) return 'your active pokémon is not known (the state is partial): reload the game page';
    if (id === active) return 'it is your active pokémon';
    if (pokemon.slot !== undefined && pokemon.slot !== null) return 'it is in your team (only the Depot is sold)';
    if (!state.collectionKnown) return 'your Collection is not known (the state is partial): reload the game page';
    if (state.isInCollection(id)) return 'it is in your Collection (locked)';
    const xpShare = state.xpShareItemId;
    if (xpShare === null) return 'the Exp. Share item is not known (the state is partial): reload the game page';
    if (Number(pokemon.heldItemId) === xpShare) return 'it holds the Exp. Share';
    return null;
  }

  /** Resolves with the first of: the game's `venda` event for this pokémon, the pokémon leaving the list, an error, the timeout. */
  private waitForSale(request: SellRequest): { result: Promise<SellResult>; cancel: () => void } {
    const timeoutMs = this.options.confirmTimeoutMs ?? DEFAULTS.confirmTimeoutMs;
    const startedAt = this.scheduler.now();
    const state = this.host.state;
    // The `venda` event names the pokémon WITH its level ("Charmander Nv 20"), nothing else. So it is matched on name and
    // level, and it is `certain` only when no other pokémon of yours has that same name AND level; otherwise `probable`.
    const wanted = request.name === null ? null : normalizeName(request.name);
    const sameKind =
      wanted === null
        ? 0
        : (state.player?.pokemons ?? []).filter(
            (p) => typeof p.nome === 'string' && normalizeName(p.nome) === wanted && (request.level === null || p.level === request.level),
          ).length;
    const graceMs = this.options.confirmGraceMs ?? DEFAULTS.confirmGraceMs;
    let graceTimer: unknown;
    let finish: (result: SellResult) => void = () => {};
    const offs: Array<() => void> = [];
    let timer: unknown;
    const cleanup = (): void => {
      for (const off of offs) off();
      if (timer !== undefined) this.scheduler.clearTimeout(timer);
      if (graceTimer !== undefined) this.scheduler.clearTimeout(graceTimer);
    };
    const result = new Promise<SellResult>((resolve) => {
      finish = (value) => {
        cleanup();
        resolve(value);
      };
    });
    offs.push(
      this.host.onBattleEvent('venda', (event) => {
        const sold = typeof event['nome'] === 'string' ? parseSaleName(event['nome']) : null;
        if (wanted === null || sold === null || sold.name !== wanted) return;
        if (sold.level !== null && request.level !== null && sold.level !== request.level) return; // another level: another pokémon
        finish({
          status: 'confirmed',
          request,
          confirmedBy: 'event',
          confidence: sameKind === 1 ? 'certain' : 'probable',
          gained: typeof event['ganho'] === 'number' ? event['ganho'] : null,
        });
      }),
      state.onChange(() => {
        if (state.findPokemon(request.pokemonId) !== undefined || graceTimer !== undefined) return;
        const byState: SellResult = { status: 'confirmed', request, confirmedBy: 'state', confidence: 'probable', gained: null };
        if (graceMs <= 0) return finish(byState);
        // the pokémon is gone; give the `venda` event a moment to arrive with the gold (it keeps listening until then)
        graceTimer = this.scheduler.setTimeout(() => finish(byState), graceMs);
      }),
      this.host.onType('erro', (packet) => finish({ status: 'rejected', request, confidence: 'probable', error: errorOf(packet) })),
    );
    timer = this.scheduler.setTimeout(
      () => finish({ status: 'unconfirmed', request, waitedMs: this.scheduler.now() - startedAt }),
      timeoutMs,
    );
    return { result, cancel: cleanup };
  }

  private priceOf(kind: 'ball' | 'item', id: number): { unit: number | null; reason?: string } {
    const state = this.host.state;
    if (kind === 'ball') {
      const ball = state.ballCatalog.find((b) => b.id === id);
      if (!ball) return { unit: null, reason: `the server's ball catalog has no ball ${id}` };
      if (!ball.buyable || ball.priceGold === null || ball.priceGold <= 0)
        return { unit: null, reason: `${ball.name} is not sold in the shop` };
      return { unit: ball.priceGold };
    }
    const offered = state.shopItems.find((s) => s.itemId === id);
    if (offered)
      return offered.price === null || offered.price <= 0
        ? { unit: null, reason: `${offered.name} has no price` }
        : { unit: offered.price };
    // Potions and revives: the NPC shop sells them at the catalog's `npcPrice` (checked against real purchases).
    const info = itemInfo(id);
    if (info && (info.category === 'heal' || info.category === 'revive') && !info.rare && info.npcPrice !== null && info.npcPrice > 0)
      return { unit: info.npcPrice };
    return { unit: null, reason: info ? `${info.name} is not an item the NPC shop is known to sell` : `item ${id} is not in the catalog` };
  }

  private checkRateLimit(now: number): RateLimited | null {
    if (now < this.blockedUntil) return { status: 'rate-limited', reason: 'unconfirmed-cooldown', retryInMs: this.blockedUntil - now };
    const limit = this.options.rateLimit;
    if (limit === false) return null;
    const minInterval = limit?.minIntervalMs ?? DEFAULTS.minIntervalMs;
    const perMinute = limit?.maxPerMinute ?? DEFAULTS.maxPerMinute;
    if (now - this.lastSentAt < minInterval)
      return { status: 'rate-limited', reason: 'interval', retryInMs: minInterval - (now - this.lastSentAt) };
    const recent = this.sends.filter((t) => now - t < MINUTE_MS);
    if (recent.length >= perMinute)
      return { status: 'rate-limited', reason: 'per-minute', retryInMs: MINUTE_MS - (now - (recent[0] ?? now)) };
    return null;
  }

  /** Resolves with the first of: the game's `compra` event, the inventory growing, an error, or the timeout. */
  private waitForConfirmation(request: BuyRequest, before: number): { result: Promise<BuyResult>; cancel: () => void } {
    const timeoutMs = this.options.confirmTimeoutMs ?? DEFAULTS.confirmTimeoutMs;
    const startedAt = this.scheduler.now();
    const state = this.host.state;
    const count = (): number => (request.kind === 'ball' ? state.ballCount(request.id) : state.itemCount(request.id));
    const name = (request.kind === 'ball' ? state.ballName(request.id) : state.itemName(request.id))?.toLowerCase() ?? null;
    let finish: (result: BuyResult) => void = () => {};
    const offs: Array<() => void> = [];
    let timer: unknown;
    const cleanup = (): void => {
      for (const off of offs) off();
      if (timer !== undefined) this.scheduler.clearTimeout(timer);
    };
    const result = new Promise<BuyResult>((resolve) => {
      finish = (value) => {
        cleanup();
        resolve(value);
      };
    });
    offs.push(
      // the game's own confirmation: `compra` with the quantity (and the name, when we know it)
      this.host.onBattleEvent('compra', (event) => {
        const eventName = typeof event['nome'] === 'string' ? event['nome'].toLowerCase() : null;
        if (event['qtd'] !== request.quantity || eventName === null || (name !== null && eventName !== name)) return;
        const spent = typeof event['gasto'] === 'number' ? event['gasto'] : null;
        finish({ status: 'confirmed', request, confirmedBy: 'event', confidence: 'certain', before, after: count(), spent });
      }),
      // the inventory grew (balls used in the hunt can hide a small purchase: that is why the event comes first)
      state.onChange(() => {
        const after = count();
        // At least the quantity ordered: a drop or a purchase made elsewhere that adds a little must not confirm this order.
        if (after - before >= request.quantity)
          finish({
            status: 'confirmed',
            request,
            confirmedBy: 'inventory',
            confidence: 'probable',
            before,
            after,
            spent: request.totalPrice,
          });
      }),
      this.host.onType('erro', (packet) => finish({ status: 'rejected', request, confidence: 'probable', error: errorOf(packet) })),
    );
    timer = this.scheduler.setTimeout(
      () => finish({ status: 'unconfirmed', request, waitedMs: this.scheduler.now() - startedAt }),
      timeoutMs,
    );
    return { result, cancel: cleanup };
  }
}

/** Lower case, without leading symbols (a shiny mark) or a `Shiny ` prefix, so "✨ Charmander" and "Charmander" compare equal. */
const normalizeName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/^shiny\s+/, '')
    .trim();

/** `Charmander Nv 20` -> name `charmander`, level 20. Without a level suffix the level is `null`. */
function parseSaleName(text: string): { name: string; level: number | null } {
  const match = /^(.*?)\s+Nv\.?\s*(\d+)\s*$/i.exec(text);
  return match ? { name: normalizeName(match[1] ?? ''), level: Number(match[2]) } : { name: normalizeName(text), level: null };
}

/** The useful part of an `erro` packet. */
function errorOf(packet: Record<string, unknown>): { chave?: string; msg?: string; params?: Record<string, unknown> } {
  const params = packet['params'];
  return {
    ...(typeof packet['chave'] === 'string' ? { chave: packet['chave'] } : {}),
    ...(typeof packet['msg'] === 'string' ? { msg: packet['msg'] } : {}),
    ...(params !== null && typeof params === 'object' && !Array.isArray(params) ? { params: params as Record<string, unknown> } : {}),
  };
}

function resolveChecks(checks: ActionsOptions['checks']): { notForSale: boolean; gold: boolean; sellable: boolean } {
  if (checks === undefined || checks === true) return { notForSale: true, gold: true, sellable: true };
  if (checks === false) return { notForSale: false, gold: false, sellable: false };
  return { notForSale: checks.notForSale ?? true, gold: checks.gold ?? true, sellable: checks.sellable ?? true };
}

/** A bad number would silently turn a protection off (`x < NaN` is always false): refuse it. */
function validateOptions(options: ActionsOptions): void {
  const numbers: Array<[string, number | undefined]> = [
    ['maxGoldPerHour', options.maxGoldPerHour],
    ['confirmTimeoutMs', options.confirmTimeoutMs],
    ['confirmGraceMs', options.confirmGraceMs],
    ['unconfirmedCooldownMs', options.unconfirmedCooldownMs],
    ['rateLimit.minIntervalMs', options.rateLimit ? options.rateLimit.minIntervalMs : undefined],
    ['rateLimit.maxPerMinute', options.rateLimit ? options.rateLimit.maxPerMinute : undefined],
  ];
  for (const [name, value] of numbers) {
    if (value !== undefined && !(Number.isFinite(value) && value >= 0))
      throw new RangeError(`${name} must be a finite number of at least 0, got ${String(value)}`);
  }
}
