# Architecture

The SDK is built so that extension authors only think about two things: **reading** what the game sends and
**sending** actions. How frames travel is hidden behind a transport.

```
game WebSocket ──► Transport ──► PokeIdleClient ──► your listeners
                     │                 │
                     │                 └─► Inspector (counts + redacted samples)
                     └─ PageTransport: hooks the page's WebSocket (extensions, userscripts)
```

## Transport

A `Transport` delivers raw text frames and can send one. The core (`PokeIdleClient`) never knows where frames come
from. Today there is one implementation:

- **`PageTransport`** patches `window.WebSocket` inside the page. It must run in the page's own JavaScript world and
  before the game opens its socket: a Manifest V3 content script with `"world": "MAIN"` and `"run_at": "document_start"`.
  The patch is shared through a global symbol, so several extensions can bundle the SDK and the page is patched once.
  The game's socket is the one on the page's own host with the path `/`; other sockets are left alone. Only the current
  socket speaks: when the game opens a new one, the old one is silent (its messages, open and close are not reported) and
  cannot take the transport back by sending. A socket created before the hook is adopted when it first sends, unless the
  transport already follows a live one.

Other hosts (for example an app that reads the socket from outside the page) can implement the same interface.

## Packets

Every frame is a JSON object with a string `t`. `parsePacket` is defensive: anything that is not such an object is
ignored, and oversized frames are dropped. TypeScript types describe what a payload should look like but cannot enforce
it at run time, so typed payloads are added per packet type only after they were verified against real traffic.

## Typed packets and game state

Only packet types verified against real traffic get a typed shape (`welcome`, `estado`; see `protocol/wire.ts`). The raw
types keep the game's own field names and make every field optional, because the server can omit or change anything. For
everyday use read `client.state` (`GameState`) instead: it applies the full state from `welcome` and every `estado` update
(including pokémon and pokédex deltas, as the game sends them), exposes English getters (`gold`, `level`,
`itemCount(id)`, `ballCount(id)`) and ignores malformed data instead of throwing.

Pokémon rows are normalized in one place (`pokemon.ts`, with the small total conversions of `coerce.ts`): `state.pokemon(id)`
and `state.pokemons` return a `Pokemon` with English names and `null` where the server said nothing usable (ids that
arrive as text are understood). Questions with a safety consequence are three-valued: `isActive`, `isInTeam`,
`isInCollection` and `holdsExpShare` return `true`, `false` or `null` for "unknown" (partial state, unreadable held item),
and callers that do something irreversible treat `null` as "no". The state is updated _before_ your packet
listeners run. The full state arrives only once, in `welcome` right after login: code that starts listening later (for
example an extension reloaded with the game already open) only sees updates, and `state.complete` is `false` until the
page reloads.

A new connection invalidates the state. `PokeIdleClient` calls `GameState.markStale()` when the socket opens, closes or the
client stops: `complete` turns `false` and stays so until the next full state. State observers are notified when completeness
is invalidated. Nothing is erased (the last values stay readable),
but actions answer `no-state`. A merge that throws also leaves the state stale, so a half-applied update never looks
complete. All nested state data, normalized lists and server catalogs are frozen private copies: writes throw a `TypeError`,
and the packet a listener holds never aliases them. New `welcome` packets replace catalogs, including clearing omitted
catalogs and protection metadata. A client/transport belongs to one account; routing across accounts belongs to the host.
Callbacks from a stopped or older client run are ignored, even after restart.

`itemQuantity`/`ballQuantity` distinguish unknown (`null`, including malformed/negative quantities) from zero (an absent
id in a known inventory map). The legacy `itemCount`/`ballCount` retain their existing contract. `player-details.ts`
normalizes selected automation ids and Twitch facts; `GameState.automation` and `.twitch` cache frozen, privately owned
snapshots until the next state update. `inCenter` preserves unknown as `null`. Twitch keeps the reported field names and
does not infer live status, channel or live count from another field. Numeric text is understood, invalid booleans stay
unknown, and UI-specific caps are intentionally absent.

## The protocol registry

`protocol/registry.generated.ts` lists every packet type the game's client handles, every battle event kind and every
command it sends, plus the field names it reads from each received packet. `scripts/generate-protocol.mjs` extracts it from
the client's own source (names only, never code): the branches of the client's `onmessage`, the `case`s of its battle
event handler and the `{ t: '...' }` literals it sends. Comments are stripped first, and the generator fails loudly if the
client changes shape. `npm run protocol:check` reports drift.

Each entry has a coverage level (`PACKET_COVERAGE`, `battleEventCoverage`, `commandCoverage`): `traffic` when the fields
were verified in real traffic, `client-code` when only the client's field names are known, `name-only` for commands
without a typed shape. A few commands are deliberately left name-only so the SDK does not make them easy to send by
accident (for example the one that withdraws orbs as real cryptocurrency). `PACKET_COVERAGE` is exhaustive at compile
time, so a packet type the game adds cannot go unclassified.

