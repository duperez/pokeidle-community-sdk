# Architecture

The SDK lets extension authors **read** what the game sends and **send** supported actions through the game's existing
WebSocket. A single internal page session owns capture, parsing, current state and action coordination. Consumers
neither supply a socket nor select a transport. The SDK opens no parallel game connection and does not own login or
reconnection.

```
game WebSocket -> MAIN page session -> one parser/state/action coordinator
                            |                          |
                            +-> client A facade -> local listeners/Inspector
                            +-> client B facade -> local listeners/Inspector
client actions -> shared writer -> current socket's original send
```

## Bootstrap and consumer attachment

Install capture in the page's own JavaScript MAIN world at `document_start`, before the game opens its socket.
The [standalone example](../examples/test-extension/README.md) uses an MV3 content script with `"world": "MAIN"` and
`"run_at": "document_start"`; it needs no launcher, Electron or CDP.

```ts
import { bootstrapPageSession, PokeIdleClient } from 'pokeidle-community-sdk';

bootstrapPageSession();
const client = new PokeIdleClient({ onError: handleSdkError });
client.state.onChange(() => render(client.state));
client.start();
```

`bootstrapPageSession(options?: BootstrapOptions): void` installs or adopts the runtime independently of clients.
`new PokeIdleClient(options?: ClientOptions)` is inert: no hook, socket, DOM access or global subscription.
`start(): void` attaches synchronously and idempotently; if no bootstrap exists it ensures one with defaults.
That convenience cannot recover traffic missed before installation. `stop(): void` detaches only that facade.

The internal hook preserves native WebSocket construction and uses the page's host and path `/`, with `ws:`/`wss:`
schemes, to recognize the game socket. Other sockets are left alone. A new eligible socket becomes authoritative
immediately, including while CONNECTING; replaced sockets cannot feed state, announce a close or take ownership back.
A socket created before capture can be adopted on its first observed send if no live successor is followed. There is
no enumeration of already-open idle sockets, reconstruction of a missed welcome, automatic login or hidden query.

### Sharing, policy and compatibility

Sharing covers one document's MAIN global: compatible independently evaluated bundles reuse the hook, parser, state
and writer. It does not cover other globals, frames, isolated worlds, profiles or processes. No cross-extension broker
or isolated-world bridge is implemented by this API.

The stable `Symbol.for('pokeidle-community-sdk.page-session')` rendezvous validates ABI 1 and capabilities
`shared-state`, `shared-writer` and `consumer-lifecycle` before reuse. Package-version equality alone is not the
compatibility test. Incompatible/malformed entries and an existing legacy hook fail explicitly without replacing the
live runtime or stacking a second hook. The slot is an internal rendezvous, not a public socket handle or a security
boundary against page JavaScript.

`BootstrapOptions` owns shared `maxPacketBytes` and `actions` policy. Defaults are normalized and nested values copied
and frozen. A repeated explicit bootstrap must match the installed policy; otherwise it throws
`PageSessionError` with `code: 'configuration-conflict'`. `start()` adopts existing policy without reapplying defaults.
`ClientOptions` contains only local `inspector` and `onError`; constructor `transport`, `actions` and `maxPacketBytes`
are rejected, including in JavaScript. Public action options do not expose a test scheduler.

The last detach does not unpatch or stop collection. The runtime keeps current/last-known state, bounded diagnostics
where configured and pending reconciliation, not a raw event/frame replay log. Document destruction ends that runtime.

| Transition                                       | Observable contract                                                                                            |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Attach after an early collected complete welcome | Immediately current state; no synthetic welcome or historical domain events.                                   |
| Attach without a collected complete welcome      | May be connected but remains incomplete; actions refuse with no-state.                                         |
| Adopt a new socket, even CONNECTING              | Generation advances and completeness is invalidated before consumers are notified.                             |
| Current socket opens                             | Connected becomes true; complete stays false until a valid full welcome.                                       |
| Current socket closes                            | State becomes stale before notification; no automatic retry of commands.                                       |
| Stop one facade                                  | Its connected/complete become false; its last-known snapshot remains readable; peers and game socket continue. |
| Restart that facade                              | Adopts continuously maintained current state; old-run callbacks and commands are not replayed.                 |
| Last facade stops                                | Capture and shared risk accounting continue for later attachment.                                              |

