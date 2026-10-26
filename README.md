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
  console.log('great balls:', client.state.ballCount(Ball.GreatBall));
});
client.state.onChange(() => { /* gold, items, pokémon... changed */ });

client.on('welcome', (packet) => packet.estado?.gold); // typed raw packets for the verified types
client.onPacket((packet) => { /* every packet, typed as a plain Packet */ });
console.log(client.inspector?.dump()); // counts and redacted samples, safe to share
```

Items and balls are named by enums generated from the game's own catalogs: `Item.SmallPotion`, `Item.MaxRevive`,
`Ball.GreatBall`... `itemInfo(id)` gives name, category and price; `itemsInCategory('heal')` lists a category.
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

The library redacts tokens, e-mails and player names from everything it records. This repository contains no account data,
no recordings and no credentials, and a test fails if something of the kind is added. Please never paste raw packet
recordings in issues: use the redacted dump.

## License

[MIT](LICENSE), for the code in this repository only. It does not cover the game, its assets or other people's extensions.
