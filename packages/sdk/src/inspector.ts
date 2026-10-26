import { isKnownPacketType, type IgnoredReason, type Packet } from './packets.js';
import { BATTLE_EVENT_KINDS, CLIENT_COMMAND_TYPES } from './protocol/registry.generated.js';
import { REDACTED, redact, type RedactOptions } from './redact.js';

export interface InspectorOptions {
  /** How many distinct packet types are tracked (the server decides the names, so the map must not grow forever). Default 200. */
  maxTypes?: number;
  /** Samples kept per packet type. Default 3. */
  maxSamplesPerType?: number;
  redact?: RedactOptions;
  /**
   * Packet types (by prefix) that carry what other people wrote or who they are: chat, friends, rankings, guilds...
   * Their samples keep the structure only; every text is replaced. Override to add more.
   */
  socialTypePrefixes?: readonly string[];
  /** Dotted paths that are always masked in samples, because a generic key (like `id`) cannot be masked everywhere. Default: the account id. */
  maskedPaths?: readonly string[];
}

export interface InspectorDump {
  /** How many packets of each type arrived. */
  received: Record<string, number>;
  /** How many packets of each type the game's own client sent. */
  sent: Record<string, number>;
  /** Types that are not in `KNOWN_PACKET_TYPES`: the ones worth investigating. */
  unknownTypes: string[];
  /** A few redacted examples per type, oldest first. Safe to share. */
  samples: Record<string, unknown[]>;
  /** Types the game's own client sent that the SDK does not know (commands added by the game). */
  unknownSentTypes: string[];
  /** How many battle events of each kind arrived (inside `batalha` packets). */
  battleEvents: Record<string, number>;
  /** Battle event kinds that are not in `BATTLE_EVENT_KINDS`: the game added an event. */
  unknownBattleEvents: string[];
  /** Frames that were not turned into packets, by reason. A non-zero `oversized` means the size limit is dropping packets. */
  ignored: Record<string, number>;
}

const OTHER = '(other)';
/** Commands of the game's modules that are not in the main client script (the Mini Games). */
const MODULE_COMMANDS = ['mg.entrar', 'mg.sair', 'mg.palpite'];
const KNOWN_COMMANDS = new Set<string>([...CLIENT_COMMAND_TYPES, ...MODULE_COMMANDS]);
const KNOWN_EVENTS = new Set<string>(BATTLE_EVENT_KINDS);
const DEFAULT_MASKED_PATHS = ['estado.id'] as const;
const DEFAULT_SOCIAL_PREFIXES = ['chat', 'amigos', 'ranking', 'guild', 'perfil', 'convite', 'comercio', 'oferenda', 'pvp', 'campeonato', 'topCatch', 'market', 'showdown', 'kick', 'twitch'] as const;

/**
 * Keeps counts and a few redacted samples of the packets that go by, so a developer can see what the game actually sends
 * (and share it) without leaking account data. Samples are redacted when they are recorded, never later.
 */
export class Inspector {
  private readonly received = new Map<string, number>();
  private readonly sent = new Map<string, number>();
  private readonly samples = new Map<string, unknown[]>();
  private readonly ignored = new Map<IgnoredReason, number>();
  private readonly battleEvents = new Map<string, number>();
  private readonly maxTypes: number;
  private readonly maxSamples: number;
  private readonly redactOptions: RedactOptions;
  private readonly socialPrefixes: readonly string[];
  private readonly maskedPaths: readonly string[];

  constructor(options: InspectorOptions = {}) {
    this.maxTypes = options.maxTypes ?? 200;
    this.maxSamples = options.maxSamplesPerType ?? 3;
    this.redactOptions = options.redact ?? {};
    this.socialPrefixes = options.socialTypePrefixes ?? DEFAULT_SOCIAL_PREFIXES;
    this.maskedPaths = options.maskedPaths ?? DEFAULT_MASKED_PATHS;
  }

  recordReceived(packet: Packet): void {
    this.record(this.received, packet, true);
  }

  recordSent(packet: Packet): void {
    this.record(this.sent, packet, false);
  }

  /** One battle event (`ev[].k` of a `batalha` packet). */
  recordBattleEvent(rawKind: string): void {
    const kind = rawKind.slice(0, 60); // the name comes from the server: keep it short
    const key = this.battleEvents.has(kind) || this.battleEvents.size < this.maxTypes ? kind : OTHER;
    this.battleEvents.set(key, (this.battleEvents.get(key) ?? 0) + 1);
  }

  recordIgnored(reason: IgnoredReason): void {
    this.ignored.set(reason, (this.ignored.get(reason) ?? 0) + 1);
  }

  private record(counts: Map<string, number>, packet: Packet, keepSample: boolean): void {
    const key = counts.has(packet.t) || counts.size < this.maxTypes ? packet.t : OTHER;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!keepSample || key === OTHER) return;
    const kept = this.samples.get(key) ?? [];
    if (kept.length < this.maxSamples) {
      const social = this.socialPrefixes.some((prefix) => key.startsWith(prefix));
      const sample = redact(packet, social ? { ...this.redactOptions, maskStrings: true } : this.redactOptions);
      for (const path of this.maskedPaths) maskPath(sample, path);
      kept.push(sample);
      this.samples.set(key, kept);
    }
  }

  /** Plain, redacted, JSON-serializable. */
  dump(): InspectorDump {
    const received = Object.fromEntries(this.received);
    return {
      received,
      sent: Object.fromEntries(this.sent),
      unknownTypes: Object.keys(received).filter((t) => t !== OTHER && !isKnownPacketType(t)).sort(),
      unknownSentTypes: Object.keys(this.sentCounts()).filter((t) => t !== OTHER && !KNOWN_COMMANDS.has(t)).sort(),
      battleEvents: Object.fromEntries(this.battleEvents),
      unknownBattleEvents: [...this.battleEvents.keys()].filter((k) => k !== OTHER && !KNOWN_EVENTS.has(k)).sort(),
      samples: Object.fromEntries(this.samples),
      ignored: Object.fromEntries(this.ignored),
    };
  }

  reset(): void {
    this.received.clear();
    this.sent.clear();
    this.samples.clear();
    this.ignored.clear();
    this.battleEvents.clear();
  }

  private sentCounts(): Record<string, number> {
    return Object.fromEntries(this.sent);
  }
}

/** Replaces the value at a dotted path (on an already redacted copy, so mutating it is safe). */
function maskPath(root: unknown, path: string): void {
  const keys = path.split('.');
  let node: unknown = root;
  for (const key of keys.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return;
    node = (node as Record<string, unknown>)[key];
  }
  const last = keys.at(-1);
  if (last && node !== null && typeof node === 'object' && last in (node as object)) (node as Record<string, unknown>)[last] = REDACTED;
}