## Packets

Every frame is a JSON object with a string `t`. `parsePacket` is defensive: anything that is not such an object is
ignored, and oversized frames are dropped. TypeScript types describe what a payload should look like but cannot enforce
it at run time, so typed payloads are added per packet type only after they were verified against real traffic.

## Typed packets and game state

Only packet types verified against real traffic get a typed shape (`welcome`, `estado`; see `protocol/wire.ts`). The raw
types keep the game's own field names and make every field optional, because the server can omit or change anything. For
everyday use read `client.state` (a read-only `StateView`) instead: the runtime applies the full state from `welcome` and every `estado` update
(including pokémon and pokédex deltas, as the game sends them), exposes English getters (`gold`, `level`,
`itemCount(id)`, `ballCount(id)`) and ignores malformed data instead of throwing.

Pokémon rows are normalized in one place (`pokemon.ts`, with the small total conversions of `coerce.ts`): `state.pokemon(id)`
and `state.pokemons` return a `Pokemon` with English names and `null` where the server said nothing usable (ids that
arrive as text are understood). Questions with a safety consequence are three-valued: `isActive`, `isInTeam`,
`isInCollection` and `holdsExpShare` return `true`, `false` or `null` for "unknown" (partial state, unreadable held item),
and callers that do something irreversible treat `null` as "no". The state is updated _before_ your packet
listeners run. Early bootstrap can collect the login welcome before any consumer attaches. If capture itself starts
late and misses it, subsequent deltas do not make `state.complete` true; a new valid full welcome is required.

`client.generation` identifies socket adoption within this document, not a global account. Generation changes invalidate
shared readiness immediately; open/close also make state stale. A stopped facade is locally incomplete without
invalidating peers. Last-known values remain readable, but actions require current connected/complete state.
A merge that throws also leaves state stale, so half-applied updates never look complete.
All nested state data, normalized lists, catalogs and delivered packet/battle payloads are frozen. The state view exposes
no `applyPacket`/`markStale` mutation methods. New welcome packets replace catalogs and clear omitted protections.
Each callback checks attachment/run and generation: replacement inside a listener interrupts old-generation delivery;
stop/restart inside a state listener cannot deliver a tail notification from the stopped run.
Routing across accounts and associating document identity with a generation remain host responsibilities.

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

`errors.ts` guards consumer callbacks with their own `ClientOptions.onError`; a throwing listener cannot stop peers
or mutate shared data. Without `onError`, the existing default handler reports to the console. If a custom `onError`
throws, reporting falls back without interrupting dispatch. An uncertain action-send error follows the invocation
owner's error handler, not another consumer's.

Synchronous bootstrap/context/policy failures throw `PageSessionError`. Its controlled `code` is one of
`unsupported-context`, `incompatible-runtime`, `configuration-conflict`, `invalid-options`, `busy` or `core-failure`.
Asynchronous core failures use the default error path with `core-failure`, not arbitrary page data.
Low-level uncertain send failures reject their Promise; they are not silently converted into success or definite refusal.
Do not persist arbitrary error messages/stacks as diagnostic artifacts.

## Actions

Each public `client.actions` is a consumer-bound facade over one runtime coordinator. The internal `Actions`
(`actions.ts`) depends on `ActionsHost` (`actions-host.ts`: connection, a narrow state slice, listening and sending).
That seam supports deterministic tests; it is not a consumer-selectable transport.
The rest lives in small modules: `actions-types.ts` (requests, results, options),
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
One runtime-lifetime connection subscription resets floors at session boundaries; waiters own and release per-order subscriptions.
`confirmedBy` records
which signal confirmed. A timeout, or a connection that drops or is replaced while waiting (`ActionsHost.onConnectionChange`), is `unconfirmed`, not a failure: the order may be late, so the next
one waits (default 30 s). The SDK neither queues nor repeats orders automatically.

