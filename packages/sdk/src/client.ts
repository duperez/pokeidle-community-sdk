import type { ActionCallOptions, BuyResult, SellResult } from './actions-types.js';
import { defaultErrorHandler, guarded, type ErrorHandler } from './errors.js';
import { Inspector } from './inspector.js';
import type { PacketListener, Unsubscribe } from './listeners.js';
import { ensurePageSession, type Consumer, type PageSession } from './page-session.js';
import { PageSessionError } from './page-session-error.js';
import type { BattleEvent, BattleEventKind, BattleEventMap } from './protocol/events.js';
import type { PacketMap } from './protocol/packet-map.js';
import { assertSendable, type SendableCommand } from './protocol/send-guard.js';
import { GameState } from './state.js';
import { StateView } from './state-view.js';

export type { Unsubscribe } from './listeners.js';
export interface ClientOptions {
  inspector?: Inspector | false;
  onError?: ErrorHandler;
}
export interface ClientActions {
  buyBall(id: number, quantity: number, options?: ActionCallOptions): Promise<BuyResult>;
  buyItem(id: number, quantity: number, options?: ActionCallOptions): Promise<BuyResult>;
  sellPokemon(id: number, options?: ActionCallOptions & { confirmIrreversible?: boolean }): Promise<SellResult>;
  readonly spentLastHour: number;
}

/** Consumer-local facade over the one runtime in the page's MAIN realm. Construction is inert. */
export class PokeIdleClient {
  readonly inspector: Inspector | null;
  readonly state: StateView;
  readonly actions: ClientActions;
  readonly #onError: ErrorHandler;
  readonly #packets = new Set<PacketListener>();
  readonly #types = new Map<string, Set<PacketListener>>();
  readonly #outgoing = new Set<PacketListener>();
  readonly #battle = new Map<string, Set<(event: never) => void>>();
  readonly #anyBattle = new Set<(event: BattleEvent) => void>();
  readonly #connection = new Set<(connected: boolean) => void>();
  readonly #changes = new Set<() => void>();
  #runtime: PageSession | null = null;
  #consumer: Consumer | null = null;
  #last = new GameState();
  #generation = 0;
  #run = 0;

