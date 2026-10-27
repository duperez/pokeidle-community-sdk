# Changelog

All notable changes to `pokeidle-community-sdk` are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning

The SDK follows [Semantic Versioning](https://semver.org/). Until `1.0.0`, **minor** versions (`0.x.0`) may contain breaking
changes and **patch** versions (`0.0.x`) never do. What counts as the public API is exactly what `src/index.ts` exports:
the list is pinned by `packages/sdk/test/api-surface.snapshot.json`, so an export cannot be added or removed by accident,
and every such change must appear below. Anything marked `@internal` is not part of it.

The SDK reads a game that changes without notice. A change in the game's packets that needs a code change is a **patch**
(or a minor, if it forces a breaking change in our types) and is listed under "Game compatibility".

## [Unreleased]

### Fixed

- Stopping a client now invalidates completeness, notifies observers and ends pending orders conservatively; callbacks
  retained from a previous run cannot feed a restarted client. Failed starts detach partial subscriptions and can be retried.
- All nested state data, normalized lists and server catalogs are privately owned and frozen, not just decision fields.
  A new `welcome` clears catalogs/protection metadata omitted by the new session.
- Purchases reserve expected inventory across orders, preventing a delayed update from confirming another purchase even
  after `confirmGraceMs` expires. Connection boundaries reset those expectations.
- Uncertain send failures are reported through `onError` and counted conservatively, including synchronous transport
  failures. Budgets start when the send result settles rather than at an attempt timestamp that may already have expired.
- Aggregate battle samples preserve truncation and mask malformed events instead of retaining their free text.

- A new connection no longer reuses the old session's state: `state.complete` turns `false` when the socket closes or a new
  one opens, so actions answer `no-state` until the next `welcome`. An order waiting for the game when the connection
  drops ends as `unconfirmed` (and the next action waits).
- A socket the game has replaced no longer feeds the client (its late messages and its `close` are ignored), and it cannot
  take the transport back by sending.
- A purchase confirmed by the `compra` event now waits (up to `confirmGraceMs`) for the inventory update that follows, so
  that late update cannot be taken as the evidence of the next purchase of the same item.
- `state.player`, the inventory, the Collection and every pokémon row are frozen private copies: neither a listener that
  holds the packet nor a caller can change what the SDK decides on.
- `Inspector.dump().samples.batalha` applies the same per-event masking as `battleEventSamples` (a guild name stayed readable).

- If applying a packet to the state fails half way, the state turns stale (`complete` is `false`) instead of staying complete
  with mixed data. A socket the hook never saw cannot take the transport from a live successor by sending.

### Breaking (hardening)

- The inventory, the Collection and the pokémon rows in `state.player` are frozen: a write from your code now throws
  `TypeError` (in strict mode) instead of silently changing what the SDK reads. `client.stop()` followed by `client.start()`
  on an open socket leaves `state.complete` false until the next `welcome` (a page reload).

### Added (hardening)

- `GameState.markStale()`.
- `GameState.huntName(slug)`: the display name of a hunt from the `welcome` packet's hunt list (`null` when unknown).
- `npcShopPrice(itemId)`: what the NPC shop charges for a potion or revive, `null` for anything it is not known to sell. Narrower
  than `itemInfo(id).npcPrice` (rare items such as Max Revive and Golden Potion have an `npcPrice` but no shop sells them);
  it is the table the SDK's own purchases use.
- Asynchronous transports: `Transport<S>` and `PokeIdleClient<S>` are generic over what `send` returns
  (`SendResult` = `boolean | Promise<boolean>`, default `boolean`, so existing code and `PageTransport` are unchanged).
  `client.sendRaw`/`sendCommand` return the transport's own type; `Actions` awaits a promise. The guards still throw
  synchronously before anything is sent. If the transport's promise **rejects**, the order is treated as "maybe sent": the
  rate and spending budgets are charged and, if the game never answers, it ends `unconfirmed` (which also starts the
  cooldown). A transport should resolve `false`, not reject, when it knows nothing was sent. A send promise must eventually
  settle: one that never does keeps that `Actions` instance busy (every later action answers `busy`).

### Changed

- `PokeIdleClient.onBattle` is now `onAnyBattleEvent` (it listens to every battle event; `onBattleEvent(kind, …)` is unchanged).
- `GameState.isInCollection(id)` returns `boolean | null`: `null` means the Collection is not known. `collectionKnown` is gone.
- `ClientOptions.onError` now also receives errors from state listeners and transport handlers, and a handler that throws
  falls back to the default (console) handler instead of escaping.
- `export *` from the protocol modules is now an explicit list.
- `GameState.itemName(id)` no longer consults the full items catalog (it knows the server's names and the NPC shop's potions
  and revives); use `itemInfo(id)?.name` for any item. In exchange the client + page transport bundle shrank from about
  133 KB to 30 KB minified, and a test keeps it under 40 KB.
- The catalog lookups (`itemInfo`, `ballInfo`) build their index on first use, so importing the package no longer keeps the
  catalog in a bundle that does not use it.

### Added

- Reproducible CommonJS bundle (`dist/index.cjs`) and portable CommonJS declarations (`dist/cjs/`) alongside the ESM build.
  Conditional package exports select the matching declarations. An external-consumer test checks relocated ESM/CJS
  execution and TypeScript usage without access to this source checkout.
- `GameState.itemQuantity(id)` / `.ballQuantity(id)` preserve unknown inventory as `null` instead of conflating it with
  zero; the existing count helpers remain compatible. Frozen normalized `automation` / `twitch` snapshots, three-valued
  `inCenter`, and public `AutomationState`, `TwitchState`, `TwitchChannel` types remove wire coercion from consumers.
  Twitch retains reported field names, handles numeric text and both watching-channel shapes, without UI truncation.
- Per-call `ActionCallOptions.onSend` and `SendOutcome` expose dispatch acceptance (`accepted`, `not-sent`, `uncertain`)
  before an action's terminal result, without replacing game-evidence reconciliation or changing `BuyResult`/`SellResult`.
  The original error accompanies uncertain sends; observer failures use `onError` and cannot cancel the order.
- Official browser IIFE `dist/pokeidle-sdk.iife.js`, exposing `globalThis.PokeIdleSDK` without starting interception
  automatically. The same build produces ESM/CJS/types; a loader-free distribution test exercises market receive/send.

- `Pokemon` and `normalizePokemon`; `GameState.pokemon(id)`, `.pokemons`, `.pokemonCount`, `.isActive`, `.isInTeam`,
  `.holdsExpShare` (three-valued: `null` = unknown).
- `state.player` is the same snapshot until the next update.
- `Actions` safety nets: rate limit, per-hour spending cap, one action in flight, cooldown after an unconfirmed action,
  `dryRun`; `buyBall`, `buyItem`, `sellPokemon`.
- Typed protocol registry (packets, battle events, commands) and the items/balls catalogs.
