import type { ActionsState } from './actions-host.js';

/**
 * The rules of the game's own client for what the Depot sells. `null` when the pokémon can be sold.
 * Fails CLOSED: selling cannot be undone, so when a protection depends on data that is missing or unreadable (a partial
 * state) the answer is "no", never "nothing protects it".
 */
export function whyNotSellable(
  state: ActionsState,
  pokemon: { id?: number; slot?: number | null; heldItemId?: number | null },
): string | null {
  const id = Number(pokemon.id);
  if (!Number.isFinite(id)) return 'the pokémon has no id';
  const active = state.activePokemonId;
  if (active === null) return 'your active pokémon is not known (the state is partial): reload the game page';
  if (id === active) return 'it is your active pokémon';
  if (pokemon.slot !== undefined && pokemon.slot !== null) return 'it is in your team (only the Depot is sold)';
  if (!state.collectionKnown) return 'your Collection is not known (the state is partial): reload the game page';
  if (state.isInCollection(id)) return 'it is in your Collection (locked)';
  const xpShare = state.xpShareItemId;
  if (xpShare === null) return 'the Exp. Share item is not known (the state is partial): reload the game page';
  if (Number(pokemon.heldItemId) === xpShare) return 'it holds the Exp. Share';
  return null;
}

/** Lower case, without leading symbols (a shiny mark) or a `Shiny ` prefix, so "✨ Charmander" and "Charmander" compare equal. */
export const normalizeName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/^shiny\s+/, '')
    .trim();

/** `Charmander Nv 20` -> name `charmander`, level 20. Without a level suffix the level is `null`. */
export function parseSaleName(text: string): { name: string; level: number | null } {
  const match = /^(.*?)\s+Nv\.?\s*(\d+)\s*$/i.exec(text);
  return match ? { name: normalizeName(match[1] ?? ''), level: Number(match[2]) } : { name: normalizeName(text), level: null };
}
