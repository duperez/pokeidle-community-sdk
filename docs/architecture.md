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

## Redaction

Packets contain session tokens, e-mails and player names. Everything the SDK records (`Inspector`) is redacted when it is
recorded, never later: sensitive keys are replaced, free text is cleaned and arrays and depth are limited. Raw recordings
must never be committed (`recordings/` is ignored); only sanitized fixtures belong in the repository.

## Compatibility

The game's protocol is private and can change at any time. The SDK is the single place to adapt: packets are read
defensively, unknown types are reported by the inspector instead of failing, and fixtures from real traffic (sanitized)
are used to catch format changes.
