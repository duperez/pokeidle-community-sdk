import { isKnownPacketType, type Packet } from './packets.js';
import { redact, type RedactOptions } from './redact.js';

export interface InspectorOptions {
  /** How many distinct packet types are tracked (the server decides the names, so the map must not grow forever). Default 200. */
  maxTypes?: number;
  /** Samples kept per packet type. Default 3. */
  maxSamplesPerType?: number;
  redact?: RedactOptions;
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
}

const OTHER = '(other)';

/**
 * Keeps counts and a few redacted samples of the packets that go by, so a developer can see what the game actually sends
 * (and share it) without leaking account data. Samples are redacted when they are recorded, never later.
 */
export class Inspector {
  private readonly received = new Map<string, number>();
  private readonly sent = new Map<string, number>();
  private readonly samples = new Map<string, unknown[]>();
  private readonly maxTypes: number;
  private readonly maxSamples: number;
  private readonly redactOptions: RedactOptions;

  constructor(options: InspectorOptions = {}) {
    this.maxTypes = options.maxTypes ?? 200;
    this.maxSamples = options.maxSamplesPerType ?? 3;
    this.redactOptions = options.redact ?? {};
  }

  recordReceived(packet: Packet): void {
    this.record(this.received, packet, true);
  }

  recordSent(packet: Packet): void {
    this.record(this.sent, packet, false);
  }

  private record(counts: Map<string, number>, packet: Packet, keepSample: boolean): void {
    const key = counts.has(packet.t) || counts.size < this.maxTypes ? packet.t : OTHER;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!keepSample || key === OTHER) return;
    const kept = this.samples.get(key) ?? [];
    if (kept.length < this.maxSamples) {
      kept.push(redact(packet, this.redactOptions));
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
      samples: Object.fromEntries(this.samples),
    };
  }

  reset(): void {
    this.received.clear();
    this.sent.clear();
    this.samples.clear();
  }
}
