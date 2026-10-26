import type { CLIENT_COMMAND_TYPES } from './registry.generated.js';
import type { Coverage } from './packet-map.js';
import type { Currency } from './wire.js';

// The commands the game's client sends. Each is a JSON object with a string `t`. A handful have a typed shape (read from
// the client's own call sites); the rest are known by name only and are typed as a plain object, so nothing the client can
// send is "unknown" to the SDK.
//
// Two lists protect against ACCIDENTS (not against someone who really wants to send them: `client.sendRaw` exists):
// - `FORBIDDEN_COMMANDS` cannot be sent through `sendCommand` at all (money leaving the game as cryptocurrency).
// - `IRREVERSIBLE_COMMANDS` can be sent only with `{ confirmIrreversible: true }`: they spend something valuable, sell,
//   destroy or change something that cannot be undone.

export type ClientCommandType = (typeof CLIENT_COMMAND_TYPES)[number];

/** Never sent by `sendCommand`: `orbs.sacar` withdraws orbs as real cryptocurrency to an address. */
export const FORBIDDEN_COMMANDS = ['orbs.sacar'] as const satisfies readonly ClientCommandType[];

/**
 * Commands that cannot be undone or that spend, sell or destroy something valuable. `sendCommand` asks for
 * `{ confirmIrreversible: true }` before sending one. Routine commands (`shop.buy`, `item.use`) are not here.
 */
export const IRREVERSIBLE_COMMANDS = [
  'market.comprar',
  'market.comprarLote',
  'market.criar',
  'loja.comprar',
  'passe.comprarVip',
  'shop.sellPokemon',
  'shop.sellAllPokemons',
  'shop.autoColecao',
  'bolsa.descartar',
  'pokemon.reduzirNivel',
  'pokemon.refinar',
  'pokemon.evoluir',
  'pokemon.mega',
  'pokemon.megaRetroceder',
  'sacrificio.sacrificar',
  'sacrificio.resgatar',
  'tm.aplicar',
  'tm.trocar',
  'mega.fabricar',
  'shinyStone.fabricar',
  'ovoShiny.fabricar',
  'afiliado.recolher',
  'amigo.coins',
  'guild.criar',
  'guild.apagar',
  'guild.sair',
  'guild.expulsar',
  'guild.transferirLider',
  'guild.doar',
] as const satisfies readonly ClientCommandType[];

const FORBIDDEN = new Set<string>(FORBIDDEN_COMMANDS);
const IRREVERSIBLE = new Set<string>(IRREVERSIBLE_COMMANDS);
export const isForbiddenCommand = (type: string): boolean => FORBIDDEN.has(type);
export const isIrreversibleCommand = (type: string): boolean => IRREVERSIBLE.has(type);

/** A command known only by its name. */
export type GenericCommand<K extends string = ClientCommandType> = { readonly t: K; readonly [field: string]: unknown };

export interface TypedCommands {
  // session and keep-alive (seen in real traffic)
  hello: { readonly t: 'hello'; readonly nick: string; readonly token: string; readonly delta: 1; readonly dispositivo: string };
  ping: { readonly t: 'ping' };
  'cliente.economia': { readonly t: 'cliente.economia'; readonly ativo: boolean };
  'bloqueio.lista': { readonly t: 'bloqueio.lista' };
  'chat.historico': { readonly t: 'chat.historico'; readonly canal: string };

  // NPC shop: balls and items are bought by id and quantity (seen in real traffic); pokémon are sold by id
  'shop.buy': { readonly t: 'shop.buy'; readonly kind: 'item' | 'ball'; readonly id: number; readonly qty: number };
  'shop.sellPokemon': { readonly t: 'shop.sellPokemon'; readonly pokemonId: number };
  /** Sells every pokémon up to (and including) this id, following the player's collection rule. */
  'shop.sellAllPokemons': { readonly t: 'shop.sellAllPokemons'; readonly ateId: number };

  // premium shop: products are text ids such as `beast500`
  'loja.comprar': {
    readonly t: 'loja.comprar';
    readonly id: string;
    /** The price you saw: the server refuses the purchase if it changed. Always sent by the game's own client. */ readonly precoVisto: number;
  };

