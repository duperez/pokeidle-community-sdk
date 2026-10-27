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
import { Ball, Item, PageTransport, PokeIdleClient } from 'pokeidle-community-sdk';

const client = new PokeIdleClient({ transport: new PageTransport() });
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
console.log(client.inspector?.dump()); // counts and redacted samples, safe to share
```

The data the SDK's own decisions rest on (`items`, `balls`, the Collection in `automation`, every pokémon row) is held as frozen private copies: writing to it throws a `TypeError`. The rest of `state.player` is shared with the game's packet and is read-only only by contract.

Nothing a listener throws can break the SDK or another listener. Every error the SDK has to swallow (a listener, a state
callback, a transport handler) goes to one place: `new PokeIdleClient({ transport, onError: (error) => ... })`. Without
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
and none of them stops you from turning it off (`new PokeIdleClient({ actions: { ... } })`; they live in memory, so a page
reload starts them over):

- `dryRun`: say what would be sent and send nothing (also per call). It goes through the same limits, so it tells you
  when a real call would be blocked.
- A rate limit: 3 s between actions and at most 10 per minute (`rateLimit: false` turns it off).
- `maxGoldPerHour`: a spending cap, counted when the order is sent (an order whose price is unknown is refused while a cap is set).
- Checks before sending: not for sale, not enough gold (`checks: false`, or `{ notForSale, gold, sellable }` one by one, lets the game decide).
- One action in flight at a time. Invalid quantities throw a `RangeError`.
- A new connection invalidates the state: `state.complete` turns `false` when a socket opens or closes and stays so until the next `welcome`, and actions answer `no-state` meanwhile. An order still waiting when the connection drops ends as `unconfirmed`.

The inventory fallback never reuses quantities already expected from earlier sent or possibly sent purchases of the same
item, even when their update arrives after the grace window. This is deliberately conservative: simultaneous consumption
or a rejected order can make inventory-only confirmation unavailable; the matching `compra` event still confirms it.
These expectations are reset at a connection boundary.

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

`client.sendCommand({ t: 'shop.buy', kind: 'ball', id: Ball.UltraBall, qty: 10 })` sends a command the game's client knows,
checked by the compiler for the typed ones. It sends exactly what you pass, right away, and guards against accidents (not
against someone who wants to bypass them: `sendRaw` exists):

- **Forbidden** (`FORBIDDEN_COMMANDS`): `orbs.sacar`, which withdraws orbs as real cryptocurrency. It does not compile and
  is refused at run time.
- **Irreversible** (`IRREVERSIBLE_COMMANDS`): commands that spend, sell or destroy something valuable (market purchases and
  listings, selling pokémon, discarding items, refining, evolving, guild leadership...). They need
  `{ confirmIrreversible: true }`.
- Numbers must be finite and `qty`/`qtd` positive integers (`JSON.stringify(NaN)` would send `null`).

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
The client plus `PageTransport` bundle is about 30 KB minified, and a test fails above 40 KB, so the catalogs only ship if you import them.
`npm run catalog` regenerates them from the game's public data, and `npm run catalog:check` tells if they are stale.

It has to run in the page's own world, before the game opens its socket. In a Chrome extension (Manifest V3):

```json
"content_scripts": [{ "matches": ["https://pokeidle.io/*"], "js": ["dist/main-world.js"], "run_at": "document_start", "world": "MAIN" }]
```

### Public API

Use one client/transport per account. `stop()` detaches the transport, makes `connected` and `state.complete` false, and
notifies connection/state observers; the last known values remain readable. A restarted client ignores callbacks retained
from its previous run and needs a new full state. `state.player`, wire rows, normalized lists and server catalogs are deeply
frozen, owned snapshots: never mutate them. A new `welcome` clears catalogs/protections omitted by that session.

Everything public is listed by name in `packages/sdk/src/index.ts`. A test snapshots the exported names and signatures
(`packages/sdk/test/api-surface.snapshot.json`), so the API cannot change by accident; after an intended change run
`UPDATE_API_SNAPSHOT=1 npm test` in `packages/sdk` and record it in the [CHANGELOG](CHANGELOG.md).

### Integrating a launcher or another IPC host

Implement `Transport<Promise<boolean>>` and construct `PokeIdleClient` with it; `sendRaw`/`sendCommand` then return
`Promise<boolean>`. `true` is acceptance for sending, **not** confirmation of an effect. Return `false` only if nothing was
sent; reject on an uncertain IPC/socket failure. Guards still throw synchronously before sending. Actions report uncertain
send errors through `onError`, charge their budgets conservatively when the send settles and wait for game evidence.
Never forward callbacks from another account or a replaced webview to the same handlers.

`npm run build -w pokeidle-community-sdk` produces ESM (`dist/index.js`), a self-contained CommonJS bundle
(`dist/index.cjs`), and declarations for both. Package `import`/`require` exports select matching declarations automatically.
For vendoring, copy the CJS bundle plus the entire `dist/cjs/` declaration tree, including its `package.json`, preserving
relative paths. Import types from that tree's `index.js` path (TypeScript resolves `index.d.ts`), not from an untyped `.cjs`
file. Keep the upstream commit identifier alongside the copied artifacts.

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
npm install
npm run build        # builds the SDK, then the test extension
npm test
npm run coverage     # unit tests with a coverage floor
npm run mutation     # applies deliberate bugs to the safety code; the tests must catch each one
```

CI runs formatting, build, lint, typecheck, tests and coverage on every push. A weekly workflow checks whether the game
drifted (`catalog:check`, `protocol:check`) and runs the mutation check; CodeQL and Dependabot are on too. See
[CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), [CODE_OF_CONDUCT](CODE_OF_CONDUCT.md) and the [CHANGELOG](CHANGELOG.md).

Then load `examples/test-extension` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load
unpacked) and open the game. A small panel shows which packet types arrive. The button copies a **redacted** dump.

## Privacy

The library redacts tokens, e-mails, your own nick and account id, and everything other people wrote (chat, friend lists, rankings, guilds: only the structure is kept) from everything it records. Redaction is a safety net, not a guarantee: look at a dump before you share it. This repository contains no account data,
no recordings and no credentials, and a test fails if something of the kind is added. Please never paste raw packet
recordings in issues: use the redacted dump.

## License

[MIT](LICENSE), for the code in this repository only. It does not cover the game, its assets or other people's extensions.
