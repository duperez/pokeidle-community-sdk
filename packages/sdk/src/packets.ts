/**
 * A message of the game's WebSocket. The game sends JSON text frames; every packet has a string `t` (its type).
 * Everything else depends on the type. Typed payloads are added per packet type as they are verified against real traffic.
 */
export interface Packet {
  readonly t: string;
  readonly [key: string]: unknown;
}

/**
 * Packet types observed in the game's traffic. The names are the game's own wire names, kept as they are.
 * A type that is not in this list is still delivered; the inspector just flags it as unknown so it can be investigated.
 */
export const KNOWN_PACKET_TYPES = [
  'welcome', 'estado', 'batalha', 'campo', 'campo.init', 'chat', 'chat.del', 'chat.fixada', 'chat.fixadas', 'chat.historico',
  'chat.interrompido', 'chat.mute', 'chat.aviso', 'market', 'guild', 'pvp', 'ranking', 'ranking.ficha', 'shiny.captura',
  'lendario.captura', 'bloqueios', 'showdown', 'topCatch', 'amigos', 'raidFichas', 'sessao.renovada', 'pong', 'erro', 'perfil', 'economia',
  'passe', 'ginasio', 'treino', 'csv', 'campeonato', 'convite', 'oferenda', 'comercio', 'orbs', 'estatisticas',
] as const;

export type KnownPacketType = (typeof KNOWN_PACKET_TYPES)[number];

const KNOWN = new Set<string>(KNOWN_PACKET_TYPES);

export const isKnownPacketType = (type: string): type is KnownPacketType => KNOWN.has(type);

/** Frames bigger than this are ignored: the game's packets are small, and parsing a huge frame would only stall the page. */
export const DEFAULT_MAX_PACKET_BYTES = 1_000_000;

/** Parses a text frame. Returns `null` for anything that is not a JSON object with a string `t`. Never throws. */
export function parsePacket(text: string, maxBytes: number = DEFAULT_MAX_PACKET_BYTES): Packet | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > maxBytes) return null;
  if (text.charCodeAt(0) !== 123 /* { */) return null; // cheap pre-check: packets are JSON objects
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const t = (value as { t?: unknown }).t;
  return typeof t === 'string' ? (value as Packet) : null;
}
