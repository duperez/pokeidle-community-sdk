# Standalone connector architecture proposal

## Status, scope and evidence

This is a proposal for discussion and implementation, not a description of
functionality already delivered. Reviewed baseline:
`cd3261d996db9b1f8ea7cacf81ac53fe026667f9`; HEAD matched that revision and
the worktree was clean before creating this document. No runtime was changed.

Recommendation: one runtime per document/MAIN realm, explicitly installed at
`document_start`, with one hook, one parser, one canonical state and one action
coordinator. Clients are facades with their own subscriptions, errors and
diagnostics. The game owns login, connection, reconnection and WebSocket closure.
The host owns accounts, profiles, windows, persistent budgets and automation.

This increment must actually share between two compatible copies in the same
MAIN global, not only between imports of one module. It does not cover different
globals, iframes, isolated worlds, processes or extension origins. A future
isolated-to-MAIN bridge will adapt this runtime's operations; it will not be
another WebSocket mechanism or a public transport option.

Baseline evidence:

| Location                                             | Relevant behavior                                                                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/sdk/src/page-transport.ts:17,74-76,97-139` | Global-symbol rendezvous; constructor/send adoption; replaced socket silenced; existing version not validated.                            |
| `packages/sdk/src/client.ts:53-60,193-210`           | Each client creates state/Actions and parses independently. Sharing only the hook does not satisfy the goal.                              |
| `packages/sdk/src/client.ts:66-111`                  | Idempotent start/stop and per-run guards; stale on open/close, not immediately on adopting a CONNECTING successor.                        |
| `packages/sdk/src/client.ts:245-256`                 | Exceptions are isolated, but listeners receive the same mutable object.                                                                   |
| `packages/sdk/src/state.ts:49-60,99-103`             | Private frozen copies already exist; markStale retains old values.                                                                        |
| `packages/sdk/src/actions.ts:39-55,181-225`          | inFlight, floors, limits and ledger are per Actions instance; listeners are armed before sending and onSend precedes the terminal result. |
| `packages/sdk/src/confirmations.ts:28-113,117-169`   | Event/inventory evidence without a request id; not a transaction receipt.                                                                 |
| `examples/test-extension/manifest.json:7-13`         | The independent extension already declares MAIN/document_start.                                                                           |

## Proposed public API

The names below are proposed; freeze them before implementation.
Keeping `PokeIdleClient` and existing domain APIs reduces migration work.

```ts
// Run in MAIN/document_start, even if the interface mounts later.
import { bootstrapPageSession, PokeIdleClient } from 'pokeidle-community-sdk';

bootstrapPageSession();

const client = new PokeIdleClient({ onError: handleSdkError });
const off = client.state.onChange(() => render(client.state));
client.start();

if (client.connected && client.state.complete) {
  // Current values for this generation, not command confirmation.
}

off();
client.stop(); // Does not close the socket, stop peers or remove the runtime.
```

Proposed contract:

| Surface                                | Semantics                                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bootstrapPageSession(options?): void` | Installs/adopts the runtime early; idempotent for equal normalized configuration. Returns neither a socket nor a mutable runtime.                                                                |
| `new PokeIdleClient(options?)`         | Creates only a stopped facade; no hook, DOM, connection or global subscription. Accepts local `onError` and `inspector`.                                                                         |
| `start(): void`                        | Synchronous, idempotent attach. Without bootstrap, installs with defaults; this cannot recover missed traffic. Context/version/configuration failures are explicit and leave the client stopped. |
| `stop(): void`                         | Idempotent detach; local connected/complete become false before notification. Local values remain last-known; explicit subscriptions survive for restart.                                        |
| `connected: boolean`                   | Client started and current socket OPEN. Does not imply complete state.                                                                                                                           |
| `generation: number`                   | Generation observed in this document, 0 before adoption; readable metadata, not a global account identifier.                                                                                     |
| `state.complete: boolean`              | Complete snapshot collected by the runtime in this generation, with the client attached.                                                                                                         |
| `state`                                | Read-only view preserving getters and onChange; do not expose `applyPacket`/`markStale` through this view.                                                                                       |
| `actions`                              | Consumer-bound facade forwarding to the single coordinator. No publicly shared mutable Actions object.                                                                                           |
| `sendCommand`/`sendRaw`                | Always `Promise<boolean>`; true = accepted for sending, false = definitely not sent because connection/attachment is absent. Validation errors remain synchronous; uncertain failure rejects.    |

A uniform asynchronous send return removes the transport generic and avoids a
future API rewrite when a bridge exists. Do not introduce a command queue.
A rejected Promise does not authorize repeating a send.