Selling (`sellPokemon`) goes through the same `dispatch` (one in flight, rate limit, waiting after an unconfirmed or
rejected order). Before sending it applies the game's own rules for the Depot, read from the client (`sale-rules.ts`, through the state's
three-valued queries): not the active pokémon, not in the team, not in the Collection, not holding the Exp. Share. The sale is confirmed by the `venda` event or by the pokémon leaving the list. The event
(verified in real traffic: `{ k: 'venda', nome: 'Charmander Nv 20', ganho: 4573, qtd: 1 }`) names the pokémon WITH its level, and
nothing else, so it is matched on name and level and counts as `certain` only when no other pokémon of yours has that same
name and level and no interference is observed (otherwise `probable`); a shiny mark in the name is ignored;
when the list arrives first the SDK waits a short grace window (`confirmGraceMs`) so the gold is not lost to packet order.
It fails closed: when any of those queries answers `null` (a partial state, an unreadable held item), the answer is
"not sellable". The sale price comes from a function the client shares with the server and is not readable
from the page script, so a dry run does not estimate it: the gold comes back in the `venda` event.

The prices of purchases come from the catalogs: balls from the server's ball catalog (`priceGold`), shop items from the welcome packet,
and potions and revives from a small generated table (`catalog/npc-shop.generated.ts`, from the item catalog's `npcPrice`, checked against real purchases).

The runtime shares one in-flight action slot, limiter, spending ledger, inventory floors and cooldown across facades.
A competing action returns `busy`; all public low-level sends throw `PageSessionError('busy')` while that slot is held.
The internal action dispatch uses its own reservation. There is no queue or speculative classification of safe queries.
All public low-level sends return `Promise<boolean>`: `false` means definitely not sent, `true` only local acceptance,
and uncertain native-send failures reject. The local page write does not wait for a server ACK.

Stopping the owner after a possibly sent command settles its local invocation conservatively while the runtime retains
the reservation and waiter until evidence, the original timeout or a generation boundary. Other consumers remain busy,
even with zero configured cooldown. Shared floors, budget and cooldown are not reset by stop/restart; later
reconciliation must not erase the risk recorded at detach.

An accepted/uncertain low-level send marks interference until the next generation; an observed game send during an
action marks interference for that reconciliation. This deliberately includes opaque raw sends and queries/pings:
there is no speculative effects catalog. With interference, inventory/removal alone cannot confirm, and a matching
event is at most `probable`. SDK serialization cannot exclude manual or otherwise unobservable third-party writes.
Even without observed interference, `certain` denotes the existing matching rule, not request-id or transaction proof.
There is no launcher-specific projection, account model or dependency-injection container in the SDK.

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
| Single MAIN page session and WebSocket hook                       | Early MAIN installation, document identity and sandbox allowlists      |

`Actions` safety defaults are configurable shared-runtime protections, not an account persistence layer or automation runner.
A bootstrap policy can turn off rate limits while retaining reconciliation; the host supplies durable policy. Local JSON
canonicalization and an application-specific command allowlist are legitimate sandbox checks, not a duplicate protocol
implementation to move into the SDK.

`state.player` and typed packet listeners are supported low-level APIs, not access to private state. Prefer normalized
getters for common facts so features do not each reinterpret wire fields. Keep protocol access in an adapter when a
normalized projection is unavailable. A page extension should use `bootstrapPageSession`, `on('market')` and `sendCommand`
instead of installing its own WebSocket proxy and JSON parser. DOM access, client-adjusted page data and consumer
calculations remain local adapters unless a reusable, verified game contract justifies an SDK API.

A future isolated-world or launcher bridge must consume facts/snapshots/events and invoke operations on the client
already in MAIN. It must not forward raw frames into another SDK client/parser in the host or enable a CDP fallback.
Its document identity, authorization and allowed-action policy belong to that later integration; no such bridge is
implemented here. IPC correlation, if added, will not create a request id in the game's protocol.

## Sending commands

`sendCommand` is the low-level sender. Its guards (`protocol/send-guard.ts`) are about accidents: a forbidden command is
refused, an irreversible one needs an explicit confirmation, and malformed numbers are rejected before they reach the
socket. They work on the run-time value, so they also protect callers that bypass the types. They are not a security
boundary: nothing stops code that uses `sendRaw`. Both lists are checked against the registry by a test, so a typo or a
renamed command cannot silently protect nothing. Guards and busy refusal are synchronous even though the return type
is `Promise<boolean>`; use `try`/`await` to handle both. No command is retained for a later OPEN or replayed after reconnect.

## Catalogs and enums

`Item` and `Ball` map names to ids. Items come from the game's public items catalog; balls are not in that file (the server
sends them in `welcome`), so they come from a small snapshot in `packages/sdk/data/balls.json`, which the test extension can
copy for you. `npm run catalog` regenerates `src/catalog/*.generated.ts`; `npm run catalog:check` reports drift. When two
items share a name the lowest id keeps the clean key and the others get `_<id>`. The full catalogs are large, so the
client does not depend on them: `GameState.itemName` uses only what the server sent plus the generated NPC-shop table
(`npc-shop.generated.ts`, potions and revives). Importing `Item`, `itemInfo` and friends is what brings the catalog in. A test bundles the client
with early bootstrap and enforces the existing 40 KiB minified budget or fails if full catalog data sneaks in.

