import { Actions } from './actions.js';
import type { ActionsOptions } from './actions-types.js';
import { defaultErrorHandler, type ErrorHandler } from './errors.js';
import type { PacketListener, Unsubscribe } from './listeners.js';
import { Inspector } from './inspector.js';
import { DEFAULT_MAX_PACKET_BYTES, readFrame, type Packet } from './packets.js';
import type { BattleEvent, BattleEventKind, BattleEventMap } from './protocol/events.js';
import { assertSendable, type SendableCommand } from './protocol/send-guard.js';
import type { PacketMap } from './protocol/packet-map.js';
import { GameState } from './state.js';

export type { Unsubscribe } from './listeners.js';
import type { Transport } from './transport.js';

export interface ClientOptions {
  transport: Transport;
  /** Records counts and redacted samples of what goes by. `false` turns it off. Default: a new `Inspector`. */
  inspector?: Inspector | false;
  /** Frames longer than this are ignored (and counted in the inspector). The default is large on purpose: `welcome` can be several MB. */
  maxPacketBytes?: number;
  /** Options of `client.actions`: dry run, rate limit, spending cap. */
  actions?: ActionsOptions;
  /**
   * Called when something the SDK cannot throw to you fails: one of your listeners, a state callback or a transport
   * handler threw. It never breaks the other listeners. Default: logs to the console. The same handler is given to the
   * transport and to `client.state`.
   */
  onError?: ErrorHandler;
}

/**
 * The entry point: turns the game's frames into packets and delivers them to your listeners. You only care about
 * "what came in" (`on`) and, later, "what to send"; how the frames travel is the transport's job.
 */
export class PokeIdleClient {
  readonly inspector: Inspector | null;
  /** The player's state, kept up to date from the game's packets. */
  readonly state: GameState;
  /** What you can DO in the game (buy...), with safety nets: see `ActionsOptions`. */
  readonly actions: Actions;
  private readonly transport: Transport;
  private readonly maxBytes: number;
  private readonly onError: ErrorHandler;
  private readonly byType = new Map<string, Set<PacketListener>>();
  private readonly anyPacket = new Set<PacketListener>();
  private readonly outgoing = new Set<PacketListener>();
  private readonly battleByKind = new Map<string, Set<(event: never) => void>>();
  private readonly anyBattle = new Set<(event: BattleEvent) => void>();
  private readonly connection = new Set<(connected: boolean) => void>();
  private started = false;

  constructor(options: ClientOptions) {
    this.transport = options.transport;
    this.inspector = options.inspector === false ? null : (options.inspector ?? new Inspector());
    this.maxBytes = options.maxPacketBytes ?? DEFAULT_MAX_PACKET_BYTES;
    this.actions = new Actions(this, options.actions);
    this.onError = options.onError ?? defaultErrorHandler;
    this.state = new GameState({ onError: this.onError });
  }

  /** Starts listening. Safe to call more than once. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.transport.start({
      onMessage: (text) => this.handleIncoming(text),
      onOutgoing: (text) => this.handleOutgoing(text),
      onOpen: () => this.emitConnection(true),
      onClose: () => this.emitConnection(false),
      onError: this.onError,
    });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.transport.stop();
  }

  /** Is the game's socket open right now? */
  get connected(): boolean {
    return this.transport.readyState === 1;
  }

  /**
   * Every incoming packet of one type, e.g. `client.on('welcome', (packet) => ...)`. Only the packet types the game's
   * client handles are accepted (a typo does not compile); each gives you its typed packet. `client.state` is already
   * updated when your listener runs. For a type the game adds later, use `onType`.
   */
  on<K extends keyof PacketMap>(type: K, listener: (packet: PacketMap[K]) => void): Unsubscribe {
    return this.onType(type, listener as PacketListener);
  }

  /** Every incoming packet of any type name, as a plain `Packet`: for types the SDK does not know yet. */
  onType(type: string, listener: PacketListener): Unsubscribe {
    const set = this.byType.get(type) ?? new Set();
    set.add(listener);
    this.byType.set(type, set);
    return () => void set.delete(listener);
  }