`BootstrapOptions` contains only shared policy: `maxPacketBytes` and `actions`
(existing limits, checks, dryRun and timing options, without a public scheduler).
Normalize defaults before comparing. The first bootstrap fixes policy; another
bootstrap with different policy throws a configuration error without changing
peers. `start()` adopts existing policy without trying to reapply defaults.
Copy and freeze nested options on entry; later mutation of the consumer's object
must not change policy, comparison or another client's behavior.
Do not allow `actions`/`maxPacketBytes` per facade in this increment: budgets,
cooldown and floors cannot depend on which client wins a race.
Per-call `dryRun`/`onSend` remain as today; durable limits stay with the host.
Clock, PageLike and fake transport remain internal test seams.

## Structure and ownership

```text
game -> existing WebSocket -> MAIN hook -> parse/validate -> canonical state
                                               |                 |
                                               +-> reconciliation+
                                               |      (single)
                                               +-> facades A/B -> local listeners
facades A/B -> guards + single coordinator -> current socket's original send
```

The runtime uses a stable global slot, with an explicit numeric ABI and required
capabilities. Reuse the baseline's `Symbol.for` pattern, not cross-bundle
`instanceof`. Validate before modifying constructor/prototype/global.
Compatible ABI and capabilities reuse hook/parser/state/coordinator; package
version differences alone do not imply incompatibility. Incompatibility produces
a typed/controlled error without replacing the slot or stacking proxies.
Detect the legacy page-hook v1 slot too: fail explicitly if it cannot be safely
adopted, rather than installing a second hook beside it.

Do not unpatch when the last consumer stops: the runtime continues collecting
state for late attachment. Retain only current/last-known state, bounded counters
and pending reconciliation, not raw packet history.
Document destruction discards the entire runtime; do not persist accounts.

Facades do not receive the mutable canonical `GameState`. Existing getters can
be reused through a delegated view; stop retains a local frozen snapshot.
State and events are deeply immutable before reaching consumer code; the same
frozen payload can be shared without cloning for each listener.
Actions updates reconciliation before external observers.
State application and invalidation must finish before the first notification,
including during reentrant callbacks. Each delivery checks the current attach/run:
a listener stopping another client prevents later callbacks for that client's old run.
Local errors follow that client's onError; a failing handler does not interrupt peers.
Do not make one client's onError the global owner of runtime failures.
Before any attachment, synchronous bootstrap failures are thrown to the caller;
asynchronous core failures use the existing default handler with code-controlled
errors, without including arbitrary page frames/errors. Do not retain samples
without an attached local Inspector or broadcast private failures to other consumers.

## Lifecycle and generations

A generation identifies socket adoption, not client count. Attach/run identifies
a facade execution. Capture callbacks and waiters check both where applicable.
Before any boundary callback, change generation/socket, invalidate complete and
finish affected reconciliation. Only then notify state/connection observers.

| Event                                             | Runtime/generation                                                               | Facade and actions                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Client constructor                                | No global change                                                                 | Stopped, disconnected, incomplete.                                                                                |
| Bootstrap without socket                          | Hook installed, incomplete state                                                 | Zero clients are allowed; opens no connection.                                                                    |
| New eligible socket, still CONNECTING             | Generation advances immediately; complete false; previous socket loses authority | Observers never see previous data as current; old pending operations do not migrate.                              |
| Current socket OPEN                               | Same generation; connected true; does not restore complete                       | Actions return no-state until valid complete state.                                                               |
| Valid complete `welcome`                          | Applies state/catalogs before notification; complete true                        | Actions can use this generation. Partial/malformed welcome does not fabricate complete.                           |
| Attach after bootstrap collected welcome + deltas | Does not restart generation or parsing                                           | Immediately current view; no synthetic welcome event or historical event replay.                                  |
| Attach without collected welcome                  | Socket may be OPEN; complete false                                               | Only actual partial values; recovery through next welcome/reload by host/game, without automatic login/query.     |
| Socket predating the hook                         | Adopts on first observed send if no live successor exists                        | No magic socket enumeration or recovery of missed welcome.                                                        |
| Replaced socket message/open/close/send           | Ignored for state/events/adoption                                                | Does not resurrect a generation or disconnect the successor.                                                      |
| Current socket CLOSE                              | complete false, connected false before notification                              | Possibly sent pending operations end unconfirmed, except for already conclusive evidence under the existing rule. |
| A stops, B remains                                | Runtime and generation unchanged                                                 | A stale/disconnected; B stays current; only A's own action is locally cancelled.                                  |
| Last consumer stops                               | Hook, parser and collection continue                                             | Does not close socket; releases facade-internal subscriptions, not limit/risk history.                            |
| A restarts                                        | Adopts current runtime state if complete in the current generation               | Does not reuse old callbacks; no command repetition.                                                              |
| New navigation/document                           | New runtime and session identity                                                 | No state/pending operation from the previous page is current.                                                     |

