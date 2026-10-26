// Invented values with the SHAPE of the real packets: nothing here comes from a real account.

/** A `welcome` packet. `estado` overrides fields of the player's state. */
export const welcome = (estado: Record<string, unknown> = {}) => ({
  t: 'welcome',
  estado: { cheio: true, gold: 100_000, items: { '200': 10 }, balls: { '1': 100, '4': 72, '5': 0 }, pokemons: [], ...estado },
  catalogoBolas: [
    { id: 1, nome: 'Poke Ball', catchRate: 1, priceGold: 5, compravel: true },
    { id: 4, nome: 'Ultra Ball', catchRate: 4, priceGold: 130, compravel: true },
    { id: 5, nome: 'Beast Ball', catchRate: 8, compravel: false },
  ],
  itensCompraveis: [{ itemId: 70091, preco: 20_000_000, nome: 'Mystery Egg P2' }],
});

export const pokemon = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  speciesId: 19,
  nome: `Mon${id}`,
  level: 10,
  shiny: false,
  ...extra,
});

/** A `welcome` for a player whose protections are readable: active pokémon 1, Collection [3], Exp. Share item 70050. */
export const sellWelcome = (pokemons: unknown[]) => ({
  ...welcome({ activeId: 1, automation: { pokemonTravado: [3] }, pokemons }),
  xpShareHeld: { enabled: true, itemId: 70050, pct: 5 },
});
