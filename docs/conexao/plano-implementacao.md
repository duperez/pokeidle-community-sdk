# Proposed implementation plan: shared page connector

## Status and scope

This is the implementation owner's proposal, not the architecture decision.
Baseline: `cd3261d996db9b1f8ea7cacf81ac53fe026667f9`.
Only this documentation checkpoint is authorized before the coordinator
freezes the lifecycle and ownership contract after architecture/review.
No runtime, public API, package or distribution change is part of this checkpoint.

The committed destination is a shared page runtime, not one hidden transport
and parser per client. The recommended first increment shares one document's
MAIN realm. Isolated-world and launcher bridges are a subsequent, explicitly
sequenced consumer integration; this increment must define the attachment
boundary they will use without advertising those integrations as implemented.
No new game connection, login, account coordinator, worker or framework.

## Baseline evidence

- `page-transport.ts` shares a hook through a global symbol, but every
  `PokeIdleClient` still parses traffic and owns independent state/actions.
- The shared hook records `version: 1` but accepts an existing hook without
  checking its shape or version. Its shared object contains the native socket.
- `start()` installs capture and attaches a consumer together. Loading the
  IIFE alone installs nothing. A socket created earlier is adopted only when
  its later send is intercepted; missed frames are not recoverable.
- `client.ts` invalidates completeness on open/close/stop; `run` filters
  callbacks retained by a stopped client. Replacement while CONNECTING
  needs an explicit generation boundary, not just a later open notification.
- State snapshots are private/frozen, but a shared runtime cannot expose
  `GameState.applyPacket` or `markStale` as consumer mutation capabilities.
  Sharing one parsed packet must not introduce mutable payload aliases.
- Action receipt ordering, uncertainty and conservative inventory floors
  already have dedicated tests. Preserve these semantics across consumers.

## Proposed ownership to arbitrate

| Resource                                                       | Proposed owner                 | Required consequence                                                     |
| -------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| Native socket, hook and replacement generation                 | One internal page connector    | No public socket/transport handle; never close the game's socket         |
| Parser, state merge and current immutable data                 | One runtime per document/realm | One processing pass per frame, independent of consumer count             |
| Bootstrap and capture lifetime                                 | Page runtime                   | Capture can precede the first consumer and outlive its detach            |
| State access and event subscriptions                           | Consumer facade over runtime   | No state mutators; detach cannot stale peers; no historical event replay |
| Dispatch, one-in-flight exclusion and evidence floors/cooldown | Shared runtime writer          | No second consumer can create a competing independently reconciled write |
| Action receipt, terminal result and observer                   | Originating invocation         | Exactly one owner; accepted is not confirmed; no request-id claim        |
| Presentation, persistent budgets and automation cadence        | Host                           | No SDK account persistence, scheduler product or multi-account registry  |
| Inspector and listener error handlers                          | Consumer-local by default      | A reset, privacy option or throwing callback cannot change peers         |
| Capture/parser limits and shared writer configuration          | Immutable runtime policy       | Conflicts are explicit; no silent first-consumer-wins configuration      |

Consumer-local Inspector recording may incur per-consumer diagnostic work:
do not equate one parser with zero fan-out cost. The bootstrap must not start
retaining payload samples merely because no consumer has supplied options.
No unbounded raw-frame history is required for late attachment.

Separate core faults from consumer observer faults. Route observer errors
only through their owner's guarded handler; define the bootstrap/core error
path before implementation so an error is neither swallowed nor broadcast
with another consumer's private context.

For commands, prefer rejecting an overlapping write explicitly over adding
a queue/retry subsystem. All SDK send paths must reach the generation-aware
dispatcher; a low-level send must not silently bypass an active reconciled
write. The exact rejection shape and the treatment of non-writing queries
remain decisions, not guesses based on command names.

## Executable increments and proofs

### 1. Freeze the contract and capture the baseline

Record the approved construction/bootstrap/attach/start/stop signatures,
scope of sharing, runtime protocol version, errors and option ownership.
Use the same decisions in the independent review and launcher migration.
Do not expose a page injection or transport option as the replacement API.

Run the existing baseline checks before changing production code. Record
the exact environment and command outcomes outside committed account data.
For each behavioral increment, write a test naming the broken behavior,
observe the intended assertion fail, implement the smallest change, and
rerun the affected tests before broad validation. Do not delete inherited
implementation under a generic TDD instruction.

Acceptance: each test has a hand-derived expected outcome, a named realistic
regression it catches and a production behavior rather than a source-text
assertion. API snapshot changes alone are not red/green behavior evidence.

### 2. Separate bootstrap from consumer attachment

Keep one internal hook around the existing host/path-filtered game socket.
Bootstrap is explicit and idempotent; constructor side effects must follow
the frozen decision. An ordinary standalone consumer must also have a
supported way to start without any launcher or separate bootstrap product.
Retain the game's own socket creation and reconnection behavior.

