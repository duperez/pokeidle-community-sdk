import { Inspector } from './inspector.js';
import { DEFAULT_MAX_PACKET_BYTES, parsePacket, type Packet } from './packets.js';
import type { PacketMap } from './protocol/wire.js';
import { GameState } from './state.js';
import type { Transport } from './transport.js';

export type Unsubscribe = () => void;

export interface ClientOptions {
  transport: Transport;
  /** Records counts and redacted samples of what goes by. `false` turns it off. Default: a new `Inspector`. */
  inspector?: Inspector | false;
  /** Frames above this size are ignored. */
  maxPacketBytes?: number;
  /** Called when one of your listeners throws (it never breaks the other listeners). Default: `console.error`. */
  onError?: (error: unknown) => void;
}

type PacketListener = (packet: Packet) => void;

/**
 * The entry point: turns the game's frames into packets and delivers them to your listeners. You only care about
 * "what came in" (`on`) and, later, "what to send"; how the frames travel is the transport's job.
 */
export class PokeIdleClient {
  readonly inspector: Inspector | null;
  /** The player's state, kept up to date from the game's packets. */
  readonly state = new GameState();
  private readonly transport: Transport;
  private readonly maxBytes: number;
  private readonly onError: (error: unknown) => void;
  private readonly byType = new Map<string, Set<PacketListener>>();
  private readonly anyPacket = new Set<PacketListener>();
  private readonly outgoing = new Set<PacketListener>();
  private readonly connection = new Set<(connected: boolean) => void>();
  private started = false;

  constructor(options: ClientOptions) {
    this.transport = options.transport;
    this.inspector = options.inspector === false ? null : (options.inspector ?? new Inspector());
    this.maxBytes = options.maxPacketBytes ?? DEFAULT_MAX_PACKET_BYTES;
    this.onError = options.onError ?? ((error) => console.error('[pokeidle-community-sdk] listener failed', error));
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
   * Every incoming packet of one type, e.g. `client.on('welcome', (packet) => ...)`. Types with a verified shape
   * (`welcome`, `estado`) give you a typed packet; any other type string gives a plain `Packet`.
   * `client.state` is already updated when your listener runs.
   */
  on<K extends keyof PacketMap>(type: K, listener: (packet: PacketMap[K]) => void): Unsubscribe;
  on(type: string, listener: PacketListener): Unsubscribe;
  on(type: string, listener: (packet: never) => void): Unsubscribe {
    const set = this.byType.get(type) ?? new Set();
    set.add(listener as PacketListener);
    this.byType.set(type, set);
    return () => void set.delete(listener as PacketListener);
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

  private handleIncoming(text: string): void {
    const packet = parsePacket(text, this.maxBytes);
    if (!packet) return;
    this.inspector?.recordReceived(packet);
    this.safely(() => this.state.applyPacket(packet)); // before the listeners, so they see the new state
    this.call(this.byType.get(packet.t), packet);
    this.call(this.anyPacket, packet);
  }

  private handleOutgoing(text: string): void {
    const packet = parsePacket(text, this.maxBytes);
    if (!packet) return;
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
