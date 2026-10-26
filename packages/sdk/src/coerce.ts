// Small, total conversions for data that comes from the server: they never throw and say "no" with `null`.

export const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
export const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const asText = (v: unknown, max = 60): string | null => (typeof v === 'string' ? v.slice(0, max) : null);
/** An id that may arrive as a number or as numeric text (the game is not consistent about it). */
export const asId = (v: unknown): number | null => (typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : asNumber(v));
