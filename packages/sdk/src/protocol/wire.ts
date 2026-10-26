import type { Packet } from '../packets.js';

// Raw shapes of the packets, exactly as the game sends them (the field names are the game's own, mostly Portuguese).
//
// Policy: every field is optional except the discriminants (`t`, `k`). The server can omit or change anything, and
// TypeScript cannot check data at run time, so nothing here is a promise. Read through `GameState` when you can: it is
// defensive. Types in this file describe what was SEEN IN REAL TRAFFIC (coverage level `traffic`, see `coverage.ts`).

export type Currency = 'gold' | 'orb';

export interface BallCatalogEntryWire {
  id?: number;
  nome?: string;
  catchRate?: number;
  priceGold?: number;
  compravel?: boolean;
}

export interface ShopItemWire {
  itemId?: number;
  preco?: number;
  nome?: string;
}

/** An item that belongs to this game and is not in the public items catalog (boss tokens, eggs, fragments, mega stones...). */
export interface ExtraItemWire {
  id?: number;
  name?: string;
  icon?: string;
  category?: string;
  rare?: boolean;
  npcPrice?: number;
}

export interface HuntWire {
  slug?: string;
  nome?: string;
  area?: string;
  nivel?: number;
  especies?: Array<{ pokeId?: number; nome?: string; pontos?: number }>;
  totalSpawns?: number;
}

export interface StatsWire {
  hp?: number;
  atk?: number;
  def?: number;
  spAtk?: number;
  spDef?: number;
  speed?: number;
}

/** One of the player's pokémon. Complete in `welcome`; in `estado` the changed ones arrive in `pkMud`. */
export interface PokemonWire {
  /** Numeric in everything seen so far (the state also accepts text ids defensively). */
  id?: number;
  speciesId?: number;
  nome?: string;
  looktype?: number;
  lookShiny?: number | null;
  tipos?: string[];
  level?: number;
  xp?: number;
  xpNivel?: number;
  xpProximo?: number;
  quality?: number;
  potencia?: number;
  shiny?: boolean;
  slot?: number;
  hp?: number;
  maxHp?: number;
  poder?: number;
  nota?: number;
  stats?: StatsWire;
  ivs?: StatsWire;
  refino?: StatsWire;
  refinoTotal?: number;
  tmElemental?: string | null;
  tmAoe?: boolean;
  heldItemId?: number | null;
  starter?: boolean;
  caughtAt?: number;
  caughtBy?: boolean;
  pisoNivel?: number;
  [key: string]: unknown;
}

export interface AutomationWire {
  autoBallAteCapturar?: boolean;
  autoBallSemParar?: boolean;
  ballIds?: number[];
  autoRevive?: boolean;
  reviveIds?: number[];
  autoPotion?: boolean;
  potionIds?: number[];
  hpLimiar?: number;
  pokemonTravado?: number[];
  pvpAutoFila?: boolean;
  autoLockShiny?: boolean;
  autoLockNota9?: boolean;
  autoLockNotaMin?: number;
  autoLockP5?: boolean;
  autoVoltarHunt?: boolean;
  desistiuHunt?: boolean;
  bossAuto?: boolean;
  bossAutoKey?: string;
  [key: string]: unknown;
}