Preserve the page-host and `/` path filter, with valid WebSocket schemes;
do not start accepting every socket in the document. The constructor must
preserve arguments, protocols, constants, subclassing, returned object identity
and native exceptions. Send adoption remains a backstop, not a login mechanism.

## Concurrent commands and evidence

One coordinator controls inFlight, floors and cooldown for the whole runtime,
with a single limiter and ledger under bootstrap policy. Facades only identify
the invocation owner and forward local observers. An action from B while A is
pending returns busy; it is neither queued nor retried automatically.

Stopping the owner after an accepted/uncertain send does not undo the command:
resolve the invocation without evidence as unconfirmed, preserve floors and
start shared cooldown. If conclusive evidence already exists, preserve the
result it supports. Stop before dispatch prevents sending. This decision does
not emit a disconnection to peers.
Separate consumer invocation settlement from reservation release: the dispatched
command's reservation and internal waiter remain owned by the runtime until
evidence, the original timeout or a generation boundary. B keeps receiving busy
during that interval, even if configured cooldown is zero. Stop neither restarts
the timeout nor leaves the consumer dependent on its own removed listener.
When the internal waiter finishes, apply the cooldown due to its result without
erasing risk already recorded by stop; only then release the reservation.
Local page send settles acceptance/error synchronously; the public Promise does
not introduce an ACK wait. Thus onSend also precedes settlement caused by stop,
and no Promise waits for an ACK this mechanism does not have.
No attach/stop resets ledger/limiter; only a generation change clears floors,
preserving cooldown and the in-memory budget.

Low-level sending cannot bypass a pending action: consumer `sendCommand`/`sendRaw`
refuse with an explicit busy error; do not return false with the wrong meaning.
The action's internal send uses its own reservation without deadlocking.
Each immediate send uses its captured generation/reservation without retaining
the command until OPEN.

Low-level and manual game commands still lack a correlatable receipt.
As the minimum conservative rule, an accepted/uncertain low-level send marks
external evidence in the generation; raw is opaque and always marks it.
An observed game send during an action also marks interference for that
reconciliation. In that case, do not confirm from an isolated inventory
delta/removal or promote an ambiguous event to certain: a matching event can
be at most probable. The conservative low-level mark lasts until generation
change; do not invent a speculative catalog of effects.
Normal game sends are not blocked, modified or repeated by the SDK.
Even without observed interference, certain still means a match under the
existing rule, never transactional proof. The SDK cannot exclude unobservable
external writes.

Arm listeners before sending; reserve floors/limits before onSend. Preserve
accepted/not-sent/uncertain and exactly one onSend before the terminal result,
even with a synchronous response or a throwing observer. Never convert uncertain
failure into not-sent. No new generation can provide evidence for an action
from the previous generation.

## Rejected alternative and migration

| Option                                                                             | Consequence                                                                                                                                | Decision                                      |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Single MAIN runtime with facades and shared policy                                 | Less per-client flexibility, but coherent late readiness and serialization; a future bridge uses the same owner.                           | Recommended for this increment.               |
| Only a factory without public transport, retaining per-client parser/state/Actions | Smaller initial migration, but duplicates CPU, misses welcome before attach and permits two independent actions against the same evidence. | Rejected: does not deliver committed sharing. |

Do not add a cross-extension broker, daemon, mandatory worker or another repo.
The future bridge will use attach/detach, snapshots/events and requests/results
with document/generation identity and internal correlation; callbacks and
arbitrary errors do not cross IPC. IPC correlation does not create a request id
in the game protocol. Its isolation/authorization is later work; do not promise
security between extensions executing together in MAIN.

Future launcher integration will consume already normalized facts/getters and
action results from the page client. A serializable projection combines
generation, connection, complete and only facts needed by the host; do not mirror
frames to another PokeIdleClient in main or reapply the protocol outside the page.
The host associates document identity with its mirror to distinguish numeric
generations from different navigations. The future adapter forwards only allowed
actions and preserves onSend separately from the terminal result.
Failed early installation does not enable CDP fallback; the host's duplicate
send hook must be removed. This is an integration constraint, not an
IPC/Electron implementation in this plan.