## Errors

One path for everything the SDK cannot throw to anyone (`errors.ts`). `ClientOptions.onError` is handed to the transport
(`PageTransport` guards its handlers), to `GameState` (change callbacks) and to the client's listener dispatch, so a
throwing listener never stops the others or the state update. Without `onError` the default handler writes to the
console, the only `console` call in the library. If `onError` itself throws, the original error goes to the default
handler: reporting never throws. Actions also report uncertain transport-send failures through this path rather than
silently converting them to success or a definite refusal.

## Actions

`Actions` (`actions.ts`) sits on top of `sendCommand` and depends on the `ActionsHost` interface (`actions-host.ts`: the
connection, a narrow slice of the state, listening and sending), not on the client class; `PokeIdleClient` implements it
and a test double can too. The rest lives in small modules: `actions-types.ts` (requests, results, options),
`actions-options.ts` (defaults), `rate-limiter.ts`, `spend-ledger.ts` (the hourly cap), `pricing.ts` (what the shop
charges), `wait-for-first.ts` (wait for the first of several signals and clean up listeners and timers),
`confirmations.ts` (what counts as a confirmed purchase or sale) and `sale-rules.ts` (what the Depot may sell). A purchase goes through: input validation (throws), one-in-flight,
connection and full-state checks, price and gold checks from the catalogs the server sent, the optional spending cap and
the rate limit, then the send. It listens for the answer BEFORE sending (the answer can be instant) and resolves with the
first of: the game's `compra` event (same quantity and, when known, same name), the inventory growing, an `erro` packet or
the timeout. The inventory alone is a weak signal (balls used in the hunt at the same time can hide a small purchase),
so the event is preferred. It was verified in real traffic: the `compra` event is emitted for NPC-shop purchases, with
`nome`, `qtd` and `gasto`, and arrives before the `estado` update. The purchase is already confirmed at that point, but the
answer waits up to `confirmGraceMs` (default 1 s, shared with sales) for the inventory update. `Actions` also reserves an
inventory floor per item for every sent or possibly sent order, so an update delayed beyond that grace cannot confirm a
later order. These floors are conservative when items are consumed or an order is rejected; matching events remain usable.
One host-lifetime connection subscription resets the floors between sessions; waiters own and release per-order subscriptions.
`confirmedBy` records
which signal confirmed. A timeout, or a connection that drops or is replaced while waiting (`ActionsHost.onConnectionChange`), is `unconfirmed`, not a failure: the order may be late, so the next
one waits (default 30 s), the same rule the Companion app uses after more than 57 000 real purchases.

Selling (`sellPokemon`) goes through the same `dispatch` (one in flight, rate limit, waiting after an unconfirmed or
rejected order). Before sending it applies the game's own rules for the Depot, read from the client (`sale-rules.ts`, through the state's
three-valued queries): not the active pokémon, not in the team, not in the Collection, not holding the Exp. Share. The sale is confirmed by the `venda` event or by the pokémon leaving the list. The event
(verified in real traffic: `{ k: 'venda', nome: 'Charmander Nv 20', ganho: 4573, qtd: 1 }`) names the pokémon WITH its level, and
nothing else, so it is matched on name and level and counts as `certain` only when no other pokémon of yours has that same
name and level (otherwise `probable`); a shiny mark in the name is ignored;
when the list arrives first the SDK waits a short grace window (`confirmGraceMs`) so the gold is not lost to packet order.
It fails closed: when any of those queries answers `null` (a partial state, an unreadable held item), the answer is
"not sellable". The sale price comes from a function the client shares with the server and is not readable
from the page script, so a dry run does not estimate it: the gold comes back in the `venda` event.

