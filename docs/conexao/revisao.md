# Independent connector acceptance review

## Status and scope

Phase A: acceptance matrix and baseline risks, not approval of an implementation.
Reviewed base: `cd3261d996db9b1f8ea7cacf81ac53fe026667f9`; HEAD matched and
the review worktree was clean before this documentation change.
No runtime changes, publication, real account access or graphical processes.
The architecture proposal and implementation SHA have not yet been reviewed.

The shared session brief, review brief and tooling guide are the requirements
for this review. A standalone extension must use one internal MAIN /
document_start hook on the game's socket, with no public Transport,
PageTransport or CDP selection and no parallel socket.

The plan must separately name what shares the hook, parsing, current state and
command ownership. Sharing a hook alone is not sharing a runtime:
`packages/sdk/src/client.ts:58-59,194-202` currently creates state and Actions
and parses frames per client. Document/MAIN-realm sharing is a sufficient
bounded first increment if explicitly chosen; isolated-world bridging must
not be claimed without implementation and browser evidence.

## Acceptance matrix

Severity describes the consequence of leaving a gap in the new contract, not
an exploit classification. Existing tests below are reusable fixtures and
assertions, not proof of the future API.

| ID / severity | Required scenario and closure criterion                                                                                                                                                                                                                                                     | Reusable baseline evidence                                                                                                                                                                | Missing proof / concrete risk                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 / High     | Instantiate the public facade in an independent extension. Early bootstrap captures the socket before any facade attaches. No launcher, transport selection, login or extra socket. Constructor side effects must match the documented lifecycle.                                           | `page-transport.test.ts`: adoption/filter/send tests; `test/sdk-distribution.test.mjs`: IIFE without module loader, relocated ESM/CJS and declarations.                                   | Public baseline still requires a transport. Exercise the new distributable and example manifest in MAIN/document_start; explicitly test whether loading exports, constructing and starting install anything.                                                                                                                                                                                                     |
| A2 / High     | Two facades, then two separately evaluated compatible bundles, share exactly the asserted runtime layers. A frame is parsed/applied once if parser/state sharing is claimed; each subscriber receives its intended notification once.                                                       | `page-transport.test.ts:104`: two transports share a hook.                                                                                                                                | Two objects from one module do not prove independent bundles. Measure hook constructor/send identity, parse/apply count and state generation with a private test seam; do not expose a production metrics API just for this assertion.                                                                                                                                                                           |
| A3 / High     | A mutates nested incoming, outgoing and battle payloads, snapshots and supplied options; B's callbacks, state and options are unchanged. A throws in a listener/error handler; B still receives its notification.                                                                           | `state.test.ts:190,198`: owned/frozen nested snapshots; `client.test.ts`: throwing listener reported; `page-transport.test.ts:120`: subscriber throw isolation.                           | Snapshot freezing does not prove event isolation: `client.ts:249` passes the same packet to listeners. Test typed and catch-all ordering, nested battle events and options retained by reference. Shared state must not mean shared mutable consumer settings.                                                                                                                                                   |
| A4 / High     | Stop/unsubscribe A while B remains active: game socket stays open, B's readiness and subscriptions survive, only A's pending wait is detached/terminated conservatively. Restart A without replaying commands. Last stop behavior must state whether bootstrap continues collecting.        | `page-transport.test.ts:104`; `connection-boundary.test.ts:41,55`; client unsubscribe/idempotent start tests.                                                                             | Combine full facades, pending commands and stop/restart. Baseline stop invalidates that client's state; applying that directly to a shared state would invalidate peers. Stop must not release another consumer's writer ownership.                                                                                                                                                                              |
| A5 / High     | Attach after bootstrap with current complete state: facade sees that state without replaying old domain events/commands. Without a collected complete state: connected may be true, ready must remain false. A pre-hook socket is only discoverable through an explicitly supported signal. | `page-transport.test.ts:92`: pre-hook socket adopted on first send; `state.test.ts:240`: partial versus complete.                                                                         | Bootstrap currently retains no parsed state without clients. Test bootstrap -> full packet -> attach, partial packet -> attach, and never-observed already-open idle socket. Do not promise retrospective capture or fabricate a welcome.                                                                                                                                                                        |
| A6 / High     | Same runtime protocol version reuses ownership; incompatible or malformed occupied runtime entry fails explicitly and leaves the live hook/runtime intact. Failed attach is retry-safe.                                                                                                     | `page-transport.ts:11,75-76` declares a version but returns any existing entry; client failed-start retry test.                                                                           | Add compatible duplicate-bundle and incompatible-version cases, unchanged socket/prototype identity after refusal, no leaked listener and no silent overwrite/fallback. Package version alone is not a runtime protocol compatibility check.                                                                                                                                                                     |
| A7 / High     | Replacing OPEN A with CONNECTING B immediately invalidates completeness and pending connection generation before callbacks; no old traffic, late open/close/send or confirmation can restore readiness or settle a new command.                                                             | `page-transport.test.ts:142,159` and final late-open test; `connection-boundary.test.ts:70`.                                                                                              | Baseline adopts at `page-transport.ts:98` but notifies on open at line 107; the boundary test opens B before asserting stale. Assert stale **before B opens**, failed B, A late traffic, callbacks reading readiness, and B's eventual full/partial state.                                                                                                                                                       |
| A8 / High     | Concurrent A/B commands without requestId cannot both consume the same event/inventory evidence. State the smallest shared writer rule and when it releases. No historical retry/replay after reconnect or restart.                                                                         | `actions.ts:39,79,145,189`: per-instance busy guard; async-send busy test; `actions-buy.test.ts:237,256`: late inventory floors and reconnect.                                            | Two Actions instances bypass a local busy flag. Recommend one in-flight SDK action per document runtime, immediate refusal of the second, no queue; this is correlation safety, not a global account broker or launcher budget policy. Cover identical and distinct commands, stop/disconnect while pending, late evidence and new generation. Raw/manual game writes remain an explicit attribution limitation. |
| A9 / High     | Each dispatch attempt preserves accepted / not-sent / uncertain, with onSend before terminal resolution even for immediate responses. Accepted means local write acceptance, not server acknowledgement. No dispatch notification for dry-run/preflight refusal.                            | `actions-send-outcome.test.ts`: all seven cases; `actions-async-send.test.ts`: delayed outcomes and pre-settlement response; `actions-host.test.ts`: cleanup/refusal/reentrancy fixtures. | Run these semantics through the new facade/runtime and across consumers. Check exactly one outcome, cleanup and writer ownership under observer throw, send throw and disconnect. Async transport fixtures may stay internal; do not preserve public transport choices merely to retain them.                                                                                                                    |
| A10 / High    | Inventory/state inference stays probable; an event without a requestId is not proof of transactional attribution to a specific writer. Disconnect in flight is conservative; a prior matched event must follow the explicitly documented evidence policy.                                   | `confirmations.ts:59-60,92-93,103`; `actions-buy.test.ts`: event/inventory confidence and delayed evidence.                                                                               | Baseline labels a matched purchase event certain. Shared SDK serialization does not exclude identical manual game writes. Decide/document the meaning of confidence and test unrelated purchase/error and repeated identical events; do not advertise exactly-once server confirmation.                                                                                                                          |
| A11 / Medium  | Preserve native WebSocket construction/prototype behavior and host/path filtering. Malformed/oversized frames are bounded and reported by controlled counters; consumer options do not silently change peers' capture/readiness.                                                            | `page-transport.test.ts:49,62`; client malformed/maxPacketBytes tests; state malformed-input tests.                                                                                       | Test protocols argument, subclass/newTarget, static constants, instanceof, invalid construction, non-string frames and multiple socket URLs through shipped IIFE. Define runtime capture limit versus facade-specific delivery settings; a tiny A limit must not poison B's current state.                                                                                                                       |
| A12 / Medium  | Diagnostics remain bounded and contain no raw packets, credentials, DOM text, real IDs or arbitrary page errors in exported artifacts. Performance claims require comparable baseline/repeats.                                                                                              | Existing inspector/redaction tests are candidates, not independently executed in this checkpoint.                                                                                         | No generic bus, daemon, worker or production dependency is justified by this matrix. Async scheduling alone proves no CPU reduction. Validate count/size/error-enum outputs and retained-data bounds if new diagnostics are added.                                                                                                                                                                               |

