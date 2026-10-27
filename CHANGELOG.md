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

- `Pokemon` and `normalizePokemon`; `GameState.pokemon(id)`, `.pokemons`, `.pokemonCount`, `.isActive`, `.isInTeam`,
  `.holdsExpShare` (three-valued: `null` = unknown).
- `state.player` is the same snapshot until the next update.
- `Actions` safety nets: rate limit, per-hour spending cap, one action in flight, cooldown after an unconfirmed action,
  `dryRun`; `buyBall`, `buyItem`, `sellPokemon`.
- Typed protocol registry (packets, battle events, commands) and the items/balls catalogs.