Remove public Transport/PageTransport/PageLike/SendResult exports and examples,
the PokeIdleClient generic and CDP/custom-transport instructions.
Move global options from constructor to bootstrap; update boolean send consumers
to await. Change client.state to a read-only view without mutators.
Document that restart can now reuse continuously collected complete runtime
state, unlike the baseline. Update README, package README, architecture,
CHANGELOG, API snapshot, tests, extension and distribution verifiers in the
same increment. Do not retain a silent legacy fallback.
Launcher migration follows standalone proof, using an exact SHA and the same
page policy, without a second public transport.
Legacy JavaScript configuration containing `transport` must fail explicitly
before runtime installation/adoption; removing only its TypeScript type is insufficient.

## Acceptance matrix and execution

| Case                   | Minimum required proof                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap/construction | Constructor installs no hook; MAIN bootstrap before game captures welcome without a client; two equal calls do not repatch.                                |
| Filter/constructor     | Host/path/scheme, protocols, instanceof/subclass, constants and native throws; unrelated sockets untouched.                                                |
| Adoption/late attach   | Old socket adopted on send; attach with/without welcome; two clients read the same state without duplicate parse/apply.                                    |
| Generation             | CONNECTING successor invalidates before callbacks; old events ignored; later welcome does not confirm an old order.                                        |
| stop/restart           | A does not stop B; stopped snapshot stale; restart uses current generation; zero consumers keeps collection; no command replay.                            |
| Bundles                | Two independent compiled copies in the same MAIN share; incompatibility/legacy slot/configuration conflict fail without repatch.                           |
| Isolation              | Nested packet/battle/state mutation cannot affect peers; throwing listener/onError/onSend; reentrant stop prevents old callbacks.                          |
| Concurrency            | Two actions compete for the same inFlight; floors/cooldown outlive owner; low-level busy; interfering manual/raw writes do not become strong confirmation. |
| Send/reconciliation    | Immediate response, false, accepted, uncertain throw, rejection, timeout, stop and disconnect; onSend/terminal ordering and budgets preserved.             |
| Hostile data/volume    | Invalid JSON, invalid type, large frame and valid large welcome; drops observable by controlled reason, without diagnostic payload.                        |
| Real standalone        | Local extension/IIFE and synthetic game: early bootstrap, welcome before attach, two compatible copies and successor; no launcher/CDP/real account.        |

Unit fakes do not prove extension worlds. Require synthetic browser evidence for
MAIN distribution; if not demonstrated, record it as unproven, never infer it
from a Node/vm test. Do not start a browser in this role; the coordinator reserves
a serial window for implementer/reviewer.

Use existing commands: `npm run test:sdk`, `npm run test:repo`,
`npm run typecheck`, `npm run lint`, `npm run distribution -- --require-clean`
and `npm run test:distribution`; select smaller tests during red/green.
Intentional API update: in `packages/sdk`, `UPDATE_API_SNAPSHOT=1 npm test`.
Do not regenerate catalogs/protocol over the network to solve the connection.
Automatic diagnostics are counts-only with controlled enums, series/byte limits
and no packets, credentials, DOM text or arbitrary errors.
Short callbacks do not remove parsing from the renderer; performance needs a
baseline, equivalent conditions and repetitions, without invented universal thresholds.

## Minimum decisions for contract freeze

1. Actual sharing in the same MAIN/global; isolated worlds explicitly outside this increment.
2. Explicit early bootstrap, inert constructor and start as attach with a local default fallback.
3. Single bootstrap policy, not independent Actions/options per facade.
4. Generation advances on adoption, including CONNECTING; restart can adopt a continuously collected snapshot.
5. Immutable view/events and single action coordination, including risk preserved after stop.
6. Promise sends, explicit busy and conservative evidence under interference.

Exact new error names and internal view structure are implementation choices;
they need no new public abstraction. No functional question blocks the plan:
the coordinator arbitrates concrete disagreements on these six points within
two rounds. Next executable step: the implementer writes red cases for late
bootstrap, CONNECTING successor, two copies and a concurrent action; implements
the minimum runtime; then updates API/docs/distribution.

This work read all three briefings and the cited files; executed
`git rev-parse HEAD`, `git status --short` and source/manifest/test inspection.
It also read the independent matrix through `git show` at
`9dd6e21e9ad4b8ad02e4c8e2d76704dc10c9623c:docs/conexao/revisao.md`; criteria
A1-A12 are compatible with this proposal, without claiming execution of tests
reported by that other session.
Skill `blueprint` was used for boundaries, ownership and lifecycle;
`verification-before-completion` was used to check scope and documentary
checkpoint evidence. This session ran no runtime tests or browser:
the deliverable is exclusively the proposal.