Test paths without a directory prefix in the matrix are under
`packages/sdk/test/`; source paths without a directory prefix are under
`packages/sdk/src/`. Line references identify the reviewed base, not future
revisions.

## Plan checkpoints and boundaries

Before coding, record the sharing realm, bootstrap/last-stop lifetime, late
attach semantics, version refusal, readiness invalidation point and writer
ownership rule. Keep consumer subscriptions/options distinct from shared
capture/state. These are closure decisions, not a request for a competing
architecture.

Profiles, windows, multiple accounts, automation budgets and policy remain
with launcher/host. SDK writer exclusion must not grow into account-wide
coordination. Do not add a generic transport registry, topic bus, new repo,
daemon or speculative worker. Domain subscriptions do not send implicit
queries. Only the implementation owner edits runtime.

The smallest later browser proof is one local synthetic page plus an unpacked
fixture extension using the shipped SDK in MAIN/document_start, no game URL:
bootstrap, local synthetic WebSocket traffic, late facade attach, second
compatible bundle, stop one consumer and replace the socket while CONNECTING.
Assert no extra socket is opened by the SDK. A Node VM test covers two bundle
evaluations but cannot establish extension injection timing, native browser
WebSocket semantics or isolated-world communication. Reserve a serial browser
window with the coordinator before that proof; no graphical process was
started here.

## Evidence from this checkpoint

