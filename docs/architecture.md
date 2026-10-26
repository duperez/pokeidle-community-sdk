# Architecture

The SDK is built so that extension authors only think about two things: **reading** what the game sends and, later,
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
  The game's socket is the one on the page's own host with the path `/`; other sockets are left alone.

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
`itemCount(id)`, `ballCount(id)`) and ignores malformed data instead of throwing. The state is updated *before* your packet
listeners run. The full state arrives only once, in `welcome` right after login: code that starts listening later (for
example an extension reloaded with the game already open) only sees updates, and `state.complete` is `false` until the
page reloads.

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

## Actions

`Actions` (`actions.ts`) sits on top of `sendCommand`. A purchase goes through: input validation (throws), one-in-flight,
connection and full-state checks, price and gold checks from the catalogs the server sent, the optional spending cap and
the rate limit, then the send. It listens for the answer BEFORE sending (the answer can be instant) and resolves with the
first of: the game's `compra` event (same quantity and, when known, same name), the inventory growing, an `erro` packet or
the timeout. The inventory alone is a weak signal (balls used in the hunt at the same time can hide a small purchase),
so the event is preferred. It was verified in real traffic: the `compra` event is emitted for NPC-shop purchases, with
`nome`, `qtd` and `gasto`, and arrives before the `estado` update (so `after` can equal `before`). `confirmedBy` records
which signal confirmed. A timeout is `unconfirmed`, not a failure: the order may be late, so the next
one waits (default 30 s), the same rule the Companion app uses after more than 57 000 real purchases.

Selling (`sellPokemon`) goes through the same `dispatch` (one in flight, rate limit, waiting after an unconfirmed or
rejected order). Before sending it applies the game's own rules for the Depot, read from the client: not the active pokémon
(`activeId`), not in the team (`slot` is set), not in the Collection (`automation.pokemonTravado`), not holding the Exp.
Share (`xpShareHeld.itemId`). It fails closed: when the active pokémon, the Collection list or the Exp. Share item cannot
be read (a partial state, ids that arrive as text are understood), the answer is "not sellable". The sale price comes from a function the client shares with the server and is not readable
from the page script, so a dry run does not estimate it: the gold comes back in the `venda` event.

The prices of purchases come from the catalogs: balls from the server's ball catalog (`priceGold`), shop items from the welcome packet,
and potions and revives from the item catalog's `npcPrice` (checked against real purchases).

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
items share a name the lowest id keeps the clean key and the others get `_<id>`.

## Redaction

Packets contain session tokens, e-mails and player names. Everything the SDK records (`Inspector`) is redacted when it is
recorded, never later: sensitive keys are replaced, free text is cleaned and arrays and depth are limited. Samples of
packets with content written by other people (chat, friends, rankings, guilds...) keep only their structure, and the
account id (`estado.id`) is masked by path. The redaction is a safety net, not a guarantee: read a dump before sharing it. Raw recordings
must never be committed (`recordings/` is ignored); only sanitized fixtures belong in the repository.

## Compatibility

The game's protocol is private and can change at any time. The SDK is the single place to adapt: packets are read
defensively, unknown types are reported by the inspector instead of failing, and fixtures from real traffic (sanitized)
are used to catch format changes.
