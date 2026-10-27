import { FakeScheduler } from './fake-scheduler.js';
import { pokemon, sellWelcome, welcome } from './fixtures.js';
import { PokeIdleClient, type ActionsOptions, type Transport, type TransportHandlers } from '../../src/index.js';

// Shared by the actions tests: a real client over a fake transport and a fake clock.

export class FakeTransport implements Transport {
  handlers: TransportHandlers | null = null;
  sent: Array<Record<string, unknown>> = [];
  readyState = 1;
  start(handlers: TransportHandlers): void {
    this.handlers = handlers;
  }
  stop(): void {}
  send(text: string): boolean {
    if (this.readyState !== 1) return false;
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
    return true;
  }
}

export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export function setup(options: ActionsOptions = {}, withWelcome = true) {
  const transport = new FakeTransport();
  const scheduler = new FakeScheduler();
  const client = new PokeIdleClient({ transport, actions: { confirmGraceMs: 0, ...options, scheduler } }); // no grace window unless a test asks for one
  client.start();
  const feed = (...packets: object[]) => packets.forEach((p) => transport.handlers?.onMessage(JSON.stringify(p)));
  if (withWelcome) feed(welcome());
  return { transport, scheduler, client, feed, actions: client.actions };
}

/** A player with: 1 = active and in the team, 2 = team (slot 1), 3 = in the Collection, 4 = holds the Exp. Share, 5 and 6 = ordinary Depot pokémon. */

export function setupSell(options: ActionsOptions = {}) {
  const ctx = setup(options, false);
  ctx.feed(
    sellWelcome([
      pokemon(1, { slot: 0 }),
      pokemon(2, { slot: 1 }),
      pokemon(3),
      pokemon(4, { heldItemId: 70050 }),
      pokemon(5),
      pokemon(6, { shiny: true, level: 77 }),
    ]),
  );
  return ctx;
}

export const SELL = { confirmIrreversible: true } as const;

// The real `venda` event names the pokémon WITH its level: { k: 'venda', nome: 'Charmander Nv 20', ganho: 4573, qtd: 1 }

export const charmander = (id: number, level: number, extra: Record<string, unknown> = {}) =>
  pokemon(id, { nome: 'Charmander', level, ...extra });

export const saleEvent = (nome: string, ganho = 4573) => ({ t: 'batalha', ev: [{ k: 'venda', nome, ganho, qtd: 1 }] });