Skill invoked: `verification-before-completion`. Its practical effect was to
separate source inspection, executed baseline tests and still-unverified
runtime/browser claims. No bugfix, red/green claim, performance experiment or
browser validation was performed.

The first targeted invocation failed before loading tests because `tsx` was
not installed (`ERR_MODULE_NOT_FOUND`; Node `v20.19.0`). Restored the existing
lockfile dependencies with:

```sh
npm ci --ignore-scripts --no-audit --no-fund
```

Result: passed, 125 packages installed; no manifest/lockfile edit.
Then executed:

```sh
node --import tsx --test packages/sdk/test/page-transport.test.ts packages/sdk/test/connection-boundary.test.ts packages/sdk/test/client.test.ts packages/sdk/test/state.test.ts packages/sdk/test/actions-send-outcome.test.ts packages/sdk/test/actions-async-send.test.ts packages/sdk/test/actions-host.test.ts packages/sdk/test/actions-buy.test.ts
```

Result: **93 passed, 0 failed, 0 skipped** on the reviewed base.
This proves only the selected baseline tests, not closure of the gaps above.
Build, full suite, typecheck, API/distribution checks and browser proof were
not executed in this documentation checkpoint.

After an agreed implementation SHA is supplied, independently inspect its
diff, rerun the applicable unit/build/type/API/distribution checks and update
this document with exact evidence and closure status. Do not implement the
correction being independently reviewed.

## Prepared native-browser procedure (not executed)

This is a preparation checkpoint, not permission to start a browser/server.
The coordinator must reserve the serial window after the implementation and
its clean distribution exist. No native-browser pass is claimed here.

### Available tooling and prerequisites

