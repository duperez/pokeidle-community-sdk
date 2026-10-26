import type { ActionsState } from './actions-host.js';

/**
 * The rules of the game's own client for what the Depot sells. `null` when the pokémon can be sold.
 * Fails CLOSED: selling cannot be undone, so when a protection depends on something the state does not know (a partial
 * state) the answer is "no", never "nothing protects it".
 */
export function whyNotSellable(state: ActionsState, id: number): string | null {
  const active = state.isActive(id);
  if (active === null) return 'your active pokémon is not known (the state is partial): reload the game page';
  if (active) return 'it is your active pokémon';
  const inTeam = state.isInTeam(id);
  if (inTeam === null) return 'it is not in your list';
  if (inTeam) return 'it is in your team (only the Depot is sold)';
  const inCollection = state.isInCollection(id);
  if (inCollection === null) return 'your Collection is not known (the state is partial): reload the game page';
  if (inCollection) return 'it is in your Collection (locked)';
  const holdsExpShare = state.holdsExpShare(id);
  if (holdsExpShare === null) return 'the Exp. Share item is not known (the state is partial): reload the game page';
  if (holdsExpShare) return 'it holds the Exp. Share';
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