  // player market
  'market.comprar': {
    readonly t: 'market.comprar';
    readonly id: number;
    readonly qtd: number;
    readonly preco: number;
    readonly moeda: Currency;
    readonly sorteioUi?: 1;
  };
  'market.criar': {
    readonly t: 'market.criar';
    readonly tipo: 'item' | 'pokemon';
    readonly itemId?: number;
    readonly pokemonId?: number;
    readonly casaId?: number | null;
    readonly bicicletaId?: number | null;
    readonly qtd: number;
    readonly preco: number;
    readonly moeda: Currency;
    /** listing duration; only pokémon listings take one (items stay up with no deadline) */
    readonly dias: number | null;
  };
  'market.cancelar': { readonly t: 'market.cancelar'; readonly id: number };
  'market.editar': { readonly t: 'market.editar'; readonly id: number; readonly preco: number; readonly moeda: Currency };
  'market.estender': { readonly t: 'market.estender'; readonly id: number; readonly dias: number };
  'market.favoritar': { readonly t: 'market.favoritar'; readonly id: number; readonly ativo: boolean };
  'market.anuncio': { readonly t: 'market.anuncio'; readonly id: number };
  'market.anunciarChat': { readonly t: 'market.anunciarChat'; readonly id: number };
  'market.itens': { readonly t: 'market.itens' };
  'market.item': { readonly t: 'market.item'; readonly itemId: number; readonly moeda: Currency };
  'market.meus': { readonly t: 'market.meus' };
  'market.medias': { readonly t: 'market.medias' };

  // bag
  'item.use': { readonly t: 'item.use'; readonly itemId: number };
  'bolsa.descartar': { readonly t: 'bolsa.descartar'; readonly tipo: string; readonly id: number; readonly qtd: number };
  'orbs.painel': { readonly t: 'orbs.painel' };
}

/** Commands that live in the Mini Games module of the client rather than in its main script. */
export interface MiniGameCommands {
  'mg.entrar': { readonly t: 'mg.entrar'; readonly idioma: string };
  'mg.sair': { readonly t: 'mg.sair' };
  'mg.palpite': { readonly t: 'mg.palpite'; readonly k: number; readonly texto: string };
}

export type ModuleCommandType = keyof MiniGameCommands;

/** Every command the SDK knows, mapped to its type. Commands without a typed shape are `GenericCommand`s. */
export type CommandMap = {
  [K in ClientCommandType]: K extends keyof TypedCommands ? TypedCommands[K] : GenericCommand<K>;
} & MiniGameCommands;

/** Any command the SDK knows. */
export type ClientCommand = CommandMap[keyof CommandMap];

/** The commands `sendCommand` accepts: everything except the forbidden ones. */
export type SendableCommand = Exclude<ClientCommand, GenericCommand<(typeof FORBIDDEN_COMMANDS)[number]>>;

const TRAFFIC_COMMANDS = [
  'hello',
  'ping',
  'cliente.economia',
  'bloqueio.lista',
  'chat.historico',
  'shop.buy',
] as const satisfies ReadonlyArray<keyof TypedCommands>;
const TRAFFIC = new Set<string>(TRAFFIC_COMMANDS);

/** How well a command is known: `traffic` (seen being sent by the real client), `client-code` (read from its call sites) or `name-only`. */
export type CommandCoverage = Coverage | 'name-only';

export function commandCoverage(type: ClientCommandType | ModuleCommandType): CommandCoverage {
  if (TRAFFIC.has(type)) return 'traffic';
  return type in TYPED_NAMES ? 'client-code' : 'name-only';
}

// Names of the commands that have a typed shape (kept next to the types, checked at compile time to be exhaustive).
const TYPED_NAMES: { readonly [K in keyof TypedCommands | ModuleCommandType]: true } = {
  hello: true,
  ping: true,
  'cliente.economia': true,
  'bloqueio.lista': true,
  'chat.historico': true,
  'shop.buy': true,
  'shop.sellPokemon': true,
  'shop.sellAllPokemons': true,
  'loja.comprar': true,
  'market.comprar': true,
  'market.criar': true,
  'market.cancelar': true,
  'market.editar': true,
  'market.estender': true,
  'market.favoritar': true,
  'market.anuncio': true,
  'market.anunciarChat': true,
  'market.itens': true,
  'market.item': true,
  'market.meus': true,
  'market.medias': true,
  'item.use': true,
  'bolsa.descartar': true,
  'orbs.painel': true,
  'mg.entrar': true,
  'mg.sair': true,
  'mg.palpite': true,
};
