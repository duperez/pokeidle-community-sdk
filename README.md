# PokeIdle Community SDK

> **Unofficial community project.** Not affiliated with, endorsed by or supported by PokeIdle or its team. "PokeIdle" is
> mentioned only to say which game this library is for. Use it at your own risk and follow the game's rules.

A TypeScript library that makes it easier to build extensions for [PokeIdle](https://pokeidle.io): you handle **reading**
what the game sends and the actions you take (buying, selling); the SDK handles the connection, the packet parsing, item
names and logs.

**Status: early and experimental (v0.0.x).** The API will change. Today it can attach to the game's WebSocket from a
page, deliver parsed (and, for the verified types, typed) packets to your listeners, keep the player's state up to date,
name items and balls with enums, and record redacted samples of what goes by.

## Why

Every extension currently re-implements the same things: hooking the WebSocket, parsing packets, finding out which ID an
Ultra Ball has, logging what the game returns. This library aims to be the shared, documented base, so extensions are
smaller and the community stops rediscovering the same facts.

It is a helper, not a gatekeeper: it does not try to limit what you can build.

## Quick look

```ts
import { Ball, Item, bootstrapPageSession, PokeIdleClient } from 'pokeidle-community-sdk';

bootstrapPageSession(); // MAIN/document_start: capture can begin before your feature attaches.
const client = new PokeIdleClient();
client.start();

// The state is kept up to date from the game's packets: just read it.
client.on('welcome', () => {
  console.log(client.state.level, client.state.gold);
  console.log('revives:', client.state.itemCount(Item.Revive));
  console.log('ultra balls:', client.state.ballCount(Ball.UltraBall));
});
client.state.onChange(() => {
  /* gold, items, pokémon... changed */
});

client.on('welcome', (packet) => packet.estado?.gold); // typed raw packets for the verified types
client.onPacket((packet) => {
  /* every packet, typed as a plain Packet */
});
console.log(client.inspector?.dump()); // review sampled dumps before sharing
```

All nested `state.player` data is held as frozen private copies: writing to it throws a `TypeError`.

For decisions that need to distinguish unavailable inventory from zero, use `state.itemQuantity(id)` or
`state.ballQuantity(id)`: an unavailable map or invalid value/id returns `null`; an absent id in a known map returns `0`.
The older `itemCount`/`ballCount` helpers retain their zero-for-unknown behavior. All getters are last-known values;
require `client.connected && state.complete` when current state is needed.

`state.automation` exposes selected `ballIds`, `reviveIds` and `potionIds` as frozen arrays (positive integer ids, no
duplicates; `null` for an unavailable list). `state.inCenter` is `boolean | null`. `state.twitch` normalizes numeric text,
channel lists and `assistindoEm` entries (login strings or `{login}` objects), retains the server's field names, and leaves
missing/malformed values `null`. Text fields accept only nonempty trimmed strings; booleans must be actual booleans.
`emLives` and `canal` are reported facts, not inferred
from other fields. It imposes no UI text/list caps; presentation limits belong to the consumer.

Nothing a listener throws can break the SDK or another listener. Every error the SDK has to swallow (a listener, a state
callback) goes to that consumer's handler: `new PokeIdleClient({ onError: (error) => ... })`. Without
`onError` it is logged with `console.error`, and if your handler throws too, the error falls back to the console.
`client.onAnyBattleEvent(listener)` delivers every battle event; `client.onBattleEvent(kind, listener)` one kind.

### Actions

Actions are the things you do in the game, as functions that tell you what happened. They check what they can before
sending, send the game's own command and then wait for the game to confirm it:

```ts
const result = await client.actions.buyBall(Ball.UltraBall, 10);
if (result.status === 'confirmed') console.log(result.confirmedBy, result.before, '->', result.after);
// 'dry-run' | 'unconfirmed' | 'rejected' | 'not-for-sale' | 'insufficient-gold' | 'rate-limited' | 'spend-cap' | 'busy' | ...
```

`buyBall`, `buyItem` (potions, revives) and `sellPokemon` exist today. The result says what happened, and `unconfirmed` means _sent but
not confirmed in time_: it may still have happened, so the SDK waits 30 s before allowing another purchase instead of
risking paying twice (the same wait follows a `rejected`: the game's errors carry no request id, so an error can be about
something else). A purchase is confirmed by the game's own `compra` event (verified in real traffic: `nome`, `qtd` and `gasto`; same quantity and name: `confidence: 'certain'`; it arrives before the inventory update, so the SDK waits `confirmGraceMs` (default 1 s) for that update before answering and `after` reflects it when it comes)
or by the inventory growing by at least the quantity (`'probable'`), whichever comes first. Safety nets, all configurable
and none of them stops you from turning it off (`bootstrapPageSession({ actions: { ... } })`; they live in memory, so a page
reload starts them over):

- `dryRun`: say what would be sent and send nothing (also per call). It goes through the same limits, so it tells you
  when a real call would be blocked.
- A rate limit: 3 s between actions and at most 10 per minute (`rateLimit: false` turns it off).
- `maxGoldPerHour`: a spending cap, counted when the order is sent (an order whose price is unknown is refused while a cap is set).
- Checks before sending: not for sale, not enough gold (`checks: false`, or `{ notForSale, gold, sellable }` one by one, lets the game decide).
- One managed action in flight per document runtime, across consumers. Other calls return `busy`, with no queue.
- Adopting a successor invalidates completeness immediately, including while CONNECTING. Actions answer `no-state`
  until current full state arrives. A pending order cannot use a later generation's evidence.

The inventory fallback never reuses quantities already expected from earlier sent or possibly sent purchases of the same
item, even when their update arrives after the grace window. This is deliberately conservative: simultaneous consumption
or a rejected order can make inventory-only confirmation unavailable; the matching `compra` event still confirms it.
These expectations are reset at a connection boundary.

Every action accepts a per-call `onSend` observer, independent of the later `BuyResult`/`SellResult`:

```ts
const result = await client.actions.buyBall(Ball.UltraBall, 10, {
  onSend(outcome) {
    // accepted: transport returned true; not-sent: definitely no frame sent;
    // uncertain: a transport failure, with the original error in outcome.error.
    // Account for accepted/uncertain sends here, before waiting for game evidence.
  },
});
```

`onSend` runs synchronously once the send settles and before the terminal action result, even if game evidence arrived
first. Preflight refusals and dry runs do not call it; a dispatch guard calls it with `not-sent` before the action rejects.
An observer that throws is reported through `onError` but cannot undo the send or interrupt reconciliation. It is not an
async persistence hook: the host must handle persistence failures and prevent unsafe retries itself. Page sends settle
locally; the public Promise does not wait for a server ACK.

Acceptance and game evidence are separate: an uncertain send can later have matching game evidence. Even
`confidence: 'certain'` means a matching event under the SDK's rules, not a transaction receipt or request-id correlation.
Identical manual/concurrent commands can produce indistinguishable events. Keep account persistence, feature scheduling
and application budgets in the host; the SDK's configurable in-memory limits are not a replacement for them.
Observed game writes during reconciliation, or accepted/uncertain low-level SDK writes in the generation, disable
inventory-only confirmation and limit matching events to `probable`. This deliberately includes queries/pings rather than
guessing their effects. Unobservable third-party/manual writes cannot be excluded.

`sellPokemon(id, { confirmIrreversible: true })` sells ONE pokémon from your Depot to the NPC shop and cannot be undone, so
it needs the explicit confirmation (not for a dry run). It refuses, with the reason, what the game's own client refuses to
sell (the state answers `isActive`, `isInTeam`, `isInCollection` and `holdsExpShare` with `true`, `false` or `null` for
"unknown"): your active pokémon, your team, the Collection (locked) and one holding the Exp. Share. Selling is irreversible, so
it fails closed: if the state is partial and a protection cannot be read, it refuses. It is confirmed by the game's
`venda` event (verified in real traffic: `{ nome: 'Charmander Nv 20', ganho: 4573, qtd: 1 }`; it carries the gold and the
pokémon's name with its level, so it is `certain` when no other pokémon of yours has that name and level, `probable` otherwise) or by the pokémon leaving your list (strong evidence, not
proof: a partial list or a market listing also removes it). When the list comes first, the SDK waits `confirmGraceMs`
(default 1 s) for the event, so the gold is not lost to the order in which the packets arrive. It shares the one-at-a-time rule, the rate
limit and the waiting period with the purchases. There is no "sell all" yet: it follows your collection rule, whose effect
the SDK cannot predict from the client.

### Sending commands

`await client.sendCommand({ t: 'shop.buy', kind: 'ball', id: Ball.UltraBall, qty: 10 })` sends a command the game's client knows,
checked by the compiler for the typed ones. It sends exactly what you pass, right away, and guards against accidents (not
against someone who wants to bypass them: `sendRaw` exists):

- **Forbidden** (`FORBIDDEN_COMMANDS`): `orbs.sacar`, which withdraws orbs as real cryptocurrency. It does not compile and
  is refused at run time.
- **Irreversible** (`IRREVERSIBLE_COMMANDS`): commands that spend, sell or destroy something valuable (market purchases and
  listings, selling pokémon, discarding items, refining, evolving, guild leadership...). They need
  `{ confirmIrreversible: true }`.
- Numbers must be finite and `qty`/`qtd` positive integers (`JSON.stringify(NaN)` would send `null`).

Both `sendCommand` and `sendRaw` return `Promise<boolean>`: `true` is local acceptance, `false` means definitely not
sent because the facade/socket is unavailable, and a native failure rejects with its original uncertain error.
Validation and `PageSessionError` with code `busy` throw synchronously. All public low-level sends, including queries,
are refused while a managed action reserves the writer. Nothing is queued or replayed after reconnect.

### What is typed

The SDK knows every packet the game's client handles (51 types), every kind of event inside a battle packet (133) and every
command the client sends (216): the registry is extracted from the client itself (`npm run protocol`, and
`npm run protocol:check` tells if the game changed). How well each one is known is explicit:

| Level         | Meaning                                                              | Packets | Battle events | Commands                                      |
| ------------- | -------------------------------------------------------------------- | ------- | ------------- | --------------------------------------------- |
| `traffic`     | fields verified in real traffic                                      | 20      | 7             | 6                                             |
| `client-code` | field names read from the game's client, values `unknown` until seen | 31      | 126           | typed shapes for the buy/sell/market commands |
| `name-only`   | known by name                                                        | none    | none          | the rest                                      |

`client.on('market', (p) => p.medias)` is typed for all 51 packet types (a typo does not compile; `onType` is for types the SDK does not know yet), `client.onBattleEvent('morte', (e) => e.ouro)`
delivers battle events one by one, and `client.inspector.dump()` lists what the game sent that the SDK does not know
(`unknownTypes`, `unknownBattleEvents`, `unknownSentTypes`), which is how a protocol change shows up. A new type added by
the game fails the build until someone classifies it.

Items and balls are named by enums generated from the game's own catalogs (682 items and 5 balls today):
`Item.SmallPotion`, `Item.MaxRevive`, `Item.BronzeBossToken`, `Item.ShinyVenusaurite`, `Ball.UltraBall`, `Ball.BeastBall`... `itemInfo(id)` gives name, category and price; `itemsInCategory('heal')` lists a category.
`client.state.itemName(id)` does not pull that full catalog in: it uses what the server sent plus a small generated table of the NPC shop's potions and revives.
The standalone client bundle has a 40 KB minified test budget; the full catalogs only ship if you import them.
`npm run catalog` regenerates them from the game's public data, and `npm run catalog:check` tells if they are stale.

It has to run in the page's own world, before the game opens its socket. In a Chrome extension (Manifest V3):

```json
"content_scripts": [{ "matches": ["https://pokeidle.io/*"], "js": ["dist/main-world.js"], "run_at": "document_start", "world": "MAIN" }]
```

### Public API

Use one runtime per game document/MAIN realm and one consumer facade per feature. Construction is inert; `start()` attaches
and installs default capture only if bootstrap was absent. It never opens a game connection or logs in.
Explicit bootstrap fixes `actions` and `maxPacketBytes` for that document. Equivalent normalized policies reuse the
runtime; a later divergent bootstrap throws `configuration-conflict`, never reconfigures peers. Local constructor options
are only `inspector` and `onError`; old JavaScript `transport` options fail before patching.

`stop()` makes only that facade disconnected/incomplete and retains its last-known values. Peers and collection continue,
including after the last stop. Restart uses current continuously collected state without replaying old events/commands.
If bootstrap missed the full state, late adoption does not reconstruct it. An owner's conservative early action result
does not release the runtime waiter/reservation: peers stay busy until evidence, the original timeout or a generation
boundary, even with zero cooldown. Existing risk/floors and in-memory budgets are not reset by stop.

`generation` counts socket adoptions in this document, not accounts or globally unique sessions. State views have no
`applyPacket`/`markStale`; nested state and event payloads are frozen. `onChange` is about state/lifecycle changes, not
every packet. A new full state clears catalogs/protections omitted by that session.

Runtime ABI/capability mismatches, malformed occupied slots and a legacy hook are refused explicitly without overwriting
the live runtime or stacking a patch. This sharing contract covers compatible copies in the same MAIN global, not
isolated worlds, other documents or a security sandbox against arbitrary JavaScript in the page.

Everything public is listed by name in `packages/sdk/src/index.ts`. A test snapshots the exported names and signatures
(`packages/sdk/test/api-surface.snapshot.json`), so the API cannot change by accident; after an intended change run
`UPDATE_API_SNAPSHOT=1 npm test` in `packages/sdk` and record it in the [CHANGELOG](CHANGELOG.md).

### Integrating a launcher or another IPC host

Run the SDK in the page's MAIN world, just as a standalone extension does. A host bridge can project already normalized
facts/snapshots and ordered operation receipts/results from that facade. Do not forward raw frames into another SDK parser
in the host, construct a client with a bridge transport, or add another socket hook. The host owns document identity,
profiles, windows, accounts, authorization, durable budgets and automation. Bridge request correlation is local, not a game
transaction id. Arbitrary `unknown` errors/callbacks are not a JSON protocol; project controlled outcomes as needed.
Isolated-world/IPC integration is a later consumer boundary, not implemented by this SDK increment.

`npm run build -w pokeidle-community-sdk` produces ESM (`dist/index.js`), a self-contained CommonJS bundle
(`dist/index.cjs`), a classic browser script (`dist/pokeidle-sdk.iife.js`), and ESM/CommonJS declarations.
Package `import`/`require` exports select matching declarations automatically.
For vendoring, copy the CJS bundle plus the entire `dist/cjs/` declaration tree, including its `package.json`, preserving
relative paths. Import types from that tree's `index.js` path (TypeScript resolves `index.d.ts`), not from an untyped `.cjs`
file. Keep the upstream commit identifier alongside the copied artifacts.

For a reproducible, verified package, run `npm ci`, `npm run distribution -- --require-clean`, then
`npm run test:distribution`. CI retains the `.tgz`, revision/toolchain manifest and SHA-256 checksums as a workflow
artifact; nothing is published to a registry. Use one artifact's CJS, types and IIFE together and expose its version,
revision and verification status in the consuming application's installation diagnostics, not through a new SDK UI.
See [distribution and consumer diagnostics](docs/distribution.md) for the schema, limits and launcher mapping.

For an extension without a bundler, vendor `dist/pokeidle-sdk.iife.js` and load it before your page adapter, in the page's
MAIN world at `document_start`. Loading exports is inert; bootstrap starts capture before a consumer needs to attach:

```js
const { PokeIdleClient, bootstrapPageSession } = globalThis.PokeIdleSDK;
bootstrapPageSession();
const client = new PokeIdleClient();
client.on('market', (packet) => {
  /* consume packet.medias / packet.resumo */
});
client.start();
// When your feature needs it: await client.sendCommand({ t: 'market.itens' });
```

The IIFE includes all public runtime exports and catalogs, unlike a tree-shaken ESM integration. Use the SDK's
and typed packet/command APIs rather than a second WebSocket proxy or protocol parser in the feature. DOM reads and
application-specific calculations still belong in page adapters, not in the SDK or an Electron bridge.

## Repository layout

| Path                      | What it is                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `packages/sdk`            | the library (`pokeidle-community-sdk`)                                                 |
| `examples/test-extension` | a Chrome extension that uses the library as a package, to try it against the real game |
| `docs`                    | architecture notes                                                                     |
| `scripts`                 | generators (catalog, protocol), coverage floor and mutation check                      |
| `test`                    | repository-level checks (nothing personal or sensitive is tracked)                     |

## Try it

```bash
npm ci
npm run build        # builds the SDK, then the test extension
npm test
npm run coverage     # unit tests with a coverage floor
npm run mutation     # applies deliberate bugs to the safety code; the tests must catch each one
```

CI runs formatting, build, lint, typecheck, tests, coverage and reproducible packaging on pull requests, pushes to `main`
and manual dispatch. Consumption is checked on Linux, macOS and Windows. A weekly workflow checks whether the game
drifted (`catalog:check`, `protocol:check`) and runs the mutation check; CodeQL and Dependabot are on too. See
[CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), [CODE_OF_CONDUCT](CODE_OF_CONDUCT.md) and the [CHANGELOG](CHANGELOG.md).

Then load `examples/test-extension` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load
unpacked) and open the game. A small panel shows which packet types arrive. The button copies a **redacted** dump.

