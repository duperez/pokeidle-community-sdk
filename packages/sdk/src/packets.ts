import { SERVER_PACKET_TYPES } from './protocol/registry.generated.js';

/**
 * A message of the game's WebSocket. The game sends JSON text frames; every packet has a string `t` (its type).
 * Everything else depends on the type. Typed payloads are added per packet type as they are verified against real traffic.
 */
export interface Packet {
  readonly t: string;
  readonly [key: string]: unknown;
}

/**
 * Packet types the game's client handles, extracted from the client itself (see `protocol/registry.generated.ts`). The
 * names are the game's own wire names. A type that is not in this list is still delivered; the inspector flags it as
 * unknown so it can be investigated, which is how a protocol change shows up.
 */
export const KNOWN_PACKET_TYPES = SERVER_PACKET_TYPES;

export type KnownPacketType = (typeof KNOWN_PACKET_TYPES)[number];

const KNOWN = new Set<string>(KNOWN_PACKET_TYPES);

export const isKnownPacketType = (type: string): type is KnownPacketType => KNOWN.has(type);

/**
 * Frames bigger than this (in characters) are ignored. It is a safety net against a runaway frame, not a normal limit:
 * the `welcome` packet carries the player's whole pokémon list plus the game's catalogs, so for a big account it is
 * several megabytes. A limit that is too low drops `welcome` and leaves the state empty.
 */
export const DEFAULT_MAX_PACKET_BYTES = 32_000_000;

/** Why a frame was not turned into a packet. */
export type IgnoredReason = 'oversized' | 'not-a-packet';

export type FrameResult = { readonly packet: Packet } | { readonly ignored: IgnoredReason };

/** Reads a text frame, saying why when it is ignored. Never throws. */
export function readFrame(text: string, maxBytes: number = DEFAULT_MAX_PACKET_BYTES): FrameResult {
  if (typeof text !== 'string' || text.length === 0) return { ignored: 'not-a-packet' };
  if (text.length > maxBytes) return { ignored: 'oversized' };
  if (text.charCodeAt(0) !== 123 /* { */) return { ignored: 'not-a-packet' }; // cheap pre-check: packets are JSON objects
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ignored: 'not-a-packet' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ignored: 'not-a-packet' };
  return typeof (value as { t?: unknown }).t === 'string' ? { packet: value as Packet } : { ignored: 'not-a-packet' };
}

/** Parses a text frame. Returns `null` for anything that is not a JSON object with a string `t`. Never throws. */
export function parsePacket(text: string, maxBytes: number = DEFAULT_MAX_PACKET_BYTES): Packet | null {
  const result = readFrame(text, maxBytes);
  return 'packet' in result ? result.packet : null;
}
