# PokeIdle Community SDK

> **Unofficial community project.** Not affiliated with, endorsed by or supported by PokeIdle or its team. "PokeIdle" is
> mentioned only to say which game this library is for. Use it at your own risk and follow the game's rules.

A TypeScript library that makes it easier to build extensions for [PokeIdle](https://pokeidle.io): you handle **reading**
what the game sends (and, in later versions, **sending** actions); the SDK handles the connection, the packet parsing, item
names and logs.

**Status: early and experimental (v0.0.x).** The API will change. Today it can attach to the game's WebSocket from a
page, deliver parsed packets to your listeners and record redacted samples of what goes by.

## Why

Every extension currently re-implements the same things: hooking the WebSocket, parsing packets, finding out which ID an
Ultra Ball has, logging what the game returns. This library aims to be the shared, documented base, so extensions are
smaller and the community stops rediscovering the same facts.

It is a helper, not a gatekeeper: it does not try to limit what you can build.

## Quick look

```ts
import { Inspector, PageTransport, PokeIdleClient } from 'pokeidle-community-sdk';

const client = new PokeIdleClient({ transport: new PageTransport(), inspector: new Inspector() });
client.start();

client.on('welcome', (packet) => console.log('logged in', packet.t));
client.onPacket((packet) => { /* every packet */ });
console.log(client.inspector?.dump()); // counts and redacted samples, safe to share
```

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