## Redaction

Packets contain session tokens, e-mails and player names. Everything the SDK records (`Inspector`) is redacted when it is
recorded, never later: sensitive keys are replaced, free text is cleaned and arrays and depth are limited. Samples of
packets with content written by other people (chat, friends, rankings, guilds...) keep only their structure, and the
account id (`estado.id`) is masked by path. The events inside a `batalha` packet (`samples.batalha`) get the same per-event
masking as `battleEventSamples`, so text that one masks is not readable in the other. The redaction is a safety net, not a guarantee: read a dump before sharing it. Raw recordings
must never be committed (`recordings/` is ignored); only sanitized fixtures belong in the repository.

For automatic diagnostics, use `Inspector({ mode: 'counts-only', maxTypes: 256 })`. It skips payload traversal and
sampling entirely, and canonicalizes names before retaining them: exact names from each direction's registry survive,
unknown names are a single `(unknown)` bucket. This also covers battle-event kinds and invalid/future ignored reasons;
turning off samples alone would still retain arbitrary server-controlled names in keys and unknown-name lists.
The three type/event counter maps retain at most `maxTypes + 1` series each, including `(other)` overflow; the ignored
map has only two known reasons plus `(unknown)`. Unknown-name lists contain only the fixed marker when retained.
Effective limits are validated as non-negative safe integers and an invalid mode fails before recording starts.
`reset()` clears counters without changing privacy mode. Sampled redaction remains the default for deliberate debugging,
but a sampled dump needs human review and is not an anonymity guarantee.

The SDK exposes document-local `generation`; the host owns document identity, the versioned log envelope and known/unknown quality flags derived from normalized
getters, parity counters, collection cadence, local permissions and bounded file rotation. Do not persist packet
listeners, raw error messages/stacks, player snapshots or page-console output. Inspector counters observe incoming
packets and the game client's outgoing commands, not the SDK's own sends; they cannot establish read-only operation.
The host must enforce a separate send block and turn automation off. SDK diagnostics add neither account metadata
nor filesystem/network persistence, and do not send collected data anywhere.

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
page session with `bootstrapPageSession()`, or starts a facade that ensures defaults if no session exists.
For reliable early capture, explicitly bootstrap in MAIN at document start independently of later UI/consumer attachment.
All runtime exports/catalogs are present in the IIFE; ESM consumers can still tree-shake unused catalogs.
Distribution tests execute the actual standalone example, module-loader-free IIFE, independent compatible bundles and
reentrant lifecycle boundaries, and relocate ESM/CJS/types outside the checkout.
The opt-in [native proof](../examples/test-extension/README.md#native-synthetic-proof) separately checks actual
MAIN/document_start injection with a loopback synthetic game, disposable profile and sandbox enabled.
