import type { ActionsHost } from './actions-host.js';
import { realScheduler, resolveChecks, validateOptions } from './actions-options.js';
import type { ActionsOptions, BuyRequest, BuyResult, Scheduler, SellRequest, SellResult } from './actions-types.js';
import { waitForPurchase, waitForSale } from './confirmations.js';
import { priceOf } from './pricing.js';
import { RateLimiter } from './rate-limiter.js';
import { whyNotSellable } from './sale-rules.js';
import { SpendLedger } from './spend-ledger.js';
import { defaultErrorHandler, report, type ErrorHandler } from './errors.js';
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

const MAX_PER_ORDER = 9999; // the game's own client never asks for more

/** Created for you as `client.actions`; it depends only on `ActionsHost`, not on the client class. The limits live in memory and are per instance: a page reload starts them over. */
export class Actions {
  private readonly options: ActionsOptions;
  private readonly scheduler: Scheduler;
  private readonly limiter: RateLimiter;
  private readonly ledger = new SpendLedger();
  private inFlight = false;
  private connectionGeneration = 0;
  private readonly inventoryFloors = new Map<string, number>();

  constructor(
    private readonly host: ActionsHost,
    options: ActionsOptions = {},
    private readonly onError: ErrorHandler = defaultErrorHandler,
  ) {
    validateOptions(options);
    this.options = options;
    this.scheduler = options.scheduler ?? realScheduler;
    this.limiter = new RateLimiter(options);
    // This subscription belongs to the host's lifetime; per-order listeners are owned by the confirmation waiter.
    host.onConnectionChange(() => {
      this.connectionGeneration += 1;
      this.inventoryFloors.clear();
    });
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
    return this.ledger.spentLastHour(this.scheduler.now());
  }

  private async buy(kind: 'ball' | 'item', id: number, quantity: number, options: { dryRun?: boolean }): Promise<BuyResult> {
    if (!Number.isInteger(id) || id < 0) throw new RangeError(`the ${kind} id must be a non-negative integer, got ${String(id)}`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PER_ORDER)
      throw new RangeError(`the quantity must be an integer from 1 to ${MAX_PER_ORDER}, got ${String(quantity)}`);

    if (this.inFlight) return { status: 'busy' };
    if (!this.host.connected) return { status: 'not-connected' };
    const state = this.host.state;
    if (!state.complete) return { status: 'no-state' };

    const price = priceOf(state, kind, id);
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
    const limited = this.limiter.check(now);
    if (limited) return limited;
    const cap = this.options.maxGoldPerHour;
    if (cap !== undefined) {
      const spent = this.ledger.spentLastHour(now);
      // Fail closed: with a cap set, an order whose price is unknown cannot be counted, so it is not allowed.
      if (request.totalPrice === null || spent + request.totalPrice > cap)
        return { status: 'spend-cap', request, spentLastHour: spent, cap };
    }
    if (dryRun) return { status: 'dry-run', request, command: { ...command } };

    const before = kind === 'ball' ? state.ballCount(id) : state.itemCount(id);
    const key = `${kind}:${id}`;
    const generation = this.connectionGeneration;
    const inventoryBefore = Math.max(before, this.inventoryFloors.get(key) ?? before);
    return this.dispatch({
      command: { ...command },
      confirmIrreversible: false,
      spendGold: request.totalPrice,
      onSent: () => {
        if (generation === this.connectionGeneration) this.inventoryFloors.set(key, inventoryBefore + quantity);
      },
      wait: () => waitForPurchase(this.confirmationDeps, request, before, inventoryBefore),
    });
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

    const pokemon = state.pokemon(pokemonId);
    if (!pokemon) return { status: 'not-found', pokemonId };
    const request: SellRequest = { pokemonId, name: pokemon.name, level: pokemon.level, shiny: pokemon.shiny };
    if (resolveChecks(this.options.checks).sellable) {
      const reason = whyNotSellable(state, pokemonId);
      if (reason) return { status: 'not-sellable', request, reason };
    }

    const now = this.scheduler.now();
    const limited = this.limiter.check(now);
    if (limited) return limited;
    const command = { t: 'shop.sellPokemon', pokemonId } as const;
    if (dryRun) return { status: 'dry-run', request, command: { ...command } };

    return this.dispatch({
      command: { ...command },
      confirmIrreversible: true,
      spendGold: null,
      wait: () => waitForSale(this.confirmationDeps, request),
    });
  }

  private get confirmationDeps(): { host: ActionsHost; scheduler: Scheduler; options: ActionsOptions } {
    return { host: this.host, scheduler: this.scheduler, options: this.options };
  }

  /**
   * The part every action shares: one at a time, listen BEFORE sending (the answer can be instant), send, record the
   * rate and spending budgets, wait, and after an unconfirmed or rejected order hold the next one back.
   */
  private async dispatch<R extends { status: string }>(spec: {
    command: SendableCommand;
    confirmIrreversible: boolean;
    spendGold: number | null;
    onSent?: () => void;
    wait: () => { result: Promise<R>; cancel: () => void };
  }): Promise<R | { status: 'not-connected' }> {
    this.inFlight = true;
    try {
      const confirmation = spec.wait();
      let sent: boolean;
      try {
        const answer = this.host.sendCommand(spec.command, { confirmIrreversible: spec.confirmIrreversible });
        sent = typeof answer === 'boolean' ? answer : await answer;
      } catch (error) {
        if (error instanceof CommandRefusedError) {
          confirmation.cancel();
          throw error;
        }
        // A transport failure can happen after writing the frame. Only an explicit false means definitely not sent.
        report(this.onError, error);
        sent = true;
      }
      if (!sent) {
        confirmation.cancel();
        return { status: 'not-connected' };
      }
      spec.onSent?.();
      const sentAt = this.scheduler.now();
      this.limiter.recordSend(sentAt);
      if (spec.spendGold !== null) this.ledger.record(sentAt, spec.spendGold);
      const result = await confirmation.result;
      if (result.status === 'unconfirmed' || result.status === 'rejected') this.limiter.startCooldown(this.scheduler.now());
      return result;
    } finally {
      this.inFlight = false;
    }
  }
}