  /**
   * One kind of battle event, e.g. `client.onBattleEvent('morte', (e) => e.ouro)`. The game sends several events per
   * `batalha` packet; this delivers them one by one. Five kinds have typed fields; the others are known by name and
   * by the field names the game's client reads.
   */
  onBattleEvent<K extends BattleEventKind>(kind: K, listener: (event: BattleEventMap[K]) => void): Unsubscribe {
    const set = this.battleByKind.get(kind) ?? new Set();
    set.add(listener);
    this.battleByKind.set(kind, set);
    return () => void set.delete(listener);
  }

  /** Every battle event, whatever its kind: switch on `event.k`. */
  onBattle(listener: (event: BattleEvent) => void): Unsubscribe {
    this.anyBattle.add(listener);
    return () => void this.anyBattle.delete(listener);
  }

  /** Every incoming packet, whatever its type. */
  onPacket(listener: PacketListener): Unsubscribe {
    this.anyPacket.add(listener);
    return () => void this.anyPacket.delete(listener);
  }

  /** Packets the game's own client sends (observed only). */
  onOutgoing(listener: PacketListener): Unsubscribe {
    this.outgoing.add(listener);
    return () => void this.outgoing.delete(listener);
  }

  onConnectionChange(listener: (connected: boolean) => void): Unsubscribe {
    this.connection.add(listener);
    return () => void this.connection.delete(listener);
  }

  /**
   * Low level: sends a text frame exactly as given. Prefer the typed actions (coming in later versions).
   * Returns `false` if the socket is not open.
   */
  sendRaw(text: string): boolean {
    return this.transport.send(text);
  }

  /**
   * Low level: sends a command the game's client knows, as JSON, right away. Commands with a typed shape are checked by
   * the compiler. Guards against accidents, not against someone who wants to bypass them (`sendRaw` exists):
   * - the forbidden commands (`FORBIDDEN_COMMANDS`, money leaving the game as cryptocurrency) are refused;
   * - the irreversible ones (`IRREVERSIBLE_COMMANDS`: they spend, sell or destroy something valuable) need
   *   `{ confirmIrreversible: true }`;
   * - numbers must be finite (`JSON.stringify(NaN)` is `null`) and `qty`/`qtd` positive integers.
   * It validates nothing else and asks nothing: it sends exactly what you pass. Throws `CommandRefusedError` when a
   * guard stops it; returns `false` if the socket is not open.
   */
  sendCommand(command: SendableCommand, options: { confirmIrreversible?: boolean } = {}): boolean {
    assertSendable(command, options.confirmIrreversible === true);
    return this.transport.send(JSON.stringify(command));
  }

  private handleIncoming(text: string): void {
    const frame = readFrame(text, this.maxBytes);
    if ('ignored' in frame) {
      this.inspector?.recordIgnored(frame.ignored); // never silent: a dropped packet shows up in the inspector
      return;
    }
    const packet = frame.packet;
    this.inspector?.recordReceived(packet);
    this.safely(() => this.state.applyPacket(packet)); // before the listeners, so they see the new state
    this.call(this.byType.get(packet.t), packet);
    this.call(this.anyPacket, packet);
    if (packet.t === 'batalha') this.dispatchBattle(packet);
  }

  private dispatchBattle(packet: Packet): void {
    const events = packet['ev'];
    if (!Array.isArray(events)) return;
    for (const event of events) {
      if (event === null || typeof event !== 'object' || typeof (event as { k?: unknown }).k !== 'string') continue;
      const typed = event as BattleEvent;
      this.inspector?.recordBattleEvent(typed.k, typed);
      for (const listener of [...(this.battleByKind.get(typed.k) ?? [])]) this.safely(() => (listener as (e: BattleEvent) => void)(typed));
      for (const listener of [...this.anyBattle]) this.safely(() => listener(typed));
    }
  }

  private handleOutgoing(text: string): void {
    const frame = readFrame(text, this.maxBytes);
    if ('ignored' in frame) return;
    const packet = frame.packet;
    this.inspector?.recordSent(packet);
    this.call(this.outgoing, packet);
  }

  private emitConnection(connected: boolean): void {
    for (const listener of [...this.connection]) {
      try {
        listener(connected);
      } catch (error) {
        this.onError(error);
      }
    }
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.onError(error);
    }
  }

  private call(listeners: Set<PacketListener> | undefined, packet: Packet): void {
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try {
        listener(packet);
      } catch (error) {
        this.onError(error);
      }
    }
  }
}
