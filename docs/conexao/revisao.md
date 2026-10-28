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