## Privacy

The library redacts tokens, e-mails, your own nick and account id, and everything other people wrote (chat, friend lists, rankings, guilds: only the structure is kept) from everything it records. Redaction is a safety net, not a guarantee: look at a dump before you share it. This repository contains no account data,
no recordings and no credentials, and a test fails if something of the kind is added. Please never paste raw packet
recordings in issues: use the redacted dump.

### Automatic diagnostics and shadow collection

Use the opt-in counts-only inspector for automatic local collection, not the default sampled dump:

```ts
const inspector = new Inspector({ mode: 'counts-only', maxTypes: 256 });
let sdkErrors = 0;
const client = new PokeIdleClient({
  inspector,
  onError: () => {
    sdkErrors += 1;
  },
});
```

In this mode `inspector.dump()` retains the existing shape, but `samples` and `battleEventSamples` are always empty,
regardless of sample/redaction options. Counter keys must exactly match the appropriate packet, command or battle-event
registry; unrecognized names become `(unknown)`, never arbitrary server text. Each of `received`, `sent` and `battleEvents`
has at most `maxTypes + 1` entries (257 with this configuration), including an `(other)` overflow bucket. Each `unknown*`
list is empty or `['(unknown)']`; overflow can absorb that marker, so always inspect `(other)` too. `ignored` only contains
`oversized`, `not-a-packet` or `(unknown)`, at most three entries. No packet fields are traversed or retained.