/** The player's state. In `welcome` it is complete (`cheio: true`); in `estado` it is a delta with only what changed. */
export interface PlayerStateWire {
  cheio?: boolean;
  id?: number;
  nick?: string;
  level?: number;
  xp?: number;
  xpNivel?: number;
  xpProximo?: number;
  gold?: number;
  diamonds?: number;
  orbs?: number;
  huntSlug?: string | null;
  outlandTier?: number;
  noCentro?: boolean;
  centroMotivo?: string | null;
  centro?: { sala?: number; capacidade?: number } | null;
  centroLivreEm?: number;
  ondaSeq?: number;
  combateOndaSeq?: number;
  activeId?: number;
  servidorAgora?: number;
  /** item id -> quantity (keys are numeric strings). Treated as a complete map when it arrives. */
  items?: Record<string, number>;
  /** ball id -> quantity. Treated as a complete map when it arrives. */
  balls?: Record<string, number>;
  automation?: AutomationWire;
  /** Full list (welcome) of the player's pokémon. */
  pokemons?: PokemonWire[];
  /** Delta: pokémon that changed or appeared / ids that left. */
  pkMud?: PokemonWire[];
  pkFora?: number[];
  /** Delta of the pokédex: entries that changed / keys that left. */
  dexMud?: Record<string, { k?: number; c?: number; sv?: number }>;
  dexFora?: string[];
  pokedex?: Record<string, { k?: number; c?: number; sv?: number }>;
  loja?: { vipAte?: number; vip?: boolean; boosts?: Record<string, number>; [key: string]: unknown };
  bonusXp?: { tr?: number; pk?: number; partes?: Array<{ id?: string; tr?: number; pk?: number; ate?: number }> };
  twitch?: { login?: string; aoVivo?: boolean; assistindo?: boolean; pct?: number; extra?: number; [key: string]: unknown };
  kick?: { login?: string; vinculado?: boolean; pct?: number; minutos?: number; [key: string]: unknown };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------------------------------------------------
// welcome

export interface WelcomePacket extends Packet {
  readonly t: 'welcome';
  readonly admin?: boolean;
  readonly chatMod?: boolean;
  readonly chatCmd?: boolean;
  readonly chatFixar?: boolean;
  readonly chatInterromper?: boolean;
  readonly estado?: PlayerStateWire;
  readonly hunts?: HuntWire[];
  readonly catalogoBolas?: BallCatalogEntryWire[];
  readonly itensCompraveis?: ShopItemWire[];
  /** The game's own items (not in the public items catalog). */
  readonly itensNossos?: ExtraItemWire[];
  readonly potencias?: Array<{ n?: number; chance?: number; bonus?: number }>;
  readonly shinyLooks?: Record<string, number>;
  readonly chanceShiny?: number;
  readonly misticoPool?: number[];
  readonly safariPool?: number;
  readonly maxEquipe?: number;
  /** Type effectiveness: attacker type -> defender type -> multiplier. */
  readonly tabelaTipos?: Record<string, Record<string, number>>;
  readonly multHpSelvagem?: number;
  readonly multDanoSelvagem?: number;
  readonly itensTipos?: Record<string, string>;
  readonly pedrasEvolucao?: Record<string, { itemId?: number; nome?: string }>;
  readonly outlandTiers?: Array<{ tier?: number; rotulo?: string; nivel?: number; mult?: number }>;
  readonly economia?: {
    orbCompraUsdt?: number;
    orbSaqueUsdt?: number;
    spreadPct?: number;
    saqueMinimo?: number;
    taxaMercadoOrbPct?: number;
    taxaMercadoGoldPct?: number;
    faixasMercadoOrb?: Array<{ ate?: number | null; pct?: number }>;
    taxaDiariaMercado?: number;
    maxAnuncios?: number;
    xpPerdidoPct?: number;
    [key: string]: unknown;
  };
  readonly mercado?: {
    catalogo?: Array<{ id?: number; nome?: string; categoria?: string; tipo?: string | null; npc?: number }>;
    categorias?: string[];
    pokemonMin?: { level?: number; nota?: number };
    taxaDiaria?: number;
    diasMin?: number;
    diasMax?: number;
    precoMinOrb?: number;
    precoMinGold?: number;
    taxaOrbPct?: number;
    taxaGoldPct?: number;
    cooldownCompraMs?: number;
    maxAnunciosPokemon?: number;
    [key: string]: unknown;
  };
  readonly lojaProdutos?: Array<{ id?: string; cat?: string; grupo?: string; nome?: string; preco?: number; descricao?: string; [key: string]: unknown }>;
  readonly captura?: { base?: number; piso?: number; teto?: number; raridadeDiv?: number; precoSemPreco?: number; porDegrau?: Record<string, number> };
  readonly mega?: { fragmentoId?: number; custo?: number; pedras?: Array<{ dex?: number; nome?: string; pedra?: string; megaPokeId?: number; itemId?: number; itemShinyId?: number }>; [key: string]: unknown };
  readonly bossesCatalogo?: Array<{ key?: string; name?: string; pokeId?: number; level?: number; type1?: string; type2?: string | null; [key: string]: unknown }>;
  readonly bossesJogaveis?: Array<{ key?: string; nome?: string; level?: number; entrada?: { itemId?: number; nome?: string; qtd?: number }; [key: string]: unknown }>;
}

export interface StatePacket extends Packet {
  readonly t: 'estado';
  readonly estado?: PlayerStateWire;
}

// ---------------------------------------------------------------------------------------------------------------------
// the field (the hunting map)

/** Hero or trainer on the map. `c`/`r` are the column and row, `dc`/`dr` the destination, `d` the direction. */
export interface ActorWire {
  c?: number;
  r?: number;
  dc?: number;
  dr?: number;
  d?: number;
  em?: number;
  ms?: number;
  /** trainer only: outfit and its colours */
  lt?: number;
  vs?: number[];
}

/** A wild pokémon on the map. */
export interface MobWire {
  /** slot id */
  s?: number;
  c?: number;
  r?: number;
  dc?: number;
  dr?: number;
  d?: number;
  em?: number;
  ms?: number;
  hp?: number;
  mhp?: number;
  x?: number;
  lt?: number;
  n?: string;
  nv?: number;
  sh?: number;
}

export interface FieldInitPacket extends Packet {
  readonly t: 'campo.init';
  readonly slug?: string;
  readonly mapa?: string;
  readonly ts?: number;
  readonly box?: number[];
  readonly groundZ?: number;
  readonly heroi?: ActorWire;
  readonly treinador?: ActorWire;
  readonly mobs?: MobWire[];
  readonly alvo?: number | null;
}

export interface FieldPacket extends Packet {
  readonly t: 'campo';
  readonly seq?: number;
  readonly ts?: number;
  readonly alvo?: number | null;
  readonly heroi?: ActorWire;
  readonly treinador?: ActorWire;
  readonly mobs?: MobWire[];
  /** slots that left the map */
  readonly fora?: number[];
}

// ---------------------------------------------------------------------------------------------------------------------
// chat and social

export interface ChatMessageWire {
  id?: string;
  canal?: string;
  idioma?: string;
  de?: string;
  texto?: string;
  ts?: number;
  cargo?: string;
  nivel?: number;
  guildId?: number;
  guildTag?: string;
  guildTagCor?: string;
  /** a market listing announced in the chat */
  anuncioChat?: {
    id?: number;
    tipo?: string;
    qtd?: number;
    preco?: number;
    moeda?: Currency;
    itemId?: number | null;
    numerado?: boolean;
    nome?: string;
    level?: number;
    shiny?: boolean;
  };
  /** a shared pokémon */
  pkShare?: { nick?: string; nome?: string; apelido?: string | null; pokemonId?: number };
  tagDiscord?: { qtd?: number; dias?: number; nick?: string };
  [key: string]: unknown;
}

export interface ChatPacket extends Packet, ChatMessageWire {
  readonly t: 'chat';
}

export interface ChatHistoryPacket extends Packet {
  readonly t: 'chat.historico';
  readonly canal?: string;
  readonly mensagens?: ChatMessageWire[];
}

export interface ChatPinnedListPacket extends Packet {
  readonly t: 'chat.fixadas';
  readonly lista?: Array<{ canal?: string; idioma?: string; msg?: ChatMessageWire; por?: string; em?: number }>;
}

export interface ChatPinnedPacket extends Packet {
  readonly t: 'chat.fixada';
  readonly canal?: string;
  readonly idioma?: string;
  readonly fixada?: { msg?: ChatMessageWire; por?: string; em?: number } | null;
}

export interface ChatDeletedPacket extends Packet {
  readonly t: 'chat.del';
  readonly id?: string;
  readonly por?: string;
}

export interface ChatStoppedPacket extends Packet {
  readonly t: 'chat.interrompido';
  readonly estado?: unknown;
  readonly aoVivo?: unknown;
}

export interface FriendsPacket extends Packet {
  readonly t: 'amigos';
  readonly lista?: unknown[];
  readonly pedidos?: unknown[];
  readonly max?: number;
}

export interface BlocklistPacket extends Packet {
  readonly t: 'bloqueios';
  readonly lista?: unknown[];
  readonly max?: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// market, rankings, announcements

/** Average price over recent sales, by currency, for each item id. */
export type MarketAverages = Record<string, Partial<Record<Currency, { media?: number; unidades?: number }>>>;

export interface MarketPacket extends Packet {
  readonly t: 'market';
  readonly aba?: string;
  readonly medias?: MarketAverages;
  readonly linhas?: unknown[];
  readonly resumo?: unknown;
  readonly pagina?: number;
  readonly seq?: number;
  readonly itemId?: number;
  readonly moeda?: Currency;
}

export interface RankingCardPacket extends Packet {
  readonly t: 'ranking.ficha';
  readonly pokemon?: PokemonWire & { dono?: string };
}

export interface ShinyCapturePacket extends Packet {
  readonly t: 'shiny.captura';
  readonly nick?: string;
  readonly looktype?: number;
  readonly vs?: number[];
  readonly pokemon?: { id?: number; nome?: string; speciesId?: number; level?: number; looktype?: number };
}

export interface RaidPacket extends Packet {
  readonly t: 'raid';
  readonly agora?: number;
  readonly edicao?: { id?: string; numero?: number; dia?: string; inscricoesDe?: number; inscricoesAte?: number; equipeAte?: number; batalhaEm?: number; transmissaoEm?: number; fimEm?: number; fase?: string };
  readonly gigantamax?: { dex?: number; slug?: string; nome?: string; tipos?: string[]; hpMax?: number; [key: string]: unknown };
  readonly maxEquipe?: number;
  readonly inscritos?: number;
  readonly eu?: { inscrito?: boolean; inscritoEm?: number; equipeIds?: number[] };
  readonly batalha?: unknown;
  readonly resultado?: unknown;
}

export interface GuildPacket extends Packet {
  readonly t: 'guild';
  readonly bancoAoVivo?: { guildId?: number; banco?: number; ciclo?: number; doacao?: { id?: number; nick?: string; qtd?: number; em?: number; ciclo?: number }; eu?: boolean };
}
