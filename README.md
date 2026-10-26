# PokeIdle Community SDK

> **Unofficial community project.** Not affiliated with, endorsed by or supported by PokeIdle or its team. "PokeIdle" is
> mentioned only to say which game this library is for. Use it at your own risk and follow the game's rules.

A TypeScript library that makes it easier to build extensions for [PokeIdle](https://pokeidle.io): you handle **reading**
what the game sends (and, in later versions, **sending** actions); the SDK handles the connection, the packet parsing, item
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
client.state.onChange(() => { /* gold, items, pokémon... changed */ });

client.on('welcome', (packet) => packet.estado?.gold); // typed raw packets for the verified types
client.onPacket((packet) => { /* every packet, typed as a plain Packet */ });
console.log(client.inspector?.dump()); // counts and redacted samples, safe to share
```

### Actions

Actions are the things you do in the game, as functions that tell you what happened. They check what they can before
sending, send the game's own command and then wait for the game to confirm it:

```ts
const result = await client.actions.buyBall(Ball.UltraBall, 10);
if (result.status === 'confirmed') console.log(result.confirmedBy, result.before, '->', result.after);
// 'dry-run' | 'unconfirmed' | 'rejected' | 'not-for-sale' | 'insufficient-gold' | 'rate-limited' | 'spend-cap' | 'busy' | ...
```

`buyBall`, `buyItem` (potions, revives) and `sellPokemon` exist today. The result says what happened, and `unconfirmed` means *sent but
not confirmed in time*: it may still have happened, so the SDK waits 30 s before allowing another purchase instead of
risking paying twice (the same wait follows a `rejected`: the game's errors carry no request id, so an error can be about
something else). A purchase is confirmed by the game's own `compra` event (verified in real traffic: `nome`, `qtd` and `gasto`; same quantity and name: `confidence: 'certain'`; it arrives before the inventory update, so `after` can still equal `before`)
or by the inventory growing by at least the quantity (`'probable'`), whichever comes first. Safety nets, all configurable
and none of them stops you from turning it off (`new PokeIdleClient({ actions: { ... } })`; they live in memory, so a page
reload starts them over):

- `dryRun`: say what would be sent and send nothing (also per call). It goes through the same limits, so it tells you
  when a real call would be blocked.
- A rate limit: 3 s between actions and at most 10 per minute (`rateLimit: false` turns it off).
- `maxGoldPerHour`: a spending cap, counted when the order is sent (an order whose price is unknown is refused while a cap is set).
- Checks before sending: not for sale, not enough gold (`checks: false`, or `{ notForSale, gold, sellable }` one by one, lets the game decide).
- One action in flight at a time. Invalid quantities throw a `RangeError`.

`sellPokemon(id, { confirmIrreversible: true })` sells ONE pokémon from your Depot to the NPC shop and cannot be undone, so
it needs the explicit confirmation (not for a dry run). It refuses, with the reason, what the game's own client refuses to
sell: your active pokémon, your team, the Collection (locked) and one holding the Exp. Share. Selling is irreversible, so
it fails closed: if the state is partial and a protection cannot be read, it refuses. It is confirmed by the game's
`venda` event (with the gold it reports; ignored when two pokémon share the name, because the event carries only a name) or
by the pokémon leaving your list (strong evidence, not proof: a partial list or a market listing also removes it). It shares the one-at-a-time rule, the rate
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

| Level | Meaning | Packets | Battle events | Commands |
|---|---|---|---|---|
| `traffic` | fields verified in real traffic | 20 | 6 | 6 |
| `client-code` | field names read from the game's client, values `unknown` until seen | 31 | 127 | typed shapes for the buy/sell/market commands |
| `name-only` | known by name | none | none | the rest |

`client.on('market', (p) => p.medias)` is typed for all 51 packet types (a typo does not compile; `onType` is for types the SDK does not know yet), `client.onBattleEvent('morte', (e) => e.ouro)`
delivers battle events one by one, and `client.inspector.dump()` lists what the game sent that the SDK does not know
(`unknownTypes`, `unknownBattleEvents`, `unknownSentTypes`), which is how a protocol change shows up. A new type added by
the game fails the build until someone classifies it.

Items and balls are named by enums generated from the game's own catalogs (682 items and 5 balls today):
`Item.SmallPotion`, `Item.MaxRevive`, `Item.BronzeBossToken`, `Item.ShinyVenusaurite`, `Ball.UltraBall`, `Ball.BeastBall`... `itemInfo(id)` gives name, category and price; `itemsInCategory('heal')` lists a category.
`npm run catalog` regenerates them from the game's public data, and `npm run catalog:check` tells if they are stale.

It has to run in the page's own world, before the game opens its socket. In a Chrome extension (Manifest V3):

```json
"content_scripts": [{ "matches": ["https://pokeidle.io/*"], "js": ["dist/main-world.js"], "run_at": "document_start", "world": "MAIN" }]
```

## Repository layout

| Path | What it is |
|---|---|
| `packages/sdk` | the library (`pokeidle-community-sdk`) |
| `examples/test-extension` | a Chrome extension that uses the library as a package, to try it against the real game |
| `docs` | architecture notes |
| `test` | repository-level checks (nothing personal or sensitive is tracked) |

## Try it

```bash
npm install
npm run build        # builds the SDK, then the test extension
npm test
```

Then load `examples/test-extension` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load
unpacked) and open the game. A small panel shows which packet types arrive. The button copies a **redacted** dump.

## Privacy

The library redacts tokens, e-mails, your own nick and account id, and everything other people wrote (chat, friend lists, rankings, guilds: only the structure is kept) from everything it records. Redaction is a safety net, not a guarantee: look at a dump before you share it. This repository contains no account data,
no recordings and no credentials, and a test fails if something of the kind is added. Please never paste raw packet
recordings in issues: use the redacted dump.

## License

[MIT](LICENSE), for the code in this repository only. It does not cover the game, its assets or other people's extensions.
