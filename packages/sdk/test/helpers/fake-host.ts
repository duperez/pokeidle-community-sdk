import type { ActionsHost, ActionsState } from '../../src/actions-host.js';
import type { Unsubscribe } from '../../src/listeners.js';
import type { Packet } from '../../src/packets.js';
import type { SendableCommand } from '../../src/protocol/commands.js';
import type { BattleEventKind, BattleEventMap } from '../../src/protocol/events.js';
import { GameState } from '../../src/state.js';

type BattleListener = (event: never) => void;

/**
 * The smallest possible `ActionsHost`: no client, no transport, no JSON. A real `GameState` (a pure class) holds the state,
 * and `feed` plays the game's packets in the same order the client does (the state first, then the listeners).
 * `subscriptions` counts what the code under test opened and did not close, so a leak is a number.
 */
export class FakeHost implements ActionsHost {
  connected = true;
  readonly sent: Array<{ command: SendableCommand; options: { confirmIrreversible?: boolean } | undefined }> = [];
  /** What `sendCommand` returns. */
  sendResult = true;
  /** When set, `sendCommand` throws it (as a guard would). */
  sendError: Error | null = null;
  /** Called after a command is recorded, before it returns: lets a test answer instantly, from inside the send. */
  onSent: (() => void) | null = null;

  readonly state: ActionsState;
  private subscribed = 0;
  private readonly packetListeners = new Map<string, Set<(packet: Packet) => void>>();
  private readonly battleListeners = new Map<string, Set<BattleListener>>();
  private readonly real = new GameState();

  constructor() {
    const counted = (fn: (listener: () => void) => Unsubscribe) => (listener: () => void) => this.count(fn(listener));
    const real = this.real;
    this.state = new Proxy(real, {
      get: (target, property) => {
        if (property === 'onChange') return counted((listener) => target.onChange(listener));
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  }

  /** How many subscriptions are open right now. */
  get subscriptions(): number {
    return this.subscribed;
  }

  onType(type: string, listener: (packet: Packet) => void): Unsubscribe {
    return this.count(this.add(this.packetListeners, type, listener));
  }

  onBattleEvent<K extends BattleEventKind>(kind: K, listener: (event: BattleEventMap[K]) => void): Unsubscribe {
    return this.count(this.add(this.battleListeners, kind, listener));
  }

  sendCommand(command: SendableCommand, options?: { confirmIrreversible?: boolean }): boolean {
    if (this.sendError) throw this.sendError;
    this.sent.push({ command, options });
    this.onSent?.();
    return this.sendResult;
  }

  /** Plays packets as the client would: the state first, then the listeners (and the battle events one by one). */
  feed(...packets: Array<Packet | Record<string, unknown>>): void {
    for (const raw of packets) {
      const packet = raw as Packet;
      this.real.applyPacket(packet);
      for (const listener of [...(this.packetListeners.get(packet.t) ?? [])]) listener(packet);
      const events = packet['ev'];
      if (packet.t === 'batalha' && Array.isArray(events)) {
        for (const event of events as Array<{ k: string }>)
          for (const listener of [...(this.battleListeners.get(event.k) ?? [])]) listener(event as never);
      }
    }
  }

  private add<L>(registry: Map<string, Set<L>>, key: string, listener: L): Unsubscribe {
    const set = registry.get(key) ?? new Set<L>();
    set.add(listener);
    registry.set(key, set);
    return () => void set.delete(listener);
  }

  private count(off: Unsubscribe): Unsubscribe {
    this.subscribed += 1;
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      this.subscribed -= 1;
      off();
    };
  }
}