Read-only discovery in this review worktree found Node `v20.19.0`, npm
`10.8.2`, esbuild `0.23.1`, TypeScript `5.9.3`, tsx `4.23.15` and Python 3.
The repository requests Node 22 in `.nvmrc`; use that version for the later
distribution build rather than treating this baseline environment as the
requested distribution toolchain. The installed Google Chrome executable
exists at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`;
its version, extension-loading support and responsiveness were not tested.

No resolvable local `playwright`, `@playwright/test`, `puppeteer`, `ws`,
`undici` or `chrome-remote-interface` was found. Python imports for
`playwright`, `websockets`, `websocket`, `aiohttp` and `selenium` were absent.
The current Node process has no global WebSocket. No package or browser was
installed for this procedure. The Node VM distribution fixture is available
in `test/sdk-distribution.test.mjs`; it is not native-browser tooling.

Reuse `scripts/build-sdk.mjs`, `scripts/build-bundles.mjs` and the existing
MV3 example manifest pattern (`world: MAIN`, `run_at: document_start`).
Do not load the real-game example unchanged: the fixture extension must
match only its loopback origin and have no game host permissions.

At execution time, first reuse any synthetic server/browser harness delivered
by the implementation owner. If none exists, the missing dependency is a local
WebSocket server and an extension-capable browser control path, not another
production SDK API. A disposable, explicitly approved harness outside package
manifests may supply these; record exact versions and provisioning commands.
Do not quietly install tooling now, hand-roll a general WebSocket stack, or
substitute page script injection for proof of extension document_start.
Installed branded Chrome may restrict command-line extension loading: verify
actual extension execution, not just process startup. If unsupported, report
the prerequisite and use an approved extension-capable ephemeral browser,
not the user's real profile or a bypass of browser safety warnings.

### Fixture and observable assertions

Use an ephemeral empty browser profile and a server bound only to
`127.0.0.1` on an allocated port. Serve one invented page and same-host
WebSocket path `/`, matching the SDK filter. Keep static fixture resources
on other paths. Do not contact a game URL. Create fixture files and results
under session artifacts, not runtime source.

Use two separate extension script files, A and B, each containing the full
verified SDK IIFE followed by its own small wrapper. Each wrapper saves its
own SDK exports before the next global export assignment. This is two
independently evaluated bundle copies, not two clients of one cached import.
One fixture MV3 content-script entry can list `js: ["a.js", "b.js"]` in that
order with `matches: ["http://127.0.0.1/*"]`, `world: "MAIN"` and
`run_at: "document_start"`; it requires no broader host or debugging permission.
If distinct file hashes are required, use different wrapper markers; retain
the identical SDK segment hash and record both full-file hashes. Do not build
a second implementation and call it the tested distributable.

1. A bootstraps at MAIN/document_start but creates no facade yet. B loads
   its copy without attaching. The page's first inline script records that
   the controlled bootstrap marker already exists, constructs the native
   game socket, then waits for the server to send an invented full welcome.
   The server must see exactly one connection, all page-owned; no SDK-created
   connection is allowed. A marker alone is not proof of welcome capture.
2. The page signals a separate attach control from its native socket's
   welcome message listener, registered after the hook's listener, not merely
   after a server write or an arbitrary sleep. Attach A and B and assert connected,
   complete and the expected invented welcome values immediately. Subscribe
   before start where supported and assert no historical welcome/domain event
   is replayed. Send one later delta and assert each active facade sees it
   once with updated state available inside its callback.
3. Stop A. Send another delta: A is locally disconnected/incomplete and gets
   no callbacks for that run; B stays complete and receives the new value.
   The server observes no socket close or extra connection.
4. The page constructs successor socket B while the server deliberately
   withholds its HTTP upgrade response. In the same JavaScript turn after
   construction, record `readyState === CONNECTING`, generation advanced and
   facade B incomplete/disconnected. Delayed handshake, rather than a timer
   race, preserves the observation window. Release the upgrade; OPEN alone
   must not restore completeness. A fresh full welcome does. Old-socket
   traffic/close must not change the successor's state or generation.
5. From active facade B issue one supported harmless command, such as ping
   if still supported by the frozen API. The server records exactly one
   matching frame on the successor, none on the predecessor. Await local
   acceptance; do not describe it as a server transaction confirmation.
   This low-level send does not prove action onSend/reconciliation semantics.
6. Emit a bounded PASS/FAIL record with stage names, generation, connection/
   complete booleans, invented-value comparisons and connection/frame counts.
   Collect explicit failure codes, not raw packets, arbitrary browser errors
   or screenshots of account data. A timeout is a failed/incomplete proof,
   never success. Stop only the owned browser/server helpers and remove only
   their explicitly identified disposable profile/fixture paths.

The server controls handshake/welcome/delta stages; the page exposes explicit
stage completion signals. Do not wait for global networkidle on a held
WebSocket upgrade, or infer native readiness from wall-clock sleeps.

### Separate evidence lanes

| Lane                         | What it establishes                                                                                                                                  | What it does not establish                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Structural unit/VM           | Two bundle evaluations reuse the asserted hook/parser/state/writer; private seam counts one parse/apply per frame.                                   | Native extension injection, native WebSocket semantics or lower CPU.                      |
| Contract unit tests          | Options/payload isolation, stop with owner reservation, busy including cooldown zero, outcomes/onSend ordering, versions and uncertainty.            | Browser loading or production performance.                                                |
| Native fixture above         | Actual MAIN/document_start execution, native socket lifecycle, late state adoption, independent bundles, stop isolation and one transmitted command. | Internal parse count, isolated-world bridge, transactional receipt or production latency. |
| Optional measured experiment | Repeated equivalent baseline/after runs with fixed packet mix, versions and consumer count; median/range of separately measured duration/retention.  | A universal budget, field performance or a conclusion from counters alone.                |

No performance experiment is necessary to accept the native fixture. Do not
grow this preparation into a benchmark framework. Record the implementation
SHA, clean manifest identity, SDK segment hash, wrapper hashes, browser
version and observed stage assertions when the reserved run actually occurs.
Skill `webapp-testing` was invoked for this preparation; its inspect/wait/
cleanup guidance informed explicit stage synchronization and owned-helper
cleanup. Its Playwright examples are not evidence that Playwright is installed.

## Independent review of the standalone/harness front

Reviewed `925e31b490fbd7dc6ef74f6d1d386186e4a892b0` via Git objects, without
editing its implementation. The example uses explicit bootstrap and no
transport; distribution consumers test independent IIFE evaluations and
relocated type/runtime consumption. The native harness implements the planned
held-upgrade observation, native welcome-before-attach signal, stopped
snapshot, successor-only send and bounded output. These are inspection
findings, not runtime passes against an integrated core.

One execution blocker was reported to its author: Playwright defaults to
disabled Chromium sandbox unless `chromiumSandbox: true` is specified. The
coordinator expressly forbids `--no-sandbox`. Confirmed independently in the
provisioned `playwright-core@1.64.1` implementation: its Chromium argument
builder appends that flag when the option is not true. The author reports
the correction locally; its final committed integration must be checked
before execution. A sandbox launch failure must not trigger weakened flags.
The author's subsequent `d4c06d812e42aa5b93d9bceae652683a1223d329` additionally
moves PASS output after helper cleanup and handles server bind failure; these
changes were inspected, not executed.

The coordinator authorized disposable tooling provisioning outside the
checkout, without authorizing browser/server execution. Provisioned official
Node `22.23.4` (npm `10.9.9`), Playwright and playwright-core `1.64.1`, and
ws `8.22.0` into the review session's `files/sdk-native-tools` directory.
The Node archive matched its official SHA-256 checksum. npm install used
`--ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org`.
The isolated package lock records registry URLs and SHA-512 integrities;
its SHA-256 is
`8132bf454e426d234e1fe667c2cd226a337fef40a94e79a670913a64be438659`.

Playwright downloaded its Chromium revision `1248` (Chrome for Testing
`156.0.8078.4` according to download metadata), headless shell and FFmpeg
only into that directory's `browsers/` cache. The browser executable SHA-256
is `c8509aee32abd6977968e9999769980b7a420dea05402d90042d9e5b41db15ef`.
Download sources, versions, commands and package integrities are retained
in the session artifact `sdk-native-tools/provenance.json` and package lock.
No browser, server, installed Chrome profile or authentication was used.
The SDK package manifest/lockfile and runtime remain unchanged.

Execution remains conditional on the corrected integrated SHA, green build
and coordinator's serial window. The owner and coordinator receive the
absolute tooling path and exact environment command through session messages;
machine-specific paths do not belong in the repository's portable commands.

## Executable review checkpoint: core ff459f5 and integration ae4f514

This checkpoint is **not final acceptance**. The independent reviewer checked
out exact Git objects in this review worktree, did not edit runtime/harness,
then returned to the documentation branch. The runtime author owns all fixes.

| ID / severity                 | Evidence and observed defect                                                                                                                                                                                                                                                                                                                 | Required closure                                                                                                                                                                                                       | Status                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| R1 / High / A7                | Core `ff459f5a2562e5a09a830b898071ade6ea61e285`, `page-session.ts:244-247` and `client.ts:78-103`: A's welcome listener constructs a successor CONNECTING socket during fan-out. B still receives the old welcome with gold 101 while already generation 2, incomplete and disconnected. Attach/run checks do not guard delivery generation. | Stop old-generation delivery between consumers and between phases/listeners of the same facade; cover packet, battle/outgoing/connection paths as relevant. The successor's later welcome must still deliver normally. | Open; reproduced independently against built ESM and IIFE, reported to runtime author/coordinator. |
| R2 / Medium / A4              | Same core, `client.ts:114-122`: A is OPEN/complete; its stop state callback restarts A once. Connection callbacks observe `[true,true,true]` followed by `[false,true,true]` (event, connected, complete). The second callback is the stopped run's tail even though the new run is active.                                                  | Restart/unsubscribe during stop notifications must invalidate remaining old-run delivery. Keep peers and native socket intact. No stale false event after the new run's true event.                                    | Open; independently reproduced, reported to runtime author/coordinator.                            |
| R3 / Medium / migration       | Integration `ae4f5141d7197b70c292168c24fa772a3545088b`: `docs/architecture.md:7-18,157,224` still teaches public Transport/PageTransport; `docs/distribution.md` still advertises async transport consumption.                                                                                                                               | Update directly related architecture/distribution documentation to the frozen standalone API, without presenting private test seams as consumer choices.                                                               | Open; reported to runtime author.                                                                  |
| R4 / Existing acceptance gate | Full SDK suite on ff459f5: standalone bundle 42.6 KiB versus unchanged 40 KiB budget; 256/257 pass.                                                                                                                                                                                                                                          | Correct within the existing budget and rerun final checks; do not relax the limit.                                                                                                                                     | Known to author/coordinator before this review; independently confirmed.                           |

R1 and R2 have an independent two-test reproducer in the review session
artifact `core-reentrancy-review.test.mjs`, outside the repository. It consumes
the actual built IIFE and creates no browser/server. Both assertions failed
on the reviewed core as expected; this is red evidence, not proof of a fix.
The R2 expected sequence is only `[true,true,true]`, with the facade still
connected; its reproduction is not the socket-generation case in R1.

### Executed checks and native proof

On core ff459f5, SDK build and workspace typecheck passed under Node
`22.23.4`; that initial supplemental invocation used tooling npm `10.9.9`
and is not claimed as the repository's prescribed npm toolchain.
The full SDK suite gave 256 passed, 1 failed, 0 skipped (R4 above).

For integration ae4f514, used Node `22.23.4` and the repository's npm
`10.8.2`, without changing its package manager or lockfile:

```sh
npm run distribution -- --require-clean
npm run test:distribution
```

Results: clean reproducible distribution passed (`dirty: false`, exact
revision ae4f514); distribution checks **8 passed, 0 failed, 0 skipped**.
The generated manifest independently records npm `10.8.2`, TypeScript
`5.9.3`, esbuild `0.23.1`, darwin/arm64.

After the coordinator released an independent serial window, executed the
unmodified integrated native harness using the disposable tooling:

```sh
SDK_PROOF_TOOLS="$TOOLS" PLAYWRIGHT_BROWSERS_PATH="$TOOLS/browsers" \
  DEBUG=pw:browser "$TOOLS/node-v22.23.4-darwin-arm64/bin/node" \
  examples/test-extension/native-proof.mjs
