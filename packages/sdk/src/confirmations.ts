import type { ActionsHost } from './actions-host.js';
import type { ActionsOptions, BuyRequest, BuyResult, Scheduler, SellRequest, SellResult } from './actions-types.js';
import { DEFAULTS } from './actions-options.js';
import { normalizeName, parseSaleName } from './sale-rules.js';
import { waitForFirst, type Waiter } from './wait-for-first.js';

// How each action learns that the game did it. Both listen to several sources and answer with the first.

type Deps = { host: ActionsHost; scheduler: Scheduler; options: ActionsOptions };

/**
 * The connection dropped or was replaced while we waited. The order may have gone through before that, so the answer is
 * `unconfirmed` (and the next action waits), never "failed".
 */
const onConnectionLost = (host: ActionsHost, callback: () => void): (() => void) => host.onConnectionChange(() => callback());

/** The useful part of an `erro` packet. */
export function errorOf(packet: Record<string, unknown>): { chave?: string; msg?: string; params?: Record<string, unknown> } {
  const params = packet['params'];
  return {
    ...(typeof packet['chave'] === 'string' ? { chave: packet['chave'] } : {}),
    ...(typeof packet['msg'] === 'string' ? { msg: packet['msg'] } : {}),
    ...(params !== null && typeof params === 'object' && !Array.isArray(params) ? { params: params as Record<string, unknown> } : {}),
  };
}

/** Resolves with the first of: the game's `compra` event, the inventory growing, an error, or the timeout. */
export function waitForPurchase(
  { host, scheduler, options }: Deps,
  request: BuyRequest,
  before: number,
  inventoryBefore = before,
): Waiter<BuyResult> {
  const startedAt = scheduler.now();
  const state = host.state;
  const count = (): number => (request.kind === 'ball' ? state.ballCount(request.id) : state.itemCount(request.id));
  const name = (request.kind === 'ball' ? state.ballName(request.id) : state.itemName(request.id))?.toLowerCase() ?? null;
  const graceMs = options.confirmGraceMs ?? DEFAULTS.confirmGraceMs;
  // Set when the game's `compra` event arrived: the order is confirmed from then on, whatever else happens.
  let byEvent: BuyResult | null = null;
  const unconfirmed = (): BuyResult => byEvent ?? { status: 'unconfirmed', request, waitedMs: scheduler.now() - startedAt };
  return waitForFirst<BuyResult>(
    scheduler,
    options.confirmTimeoutMs ?? DEFAULTS.confirmTimeoutMs,
    (finish, onCleanup) => {
      let graceTimer: unknown;
      onCleanup(() => {
        if (graceTimer !== undefined) scheduler.clearTimeout(graceTimer);
      });
      // the game's own confirmation: `compra` with the quantity (and the name, when we know it)
      onCleanup(
        host.onBattleEvent('compra', (event) => {
          const eventName = typeof event['nome'] === 'string' ? event['nome'].toLowerCase() : null;
          if (byEvent !== null || event['qtd'] !== request.quantity || eventName === null || (name !== null && eventName !== name)) return;
          const spent = typeof event['gasto'] === 'number' ? event['gasto'] : null;
          const confirmed = (): BuyResult => ({
            status: 'confirmed',
            request,
            confirmedBy: 'event',
            confidence: 'certain',
            before,
            after: count(),
            spent,
          });
          byEvent = confirmed();
          // The `estado` update with the new count usually comes right after the event. If we answered now, that late update
          // could be taken for the evidence of the NEXT purchase of the same item: wait for it (a short grace) first.
          if (graceMs <= 0 || count() - inventoryBefore >= request.quantity) return finish(confirmed());
          graceTimer = scheduler.setTimeout(() => finish(confirmed()), graceMs);
        }),
      );
      // the inventory grew (balls used in the hunt can hide a small purchase: that is why the event comes first)
      onCleanup(
        state.onChange(() => {
          if (!state.complete) return;
          const after = count();
          // At least the quantity ordered: a drop or a purchase made elsewhere that adds a little must not confirm this order.
          if (after - inventoryBefore < request.quantity) return;
          if (byEvent !== null)
            return finish({
              status: 'confirmed',
              request,
              confirmedBy: 'event',
              confidence: 'certain',
              before,
              after,
              spent: byEvent.status === 'confirmed' ? byEvent.spent : null,
            });
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
      );
      // an error after the event is about something else: the order is already confirmed
      onCleanup(
        host.onType('erro', (packet) => {
          if (byEvent === null) finish({ status: 'rejected', request, confidence: 'probable', error: errorOf(packet) });
        }),
      );
      onCleanup(onConnectionLost(host, () => finish(unconfirmed())));
    },
    unconfirmed,
  );
}

/** Resolves with the first of: the game's `venda` event for this pokémon, the pokémon leaving the list, an error, the timeout. */
export function waitForSale({ host, scheduler, options }: Deps, request: SellRequest): Waiter<SellResult> {
  const startedAt = scheduler.now();
  const state = host.state;
  // The `venda` event names the pokémon WITH its level ("Charmander Nv 20"), nothing else. So it is matched on name and
  // level, and it is `certain` only when no other pokémon of yours has that same name AND level; otherwise `probable`.
  const wanted = request.name === null ? null : normalizeName(request.name);
  const sameKind =
    wanted === null
      ? 0
      : state.pokemons.filter(
          (p) => p.name !== null && normalizeName(p.name) === wanted && (request.level === null || p.level === request.level),
        ).length;
  const graceMs = options.confirmGraceMs ?? DEFAULTS.confirmGraceMs;
  return waitForFirst<SellResult>(
    scheduler,
    options.confirmTimeoutMs ?? DEFAULTS.confirmTimeoutMs,
    (finish, onCleanup) => {
      let graceTimer: unknown;
      onCleanup(() => {
        if (graceTimer !== undefined) scheduler.clearTimeout(graceTimer);
      });
      onCleanup(
        host.onBattleEvent('venda', (event) => {
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
      );
      onCleanup(
        state.onChange(() => {
          if (!state.complete) return;
          if (state.pokemon(request.pokemonId) !== undefined || graceTimer !== undefined) return;
          const byState: SellResult = { status: 'confirmed', request, confirmedBy: 'state', confidence: 'probable', gained: null };
          if (graceMs <= 0) return finish(byState);
          // the pokémon is gone; give the `venda` event a moment to arrive with the gold (it keeps listening until then)
          graceTimer = scheduler.setTimeout(() => finish(byState), graceMs);
        }),
      );
      onCleanup(host.onType('erro', (packet) => finish({ status: 'rejected', request, confidence: 'probable', error: errorOf(packet) })));
      onCleanup(onConnectionLost(host, () => finish({ status: 'unconfirmed', request, waitedMs: scheduler.now() - startedAt })));
    },
    () => ({ status: 'unconfirmed', request, waitedMs: scheduler.now() - startedAt }),
  );
}