The default mode remains `redacted-samples`, with 200 types and three samples per type. Effective limits must be
non-negative safe integers; invalid modes/limits throw. `maxSamplesPerType` is ignored in counts-only mode.
`dump()` is cumulative until `reset()`, which preserves the mode. Let the host own collection cadence, durable append,
bounded rotation, restrictive local permissions and any reset after persistence; do not silently discard failed writes.

Track document-local generation with `generation`/`onConnectionChange`, completeness with `state.complete`, and known/unknown
quality through normalized getters. Log only allowlisted field identifiers, validated catalog ids and aggregate parity
counts, not the compared values. Never serialize player snapshots, packet callbacks, error messages/stacks or page-console
contents into the collection. Counts-only protects Inspector retention, not other application logging or the live state.
The host owns run identifiers, the log-envelope schema and source SDK revision.

`sent` counts observed commands from the **game's own client**, not SDK sends; `ignored` counts dropped incoming frames.
These counters do not prove that the SDK sent nothing. Read-only shadow operation requires a separate host-side send
block and disabled automation, independent of copied preferences. Do not send collected files to external services or
commit them to Git; analysis should use only explicitly approved local data or synthetic summaries.

## License

[MIT](LICENSE), for the code in this repository only. It does not cover the game, its assets or other people's extensions.