```

Result: **PASS, all 13 named stages**, Chromium `156.0.8078.4`, two page-owned
connections and one ping exclusively on the successor. This independently
demonstrates actual MV3 MAIN/document_start execution, welcome capture before
late attach without replay, two full bundle evaluations, stop isolation,
held CONNECTING replacement, OPEN versus completeness and stale socket
traffic/close suppression. It does not cover the callback-reentrant R1/R2.

The exact SDK SHA-256 is
`831860c9e31740c4b53f50948d052307e6fb4165936d8074d8cf4ec4fb2be687`.
Full wrapper hashes are
`7366d2ce60900b12cf3dc3cc13e085152c3387b11eadd8b80d58f8c493a28bce`
and `92353fffd78f9534c440093fda5e374baa3ca47e7416bcda8995a96d8095b2f4`;
these match the integrator's separately reported run.

Sandbox correction `469a3957301da57f57787ad3647ca94056e49986` was inspected
via Git and is present in the executed integration. The actual Playwright
launch arguments were checked: no `--no-sandbox`, `--disable-web-security`
or `--ignore-certificate-errors`. The browser exited with code 0; its
specific PID no longer existed, and both its generated fixture and fresh
profile paths were absent after cleanup. PASS was emitted after cleanup.
No installed Chrome/profile was used. The reviewer explicitly returned the
serial window and will not launch helpers again without a new reservation.

Bounded harness output, lifecycle evidence, distribution output and red
repro output are kept in review-session artifacts. Native success is an
early integration proof only: R1/R2 fixes, documentation migration, bundle
budget, mutation/coverage and the exact final clean SHA still require
independent closure. No performance improvement is claimed from this run.

### Focused R1/R2 correction check

Subsequently reviewed exact correction
`fc0fb1f36d5e026be02d6643dc7f23e16360e19c` without editing it. Runtime fan-out
now captures generation and aborts when it changes. Facade delivery captures
both attach/run and generation across state, typed packet, catch-all, battle,
outgoing and connection phases. Stop notification uses a stopped-run token
and respects listener removal, so a restart invalidates its remaining tail.

Executed on that exact SHA with Node `22.23.4` and npm `10.8.2`:

```sh
npm run build -w pokeidle-community-sdk
SDK_REVIEW_WORKTREE="$PWD" node --test "$REVIEW_ARTIFACTS/core-reentrancy-review.test.mjs"
node --import tsx --test packages/sdk/test/page-session.test.ts
```

Results: SDK build passed; **both independent public-IIFE repro assertions
passed (2/2)**, versus 0/2 on ff459f5; page-session suite **26/26 passed**.
R1 and R2 are closed for this focused correction, subject to preservation in
the final integrated SHA. No browser/server was started for this check.
R3 migration, R4 budget and final broad/mutation/distribution gates remain
separate; the 13-stage native proof still identifies ae4f514, not fc0fb1f.

### R3 documentation correction

Independently read the complete revised architecture and distribution diff at
`2786fc86f53f991c7564ae84e9efd71a6f143695`. Public transport recipes were
replaced with bootstrap/facade usage, shared immutable policy, document/MAIN
scope, compatible-runtime reuse, generation/stop/writer semantics and
Promise-based sends. Future host/isolated-world bridges remain explicitly
unimplemented, without a second parser or CDP fallback. Native and VM proof
lanes remain distinct and no final budget result is claimed.
R3 is closed for that documentation checkpoint, subject to preservation in
the consolidated revision. No runtime tests were run for this docs-only check.

### Focused generated-name codec review

Reviewed `d2e20b27c1b04a93fded097c4ebfc2087a002738`: a small pure decoder
expands generated constant name prefixes; no payload parser, action guard or
runtime ownership code is changed in this commit. The extractor already
restricts the relevant identifiers to letters/digits/dots, excluding the
codec's space/colon/comma delimiters. Generated readonly tuple types preserve
the public literal unions and runtime name lists are frozen.

Independent checks under Node `22.23.4`:

- `node --test test/generate-protocol.test.mjs`: **9/9 passed**, including
  sorted identifiers, empty suffix and empty-list round-trip.
- Transpiled the exact original registry from fc0fb1f and the codec registry
  from d2e20b2 into separate VMs; deep-compared **all five exports**: 51 packet
  names, 133 event names, 216 commands and 51/133 field maps were identical.
- Compared both registry representations in the **same d2e20b2 kernel**,
  replacing only the registry through an esbuild in-memory onLoad seam.
  Used the bundle-size test's entry and flags (browser/ESM/chrome111, minify,
  `new PokeIdleClient().start()`). Literal registry: 43,798 raw bytes /
  14,287 gzip bytes; prefix registry: 41,833 raw / 14,348 gzip.

The localized tradeoff is acceptable for the existing raw-size gate: 1,965
raw bytes saved with 61 extra gzip bytes on this reviewed graph. It is not
a network/performance improvement claim or approval of opaque compression.
This graph is not the author's pending simplified kernel and still exceeds
40,960 bytes; **R4 remains open until the exact consolidated build passes
the unchanged strict budget**. No codec/runtime implementation was edited
by the reviewer.

### Consolidated kernel and independent native15 check

Reviewed and executed exact clean revision
`ca704f2a64dc33ca2e45a13c2c63cfaadbc705a1`, including kernel a74b3ec and
codec d2e20b2. The integrator's 1500f9d1 has the same Git tree,
`05c3d7d1bdac213600fa3539cbdeb39804f13223`; this is tree equivalence, not
permission to reuse results for subsequent runtime edits.

Inspection found no new functional blocker in the kernel reduction.
Removing the internal duplicate Inspector and any-battle subscriptions
retains the facade's public diagnostics and subscriptions, now exercised by
the migrated client/sample/Inspector integration tests. Native private
members retain encapsulation. Shared argument guards preserve numeric
validation before offline/busy refusals. The new tests cover definitely
not-sent owner stop, detached-risk cooldown after eventual reconciliation,
and generation replacement inside onSend without losing its accepted receipt.

All commands below used Node `22.23.4` and explicit npm `10.8.2`, with the
Node22 directory first in PATH for subprocesses:

| Independent check                         | Result on ca704f2                                                    |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `npm run build`                           | Passed SDK and example                                               |
| `npm run typecheck`                       | Passed SDK and example                                               |
| `npm test`                                | 267 SDK and 33 repository tests passed, zero skips                   |
| Public-IIFE external R1/R2 repros         | 2/2 passed                                                           |
| `npm run lint`                            | Passed, including its build prerequisite                             |
| `npm run coverage`                        | Passed: lines 99.28% (floor 94), branches 96.03% (floor 92)          |
| Exact bundle-size entry and flags         | 40,935 raw bytes / 14,213 gzip; strict 40,960-byte ceiling unchanged |
| `node scripts/mutation.mjs page-session`  | Two selected mutations killed, zero problems; source restored clean  |
| `npm run distribution -- --require-clean` | Reproducible, source ca704f2, dirty=false                            |
| `npm run test:distribution`               | 11/11 passed, zero skips                                             |

R1 and R2 remain closed on this integrated runtime. R3's revised architecture
and distribution documents are present. R4 is closed on this exact build,
with only 25 bytes below the strict ceiling: this is a fragile raw-size
margin, not a latency, parse-cost or wire-size improvement claim.

The coordinator then reserved an exclusive native window for this candidate.
Ran the unchanged native harness using the disposable tooling and fresh
profile: **all 15 stages passed**, Chromium `156.0.8078.4`. This includes the
reentrant old-generation fan-out regression, in addition to the earlier
13-stage sequence. There were three page-owned sockets and exactly one
current-socket ping, not a parallel SDK connection.

Artifact SHA-256 values:

- SDK: `960b0802467783beaea0c20756b9a2bd765792ce7ae1e76fb1eca73ef2b2a665`.
- Wrapper A: `543e3693b7bd3dab6f202999dcefd9105a2241119f37e5057c54d13c8a867b8a`.
- Wrapper B: `4361e62a9fabde8b9859addafeed1e7f2bee44ff1bb215b93039e5c7786c6560`.

Actual launch arguments again contained none of `--no-sandbox`,
`--disable-web-security` or `--ignore-certificate-errors`. The specific
browser PID exited with code 0 and no longer existed; both generated fixture
and profile were removed. The harness emitted PASS after closing the local
server/sockets and completing cleanup. The reviewer returned the window;
no helpers remain. This is new evidence for ca704f2, not a relabeling of the
ae4f514 native13 or the integrator's earlier native15.

### R5: mutation infrastructure errors counted as semantic kills

The size-filter change itself is appropriate: the mandatory baseline still
enumerates the full SDK suite including bundle-size; mutated runs exclude
only `bundle-size.test.ts`. Thus code growth alone no longer kills a
semantic mutant. Missing source patterns are reported as NOT APPLIED and
fail the run.

However, `scripts/mutation.mjs` still classifies any TAP `not ok` line as a
kill. An independent real Node22 repro, outside the checkout, imports a
nonexistent module from a test file. Node exits 1 with ERR_MODULE_NOT_FOUND
and a file-level `not ok` / ERR_TEST_FAILURE, before executing any behavioral
test; `testsFailed(stdout + stderr)` nevertheless returns true. The existing
test checks only a bare error string without TAP, so it misses this case.
This predates the size-filter change but violates the final gate's explicit
requirement to distinguish semantic failures from import/compile failures.

**Status: open, owner notified.** This is an evidence/runner issue, not a
new SDK runtime defect. The two focused mutation results above do not
constitute full mutation acceptance. Closure requires runner tests covering
real loader/transform failures versus behavioral failures, retained
missing-target handling, and a complete run with no infrastructure false
kills. The reviewer has not implemented the correction. Runtime/native
results need not be rerun for a runner-only correction if exact SDK bytes
remain identical; any runtime change requires a new relevant check.

### Independent cross-bundle processing-count check

Reviewed and executed test-only checkpoint
`db84585fa34a4470e67e1cbca5df4ec8e4b9451e`; its only difference from ca704f2
is `test/sdk-distribution.test.mjs`. The test evaluates two complete IIFEs
without module-cache reuse and verifies their exported GameState classes
are distinct. Within an isolated VM, it counts JSON.parse calls for one
exact synthetic frame and applyPacket calls across both class prototypes.
Instrumentation is restored in finally.

The observed requirement is one parse, one total state application and gold
102 in both attached facades. This directly tests shared parsing/state,
rather than inferring it solely from hook identity or public snapshots.
Independent Node22/npm10.8.2 clean reproducible distribution and all 11
distribution checks passed, zero skips. SDK SHA-256 remained exactly
`960b0802467783beaea0c20756b9a2bd765792ce7ae1e76fb1eca73ef2b2a665`.
No browser was started; the ca704f2 native15 evidence still identifies these
same SDK bytes. This check does not establish CPU, latency or allocation
improvements and does not close R5.

### Runtime-owner final runner and repository gates

The runner correction is isolated in `f193bc7`, followed by the Node20
compatibility correction `ddf0216`. It consumes native Node test events,
not TAP `not ok` text. Executed tests exclude file wrappers, skipped/todo
tests and suites; an unsuccessful process wrapper invalidates the entire
run even if another file also has a genuine assertion failure. Missing
or incomplete reporter output is invalid. Invalid runs are reported as
problems, never credited as semantic kills or expected survivors.

Real subprocess regressions exercise passing tests, assertion failures,
TypeErrors in executed tests, missing imports, JavaScript syntax errors,
TypeScript/tsx transform errors, empty files, no-test modules, skipped/todo
tests, empty suites, process crashes and mixed semantic/infrastructure
failures. The focused runner suite passes 5/5 on Node `20.19.0` and
`22.23.4`. Native pass/fail events are used on both versions; the first
correction's dependence on Node22 per-file summary events was detected and
removed rather than bypassing Node20 checks.

The first full run honestly reported 76 killed mutations and one survivor:
removing the internal kernel's stale-state invalidation on open. The
transport seam's boundary callback is optional, and its open callback
denotes a new connection without requiring a previous close. Test-only
checkpoint `03ef51bd9ef88c0ab8203494bf622effb0e9433a` covers that contract:
old complete state becomes stale before connection observers run, a sale
is refused without sending, and a new welcome restores completeness.
The three client-core mutations then all failed semantically.

Final author-side gates on that checkpoint used Node `22.23.4` and npm
`10.8.2`, including nested npm/Node subprocesses:

| Command                                   | Result                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run lint`                            | Passed, including SDK/example build                                                |
| `npm run typecheck`                       | Passed SDK and example                                                             |
| `npm test`                                | 268 SDK and 34 repository tests passed, zero skips                                 |
| `npm run format:check`                    | Passed                                                                             |
| `npm run coverage`                        | Lines 99.28% (floor 94), branches 96.03% (floor 92)                                |
| `npm run mutation`                        | All 77 mutations killed; zero invalid runs, survivors, missing targets or problems |
| `npm run distribution -- --require-clean` | Reproducible, source 03ef51b, dirty=false                                          |
| `npm run test:distribution`               | 11/11 passed, zero skips                                                           |