The prices of purchases come from the catalogs: balls from the server's ball catalog (`priceGold`), shop items from the welcome packet,
and potions and revives from a small generated table (`catalog/npc-shop.generated.ts`, from the item catalog's `npcPrice`, checked against real purchases).

A transport may return a boolean or a promise of one; the client preserves that type through its existing generic.
`false` means definitely not sent, `true` only acceptance, and transport failures have an uncertain outcome. Actions reserve
one in-flight slot before sending, listen before the send, and count budgets at settlement so a delayed acknowledgement
cannot expire its own limits. There is no launcher-specific projection, account model or dependency-injection container in
the SDK.

Per-call `ActionCallOptions.onSend` observes dispatch separately from reconciliation. `SendOutcome` distinguishes
`accepted`, `not-sent` and `uncertain` (with the original `unknown` error). Internal floors and budgets are recorded before
the observer runs; the action remains in flight while it runs, and the terminal result is delivered afterward. A guard
inside dispatch reports `not-sent` before rejecting; preflight refusals and dry runs have no dispatch to observe.
Observers use the standard guarded error path and cannot change the send outcome or abandon reconciliation.
The hook is synchronous, not a transaction/persistence callback. A host that needs durable accounting owns persistence
and recovery if that write fails. The later evidence may confirm an uncertain send; neither acceptance nor the matching
event's `certain` classification proves request-id correlation, which this protocol does not provide.

## Responsibility boundaries

| SDK                                                               | Host / application                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Frame parsing, protocol shapes and game-state normalization       | Account/source selection, operational health timers and UI projections |
| Shop facts and game eligibility rules                             | Feature selection, presentation categories, sorting and caps           |
| One-shot action dispatch and conservative evidence reconciliation | Persistent account budgets, automation scheduling and retry policy     |
| Transport contract and the page WebSocket hook                    | CDP/IPC routing, replaced-webview filtering and sandbox allowlists     |

`Actions` safety defaults are optional per-instance protections, not an account persistence layer or automation runner.
A host can turn off rate limits while retaining reconciliation and supply its own durable policy. Local JSON
canonicalization and an application-specific command allowlist are legitimate sandbox checks, not a duplicate protocol
implementation to move into the SDK.

`state.player` and typed packet listeners are supported low-level APIs, not access to private state. Prefer normalized
getters for common facts so features do not each reinterpret wire fields. Keep protocol access in an adapter when a
normalized projection is unavailable. A page extension should use `PageTransport`, `on('market')` and `sendCommand`
instead of installing its own WebSocket proxy and JSON parser. DOM access, client-adjusted page data and consumer
calculations remain local adapters unless a reusable, verified game contract justifies an SDK API.

## Sending commands

`sendCommand` is the low-level sender. Its guards (`protocol/send-guard.ts`) are about accidents: a forbidden command is
refused, an irreversible one needs an explicit confirmation, and malformed numbers are rejected before they reach the
socket. They work on the run-time value, so they also protect callers that bypass the types. They are not a security
boundary: nothing stops code that uses `sendRaw`. Both lists are checked against the registry by a test, so a typo or a
renamed command cannot silently protect nothing.

## Catalogs and enums

`Item` and `Ball` map names to ids. Items come from the game's public items catalog; balls are not in that file (the server
sends them in `welcome`), so they come from a small snapshot in `packages/sdk/data/balls.json`, which the test extension can
copy for you. `npm run catalog` regenerates `src/catalog/*.generated.ts`; `npm run catalog:check` reports drift. When two
items share a name the lowest id keeps the clean key and the others get `_<id>`. The full catalogs are large, so the
client does not depend on them: `GameState.itemName` uses only what the server sent plus the generated NPC-shop table
(`npc-shop.generated.ts`, potions and revives). Importing `Item`, `itemInfo` and friends is what brings the catalog in. A test bundles the client
and `PageTransport` (about 30 KB minified) and fails above 40 KB or if catalog data sneaks in.

## Redaction

Packets contain session tokens, e-mails and player names. Everything the SDK records (`Inspector`) is redacted when it is
recorded, never later: sensitive keys are replaced, free text is cleaned and arrays and depth are limited. Samples of
packets with content written by other people (chat, friends, rankings, guilds...) keep only their structure, and the
account id (`estado.id`) is masked by path. The events inside a `batalha` packet (`samples.batalha`) get the same per-event
masking as `battleEventSamples`, so text that one masks is not readable in the other. The redaction is a safety net, not a guarantee: read a dump before sharing it. Raw recordings
must never be committed (`recordings/` is ignored); only sanitized fixtures belong in the repository.

## Public API and checks

`src/index.ts` is an explicit export list, not `export *`, so adding a file never widens the API by accident. A test
snapshots every exported name and signature (`UPDATE_API_SNAPSHOT=1` rewrites it after an intended change). Beyond the
unit tests: `npm run coverage` enforces a coverage floor and `npm run mutation` applies deliberate bugs to the safety code
and demands that the tests fail. CI runs them with lint and typecheck; a weekly workflow checks game drift
(`catalog:check`, `protocol:check`) and runs the mutation check, with CodeQL and Dependabot alongside.

## Compatibility

The game's protocol is private and can change at any time. The SDK is the single place to adapt: packets are read
defensively, unknown types are reported by the inspector instead of failing, and fixtures from real traffic (sanitized)
are used to catch format changes.

## Distribution

The official SDK build compiles ESM and declarations, then `scripts/build-bundles.mjs` emits self-contained CommonJS
(`dist/index.cjs`), portable CJS declarations (`dist/cjs/`) and a minified browser IIFE (`dist/pokeidle-sdk.iife.js`,
`globalThis.PokeIdleSDK`). Merely loading the browser script does not patch WebSocket: the consumer explicitly starts a
client with `PageTransport`. It must load in the page's MAIN world at document start. All runtime exports/catalogs are
present in the IIFE; ESM consumers can still tree-shake unused catalogs. Distribution tests execute the browser
market receive/send path without a module loader and relocate ESM/CJS/types outside the checkout.