Acceptance:

- Bootstrap before a socket and before any consumer captures the invented
  welcome; a later consumer reads current complete state without event replay.
- If no runtime captured the welcome, late socket adoption stays incomplete.
  No hidden query, reconnect, login or fabricated baseline is emitted.
- Two compatible copies cause one hook and one native send per API dispatch.
  A mismatched or malformed rendezvous fails explicitly without replacing
  the live runtime, altering its state or stacking another patch.
- Other hosts/paths and binary/malformed/oversized frames retain their
  documented treatment. No game WebSocket is constructed by SDK bootstrap.

Reuse `page-transport.test.ts`, `packets.test.ts`, `client.test.ts` and the
existing fake WebSocket pattern. Keep injection seams internal to test helpers.

### 3. Move capture/state ownership into the shared runtime

Apply each accepted frame once before notifying consumers. A new adopted
socket, including a CONNECTING successor, starts a generation that cannot
inherit the predecessor's complete flag. Ignore predecessor open/message/
close/send events and callbacks retained by a previous consumer attachment.

Acceptance:

- Two consumers see the same coherent current state; neither can call a
  runtime state mutator or modify another consumer's packet/event payload.
- Mutating or throwing in one listener does not alter peer state/events or
  prevent other notifications; its error handler is isolated too.
- A socket replaced before open immediately loses prior readiness; stale
  events never restore it. Only a valid current full state restores complete.
- Bootstrap with zero attached consumers keeps only the current bounded
  state/required reconciliation resources, not a frame/event replay log.

Reuse `state.test.ts`, `connection-boundary.test.ts` and `errors.test.ts`.
Add behavior tests for read-view ownership and compatible independent bundles,
not only two instances importing the same module cache.

### 4. Attach/detach and option ownership

Implement per-consumer subscriptions, diagnostics and error ownership around
the shared core. Preserve the distinction between stopped consumer readiness
and runtime completeness. Specify whether stop retains a last-known snapshot
and how restart attaches to the runtime's current state.

Acceptance:

- Stop/unsubscribe is idempotent, releases only that consumer's resources
  and neither closes the socket nor changes a peer's readiness.
- Restart can use continuously maintained current data without pretending
  missed events were delivered. If capture did not exist, it stays incomplete.
- A consumer cannot reset a peer's Inspector, change shared limits or
  inherit another consumer's onError. Conflicting shared policy is rejected.
- A fresh document has no previous runtime, consumer data or account state.

Reuse Inspector reset/privacy canaries and lifecycle callback tests.
Do not introduce a public reset/destroy hook solely for test cleanup.

### 5. Share the writer without changing evidence strength

Reuse existing Actions, dispatch/confirmation helpers and conservative floors
as far as the frozen ownership contract allows. Bind an invocation to its
origin and connection generation. Do not reconstruct an action from replayed
traffic or assume matching events carry a server request id.

Acceptance:

- Simultaneous conflicting actions from two consumers produce one native
  write and an explicit refusal/busy outcome for the other; no hidden queue.
- Low-level sends cannot bypass the agreed writer exclusion.
- onSend precedes every terminal outcome after dispatch, including an
  immediate game response and a send settlement delayed past stop/replacement.
- Definite refusal, acceptance and uncertain errors retain their meaning.
  Uncertain writes retain conservative accounting and can receive later evidence.
- Disconnect, replacement and owner detach settle pending promises under
  the agreed contract without abandoning shared floors or freeing an unsafe
  duplicate write; stopping a reader does not cancel a peer's action.
- Equal manual operations remain indistinguishable where the protocol lacks
  correlation. Serialization does not upgrade probable evidence to certain.

Reuse `actions-send-outcome.test.ts`, `actions-async-send.test.ts`,
`actions-buy.test.ts`, `actions-sell.test.ts`, `actions-limits.test.ts`,
`send-guard.test.ts`, `FakeHost` and `FakeScheduler`. Tests must exercise
shared production behavior, not assert that a fake sent to itself.

### 6. Remove public transport selection and migrate standalone usage

Remove transport/page/socket types and options from the root public API,
including the obsolete public generic if its only purpose was selectable
transport send types. Internal implementation interfaces may remain.
No hidden alias, deprecated transport argument or silent compatibility path.
Existing JavaScript configuration containing transport must not silently
switch to an unintended page connection.

Update README, architecture, example MAIN bootstrap/consumer code, example
manifest, CHANGELOG, API snapshot, type consumers, bundle-size test and
distribution smoke tests together. Correct the example's stale read-only
descriptions while accurately distinguishing manual actions from startup.