The full `npm test` also passes on Node `20.19.0`/npm `10.8.2` with the
same 268+34 tests and zero skips. Node24 and the other operating systems
were not executed in this local closure; the existing CI matrix remains.
The 77-entry mutation list and coverage/size thresholds were not relaxed.
Baseline mutation tests include size; only mutant runs exclude that file.
Sources were exclusively owned during mutation execution and restored
byte-for-byte afterward.

`git diff ca704f2 -- packages/sdk/src` is empty: no runtime source changed
to close R5 or the survivor. The full public IIFE remains SHA-256
`960b0802467783beaea0c20756b9a2bd765792ce7ae1e76fb1eca73ef2b2a665`;
the package remains
`2c73dd981603632f25646163f3ef6d826b7e4fe8f0300be1e3c13076b35c46d1`.
Thus the independent ca704f2 native15 proof identifies these same SDK
bytes; it is not a new browser execution by the runtime owner. The
separate official tree-shaken client budget entry remains 40,935 raw /
14,213 gzip bytes under the strict 40,960-byte raw ceiling. That budget
entry is not the complete all-exports IIFE.

**Temporal protocol limit:** the independent live `protocol:check`
observed upstream app.js moving from `1.374.0` to `1.380.1`, including
additions in praca/centro/campo.init. This is upstream drift, not a codec
equivalence failure, and it is not recorded as a green live check here.
The extracted protocol/catalog snapshot is deliberately frozen for this
delivery; it was not regenerated to hide drift or change the size gate.
The reported checks establish behavior against that snapshot and the
synthetic fixtures, not complete compatibility with every future game
version. No account, launcher IPC/isolated-world bridge, publication or
CPU/network performance claim is included.
