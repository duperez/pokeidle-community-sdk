# Standalone SDK example and local proof

The MV3 example captures in MAIN at `document_start`, without a launcher or a
transport option. Loading the extension and mounting its overlay send no game
commands. The labeled buttons can perform real purchases and irreversible
sales; the example is not a read-only tool. Do not use a real account for the
synthetic connector proof below.

`bootstrapPageSession()` runs before UI setup. A later client attaches to the
runtime's continuously collected current state. Connection alone is not
readiness: check both `client.connected` and `client.state.complete`.

Build and typecheck using the repository workspaces:

```sh
npm run build
npm run typecheck
npm exec -- node --test test/sdk-distribution.test.mjs
```

The distribution test preserves relocated ESM/CommonJS/type consumers and the
module-loader-free IIFE smoke. It separately evaluates two complete IIFEs in
one VM, exercises late attach, stop isolation, CONNECTING replacement and
current-socket-only sending. VM results do not prove native extension timing.

## Native synthetic proof

`native-proof.mjs` is an opt-in test harness, not a production dependency or
part of the regular offline unit suite. Reserve the coordinator's serial
browser/server window before executing it. `--help` starts no helpers:

```sh
node examples/test-extension/native-proof.mjs --help
```

The harness requires `ws` and `playwright` in a disposable tools directory
outside the repository, plus Playwright's extension-capable Chromium. Provision
only when needed, recording the exact installed versions and commands. No
package manifest or production dependency needs to change. Point
`SDK_PROOF_TOOLS` at that absolute directory:

```sh
SDK_PROOF_TOOLS="$PROOF_TOOLS" node examples/test-extension/native-proof.mjs
```

Build the SDK first. For final provenance, use a clean committed distribution
and retain its revision/toolchain manifest separately from this harness's JSON.
The harness loads the actual built IIFE, not a replacement SDK implementation.
It generates two independent extension files, each containing the entire same
SDK segment plus a distinct wrapper. Both execute in MAIN/document_start
against loopback only; the real-game manifest and profile are never loaded.
Chromium sandboxing remains enabled. If the sandbox cannot start, the proof
fails explicitly; do not retry with `--no-sandbox` or weaker security flags.

The first inline page script creates the native socket. Server-delivered
invented welcome data is collected before either client attaches. Subsequent
checks cover current state without historical welcome replay, one delta per
consumer, stopping A without affecting B or the game's socket, and immediate
readiness invalidation when a CONNECTING successor is constructed. The server
holds the successor's HTTP upgrade until that observation is complete.
OPEN alone must not restore completeness; a fresh welcome does. Old socket
traffic/close must be ignored and exactly one ping must reach the successor.
Finally, A creates a third page-owned CONNECTING socket from inside a welcome
listener. The old-generation packet must not continue to A's catch-all or B's
typed/catch-all listeners after that boundary.

Synchronization uses explicit page flags and server handshake/message signals,
not arbitrary sleeps or global networkidle while an upgrade is held.
The final bounded JSON contains PASS/FAIL, completed stage names, browser
version, SDK/wrapper hashes and connection/frame counts; it contains no raw
packets, arbitrary page errors, account data or credentials. A timeout is a
failed/incomplete proof, never success. The harness closes only its own browser,
loopback server and sockets, then deletes only its generated temporary fixture
and empty profile directory.

This proves neither isolated-world bridging, internal parse counts, action
transaction attribution nor production performance. Internal sharing and
action outcome ordering remain separate core-test responsibilities.

### Executed early checkpoint

The initial integrated proof ran against clean revision
`ae4f5141d7197b70c292168c24fa772a3545088b` with core checkpoint
`ff459f5a2562e5a09a830b898071ade6ea61e285` and its boundary prerequisites.
Node 22.23.4, npm 10.9.9, Playwright 1.64.1 and Chromium 156.0.8078.4
were used, with sandboxing enabled and a disposable empty profile.
`npm run distribution -- --require-clean` passed with `dirty=false`;
`npm run test:distribution` passed all 8 tests without skips.
`node examples/test-extension/native-proof.mjs` passed all 13 stages,
observing 2 page-owned connections and exactly 1 command on the successor.
All owned helpers closed before PASS was emitted.

This was discovery evidence, not final SDK acceptance: the parallel core
still had its existing 40 KiB bundle budget and mutation-target updates
pending. Rerun against the final integrated revision; do not transfer this
checkpoint's result to later bytes without checking them.