Acceptance: the independent extension uses the root package without a socket,
transport, launcher or CDP; state/events/actions needed by existing consumers
remain present. All removed exports and signatures have a documented migration.
Update literal mutation targets affected by moving or changing hook code.

### 7. Validate public artifacts and browser-specific behavior

Run the existing ESM/CJS/IIFE build, package/API checks and safety tests.
Execute the actual IIFE in a synthetic page, including two independent
compatible copies and one incompatible copy, rather than proving only an
internal fake can call a facade.

For browser evidence, request the coordinator's serial window first. Use an
ephemeral local synthetic game/extension and the distributed bundle, with
no game URL, authenticated profile, external extension or new Electron.
Demonstrate actual document-start MAIN capture, native socket replacement
and consumer attachment. A VM fake cannot prove browser injection timing.
Do not claim isolated-world bridge support from same-realm tests.

Before any performance comparison, use equivalent synthetic inputs with a
fixed packet mix/size and one versus two consumers. Record browser/runtime
versions and repeat baseline/after runs at least three times, reporting
median/range and conditions. Parser/state application counts establish
sharing; CPU duration/retention observations establish only lab costs.
Keep existing bundle-size budgets; do not invent universal timing limits
or claim that moving code into async functions removes renderer work.

### 8. Review, checkpoint and downstream integration

Give the reviewer the exact implementation SHA, changed behavior, command
outcomes and artifact provenance. Apply focused corrections with tests and
rerun affected/full required checks. Commit the verified local implementation
before producing the final clean distribution manifest for that SHA.

Only after standalone proof and independent review does the coordinator
sequence launcher integration against that exact SDK SHA. A host bridge
must call the same page runtime; it is not another socket transport.
No push, PR, release or account operation is part of this plan.

## Commands and evidence levels

All commands below are planned, not results from this documentary checkpoint.
Run from the SDK worktree with repository Node/npm versions. During TDD,
combine only the affected test selectors in the existing node:test runner:

```sh
node --import tsx --test packages/sdk/test/page-transport.test.ts packages/sdk/test/connection-boundary.test.ts
node --import tsx --test packages/sdk/test/actions-send-outcome.test.ts packages/sdk/test/actions-async-send.test.ts
```

Adapt file names only when the approved refactor moves a test. Review an
intentional API diff before accepting its regenerated snapshot:

```sh
UPDATE_API_SNAPSHOT=1 npm run test:sdk
npm run format:check
npm run build
npm run lint
npm run typecheck
npm test
npm run coverage
npm run mutation
npm run distribution -- --require-clean
npm run test:distribution
```

The final distribution requires a clean committed tree. Generated dist,
tarballs, manifests and local logs remain in their existing ignored paths,
not in the documentation checkpoint. A changed API snapshot is committed
code metadata, never a substitute for public runtime behavior tests.
Browser/performance results must name their command, artifact SHA and proof
boundary separately from node:test and the launcher's later bridge tests.

## Decisions requiring arbitration before runtime edits

1. Public construction and bootstrap names/side effects; whether constructor
   or start implicitly ensures bootstrap while explicit early bootstrap also
   remains available. No transport option in either alternative.
2. Confirm same-document MAIN sharing for the first increment and the exact
   attachment boundary reserved for subsequent isolated-world/host bridges.
   Do not claim that latter bridge already exists.
3. Shared Actions policy versus per-consumer protections: conflict behavior
   for differing action options, capture limits and schedulers; low-level
   command exclusion/refusal shape; owner-stop settlement and observers.
4. Diagnostic/core error ownership before consumers exist, privacy defaults,
   local Inspector behavior and immutable packet/state facade semantics.
5. Rendezvous version/capability compatibility with the existing version-1
   hook: explicit rejection versus a demonstrated safe migration; no silent
   replacement of a live old hook.

Each residual goes through at most two discussion rounds, then coordinator
arbitration. Once frozen, routine implementation/testing/checkpoints proceed
without another user permission gate.

## Skills actually read and applied in this phase

- `test-driven-development` and `writing-good-tests.md`: behavior-first
  increments, literal expectations, meaningful red/green evidence and no
  test-only production control surfaces. No tests have been authored yet.
- `verification-before-completion`: planned commands are explicitly not
  passing results; documentary claims require fresh diff/content checks.
- `webapp-testing`: separate local browser proof from fake/VM evidence,
  inspect before interaction and close owned helpers. No browser/helper
  has been started or Playwright dependency installed.
- `performance` and `references/MEASUREMENT.md`: comparable repeated lab
  conditions and uncertainty, not generic web budgets or field conclusions.
- `systematic-debugging` is listed in the shared tool inventory but has not
  been read/applied here; no runtime defect investigation is underway.

Skills were read from their installed files because they are not in this
session's callable skill catalog. No dependencies or tooling were installed.
