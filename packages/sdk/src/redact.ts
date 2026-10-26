/**
 * Redaction for anything that leaves the page: logs, recordings, bug reports. The game's packets carry session tokens,
 * e-mails and player names; none of that should end up in a file somebody shares. Redaction is on by default everywhere
 * the SDK records packets.
 */

/** Keys whose value is always replaced. Includes the game's own (Portuguese) wire names. */
const SENSITIVE_KEY =
  /token|senha|pass(word|wd)?\b|e-?mail|cookie|secret|sess(ion|[aã]o)|auth|jwt|bearer|api.?key|\bsid\b|credencial|nick(name)?\b|user(name)?\b|login|owner|account/i;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
/** Long runs of letters, digits, `_` and `-` look like tokens, hashes or keys, not game text. */
const LONG_SEQUENCE = /[A-Za-z0-9_-]{24,}/g;

export const REDACTED = '[redacted]';

export interface RedactOptions {
  /** How many items of an array are kept (the rest becomes a count). Default 3. */
  maxArrayItems?: number;
  /** How deep objects are followed. Default 5. */
  maxDepth?: number;
  /** Longest string kept. Default 120. */
  maxStringLength?: number;
}

/** Free text: no e-mails, no token-looking sequences, and short. */
export function cleanText(value: unknown, maxLength = 120): string {
  const text = String(value ?? '').replace(EMAIL, '[email]').replace(LONG_SEQUENCE, '[…]');
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** A safe, small copy of any value: sensitive keys replaced, text cleaned, arrays and depth limited. Never mutates its input. */
export function redact(value: unknown, options: RedactOptions = {}, depth = 0): unknown {
  const { maxArrayItems = 3, maxDepth = 5, maxStringLength = 120 } = options;
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? cleanText(value, maxStringLength) : value;
  }
  if (depth >= maxDepth) return Array.isArray(value) ? `[array of ${value.length}]` : '{…}';
  if (Array.isArray(value)) {
    const items: unknown[] = value.slice(0, maxArrayItems).map((item) => redact(item, options, depth + 1));
    if (value.length > maxArrayItems) items.push(`…+${value.length - maxArrayItems}`);
    return items;
  }
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(inner, options, depth + 1);
  }
  return out;
}