  constructor(options: ClientOptions = {}) {
    if (options === null || typeof options !== 'object' || 'transport' in options || 'actions' in options || 'maxPacketBytes' in options)
      throw new PageSessionError('invalid-options');
    this.#onError = options.onError ?? defaultErrorHandler;
    this.inspector = options.inspector === false ? null : (options.inspector ?? new Inspector());
    this.state = new StateView(
      () => (this.#consumer ? this.#runtime!.capture() : this.#last),
      () => this.#consumer !== null,
      (listener) => this.add(this.#changes, listener),
    );
    const client = this;
    this.actions = Object.freeze({
      buyBall: (id: number, quantity: number, call: ActionCallOptions = {}) => this.buy('ball', id, quantity, call),
      buyItem: (id: number, quantity: number, call: ActionCallOptions = {}) => this.buy('item', id, quantity, call),
      sellPokemon: (id: number, call: ActionCallOptions & { confirmIrreversible?: boolean } = {}) =>
        this.#consumer && this.#runtime
          ? this.#runtime.sell(this.#consumer, id, { ...call })
          : Promise.resolve({ status: 'not-connected' } as const),
      get spentLastHour() {
        return client.#runtime?.spentLastHour ?? 0;
      },
    });
  }

  start(): void {
    if (this.#consumer) return;
    const runtime = ensurePageSession(globalThis);
    const run = ++this.#run;
    const current = () => this.#consumer !== null && this.#run === run;
    const consumer: Consumer = {
      onError: this.#onError,
      ignored: (reason) => {
        if (current()) this.inspector?.recordIgnored(reason);
      },
      packet: (packet, changed) => {
        if (!current()) return;
        this.inspector?.recordReceived(packet);
        if (changed) this.deliver(this.#changes, [], run);
        this.deliver(this.#types.get(packet.t), [packet], run);
        this.deliver(this.#packets, [packet], run);
        if (packet.t !== 'batalha' || !Array.isArray(packet['ev'])) return;
        for (const event of packet['ev']) {
          if (!current()) return;
          if (event === null || typeof event !== 'object' || typeof event.k !== 'string') continue;
          this.inspector?.recordBattleEvent(event.k, event);
          const typed = event as BattleEvent;
          this.deliver(this.#battle.get(event.k), [typed as never], run);
          this.deliver(this.#anyBattle, [typed], run);
        }
      },
      outgoing: (packet) => {
        if (!current()) return;
        this.inspector?.recordSent(packet);
        this.deliver(this.#outgoing, [packet], run);
      },
      connection: (connected) => {
        if (!current()) return;
        this.#generation = runtime.generation;
        this.deliver(this.#changes, [], run);
        this.deliver(this.#connection, [connected], run);
      },
    };
    this.#runtime = runtime;
    this.#generation = runtime.generation;
    this.#consumer = consumer;
    runtime.attach(consumer);
    this.deliver(this.#changes, [], run);
    if (runtime.connected) this.deliver(this.#connection, [true], run);
  }

  stop(): void {
    const consumer = this.#consumer;
    if (!consumer || !this.#runtime) return;
    this.#last = this.#runtime.capture();
    this.#consumer = null;
    this.#run++;
    this.#runtime.detach(consumer);
    for (const listener of [...this.#changes]) guarded(this.#onError, listener);
    for (const listener of [...this.#connection]) guarded(this.#onError, () => listener(false));
  }
  get connected(): boolean {
    return this.#consumer !== null && (this.#runtime?.connected ?? false);
  }
  get generation(): number {
    return this.#consumer ? (this.#runtime?.generation ?? 0) : this.#generation;
  }
  on<K extends keyof PacketMap>(type: K, listener: (packet: PacketMap[K]) => void): Unsubscribe {
    return this.onType(type, listener as PacketListener);
  }
  onType(type: string, listener: PacketListener): Unsubscribe {
    const listeners = this.#types.get(type) ?? new Set<PacketListener>();
    this.#types.set(type, listeners);
    return this.add(listeners, listener);
  }
  onPacket(listener: PacketListener): Unsubscribe {
    return this.add(this.#packets, listener);
  }
  onOutgoing(listener: PacketListener): Unsubscribe {
    return this.add(this.#outgoing, listener);
  }
  onConnectionChange(listener: (connected: boolean) => void): Unsubscribe {
    return this.add(this.#connection, listener);
  }
  onBattleEvent<K extends BattleEventKind>(kind: K, listener: (event: BattleEventMap[K]) => void): Unsubscribe {
    const listeners = this.#battle.get(kind) ?? new Set<(event: never) => void>();
    this.#battle.set(kind, listeners);
    return this.add(listeners, listener);
  }
  onAnyBattleEvent(listener: (event: BattleEvent) => void): Unsubscribe {
    return this.add(this.#anyBattle, listener);
  }
  sendRaw(text: string): Promise<boolean> {
    if (!this.#consumer || !this.#runtime) return Promise.resolve(false);
    // Busy is a definite synchronous refusal; only the native write can have an uncertain outcome.
    const runtime = this.#runtime;
    if (runtime.busy) throw new PageSessionError('busy');
    try {
      return Promise.resolve(runtime.send(text));
    } catch (error) {
      if (error instanceof PageSessionError && error.code === 'busy') throw error;
      return Promise.reject(error);
    }
  }
  sendCommand(command: SendableCommand, options: { confirmIrreversible?: boolean } = {}): Promise<boolean> {
    assertSendable(command, options.confirmIrreversible === true);
    return this.sendRaw(JSON.stringify(command));
  }
  private buy(kind: 'ball' | 'item', id: number, quantity: number, options: ActionCallOptions): Promise<BuyResult> {
    return this.#consumer && this.#runtime
      ? this.#runtime.buy(this.#consumer, kind, id, quantity, { ...options })
      : Promise.resolve({ status: 'not-connected' });
  }
  private add<T>(set: Set<T>, listener: T): Unsubscribe {
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }
  private deliver<A extends unknown[]>(listeners: Set<(...args: A) => void> | undefined, args: A, run: number): void {
    for (const listener of [...(listeners ?? [])]) {
      if (!this.#consumer || this.#run !== run) break;
      if (listeners?.has(listener)) guarded(this.#onError, () => listener(...args));
    }
  }
}
