# Contributing

Thanks for helping. This is an **unofficial** community library for [PokeIdle](https://pokeidle.io); please read the
disclaimer in the README first.

## What must never go into this repository

- Anything personal: nicknames, e-mails, passwords, tokens, session data, real account data.
- Dumps of the game (raw packet recordings, the game's source, copied assets). Fixtures are **invented values with the
  shape of the real packets** (see `packages/sdk/test/helpers/fixtures.ts`).
- Code that bypasses the game's own rules (see "Safety" below).

`test/repo-clean.test.mjs` checks part of this, but the review is yours too.

## Setup

```sh
npm ci
npm run build
npm test
```

Node 20 or newer. The checks CI runs, in this order: `npm run format:check`, `npm run build`, `npm run lint`,
`npm run typecheck`, `npm test`, `npm run coverage` (a floor, see `scripts/check-coverage.mjs`). Run `npm run format` to fix
formatting.

`npm run mutation` (about two minutes; also run weekly by CI) breaks the safety-relevant code on purpose, one change at a
time, and fails if the tests do not notice. If you change code listed in `scripts/mutations.mjs`, keep that list in step
(a test fails when an entry no longer applies).

## How the code is organized

Read [docs/architecture.md](docs/architecture.md). In short: a **transport** gets frames, the **client** parses them and
fans them out, **state** keeps the player up to date, **actions** send commands and wait for the game to confirm. The
protocol registry and the catalogs are **generated** from the game's public client (`npm run protocol`,
`npm run catalog`); do not edit `*.generated.ts` by hand.

## Rules for changes

- **English** everywhere: code, comments, docs, commit messages.
- **Tests.** Unit tests only (`node:test`, no browser, no network). A bug fix comes with a test that fails without it.
  Logic that guards money or irreversible actions is expected to be tested at its boundaries.
- **No `console` calls** in the library: errors go through `onError` (`src/errors.ts`).
- **Public API.** What `packages/sdk/src/index.ts` exports is the API. If you change it, run
  `UPDATE_API_SNAPSHOT=1 npm test`, review the snapshot diff, and add a line to [CHANGELOG.md](CHANGELOG.md).
- **Safety.** An action must check what it can before sending, wait for the game to confirm instead of assuming, and
  **fail closed** when it does not know (an unknown is a "no", never a "go ahead"). Irreversible commands need an
  explicit `confirmIrreversible`.
- **Keep the game's names at the edge.** The game's Portuguese field names live in the wire types and in
  `normalizePokemon`-style functions; the rest of the code uses the English model.

## Commits and pull requests

Small, focused commits with a message that says _why_. Open a pull request against `main`; fill in the template. Draft PRs
for early feedback are welcome.

## Reporting that the game changed

The game changes without notice. If a packet or event no longer matches, open the "Game changed" issue with the packet
**type** and the **field names** that differ. Do not paste real packets.
