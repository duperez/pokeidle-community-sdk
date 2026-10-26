import { asId } from './coerce.js';
import type { PokemonWire } from './protocol/wire.js';

/**
 * A pokémon of yours as the SDK reads it: English names, real types, `null` where the server said nothing usable.
 * Built from the game's own field names in ONE place (`normalizePokemon`), so nothing else has to know them.
 */
export interface Pokemon {
  id: number;
  /** The species name the game shows, or `null`. */
  name: string | null;
  level: number | null;
  shiny: boolean | null;
  /** Is it one of the pokémon in your team (as opposed to the Depot)? */
  inTeam: boolean;
  /** The item it holds, or `null` when it holds nothing or the server did not say. */
  heldItemId: number | null;
}

/** `null` when the row has no usable id. */
export function normalizePokemon(wire: PokemonWire): Pokemon | null {
  const id = asId(wire.id);
  if (id === null) return null;
  return {
    id,
    name: typeof wire.nome === 'string' ? wire.nome : null,
    level: typeof wire.level === 'number' && Number.isFinite(wire.level) ? wire.level : null,
    shiny: typeof wire.shiny === 'boolean' ? wire.shiny : null,
    // Fail closed: any value in `slot` (even an odd one) means "team"; only its absence means the Depot.
    inTeam: wire.slot !== undefined && wire.slot !== null,
    heldItemId: asId(wire.heldItemId),
  };
}
