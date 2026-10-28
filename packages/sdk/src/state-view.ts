import type { GameState } from './state.js';

/** Read-only consumer view. The source and its mutation methods never escape. */
export class StateView {
  readonly #read: () => GameState;
  readonly #active: () => boolean;
  readonly #listen: (listener: () => void) => () => void;

  constructor(read: () => GameState, active: () => boolean, listen: (listener: () => void) => () => void) {
    this.#read = read;
    this.#active = active;
    this.#listen = listen;
    Object.freeze(this);
  }

  get complete() {
    return this.#active() && this.#read().complete;
  }
  get player() {
    return this.#read().player;
  }
  get ballCatalog() {
    return this.#read().ballCatalog;
  }
  get shopItems() {
    return this.#read().shopItems;
  }
  get extraItems() {
    return this.#read().extraItems;
  }
  get xpShareItemId() {
    return this.#read().xpShareItemId;
  }
  get activePokemonId() {
    return this.#read().activePokemonId;
  }
  get pokemons() {
    return this.#read().pokemons;
  }
  get pokemonCount() {
    return this.#read().pokemonCount;
  }
  get nick() {
    return this.#read().nick;
  }
  get level() {
    return this.#read().level;
  }
  get xp() {
    return this.#read().xp;
  }
  get gold() {
    return this.#read().gold;
  }
  get diamonds() {
    return this.#read().diamonds;
  }
  get orbs() {
    return this.#read().orbs;
  }
  get huntSlug() {
    return this.#read().huntSlug;
  }
  get inCenter() {
    return this.#read().inCenter;
  }
  get automation() {
    return this.#read().automation;
  }
  get twitch() {
    return this.#read().twitch;
  }
  findPokemon(id: number) {
    return this.#read().findPokemon(id);
  }
  pokemon(id: number) {
    const value = this.#read().pokemon(id);
    return value === undefined ? undefined : Object.freeze(value);
  }
  isActive(id: number) {
    return this.#read().isActive(id);
  }
  isInTeam(id: number) {
    return this.#read().isInTeam(id);
  }
  isInCollection(id: number) {
    return this.#read().isInCollection(id);
  }
  holdsExpShare(id: number) {
    return this.#read().holdsExpShare(id);
  }
  huntName(slug: string) {
    return this.#read().huntName(slug);
  }
  itemQuantity(id: number) {
    return this.#read().itemQuantity(id);
  }
  ballQuantity(id: number) {
    return this.#read().ballQuantity(id);
  }
  itemCount(id: number) {
    return this.#read().itemCount(id);
  }
  ballCount(id: number) {
    return this.#read().ballCount(id);
  }
  itemName(id: number) {
    return this.#read().itemName(id);
  }
  ballName(id: number) {
    return this.#read().ballName(id);
  }
  onChange(listener: () => void) {
    return this.#listen(listener);
  }
}
