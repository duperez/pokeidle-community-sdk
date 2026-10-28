# SDK session connector: shared brief

## Mission

Evolve the SDK into a standalone, standardized API for extensions to access
the game's existing WebSocket. The SDK owns the access mechanism; consumers
must not select or construct a transport, receive a socket, or depend on the
launcher. This is authorized implementation work after a short design phase,
not an open-ended architecture study.

Starting SDK revision: `cd3261d996db9b1f8ea7cacf81ac53fe026667f9`.
Keep the two existing repositories. The SDK repository is public; use only
invented fixtures and public technical information in code, tests and docs.

## Confirmed decisions

- One internal connection policy: a minimal, robust page hook around the
  existing game WebSocket, installed early in MAIN/document_start.
- The game owns login, its server connection and reconnects. The SDK owns
  discovering/adopting that socket, following replacement, interpreting
  traffic, maintaining state and sending supported commands through it.
  Never open a parallel game session, relogin or fabricate missing state.
- No public choice of CDP, custom transports or legacy implementations.
  Internal seams for deterministic tests do not become consumer options.
- The SDK remains useful in an independent browser extension without the
  launcher, Electron, CDP, private profiles or another repository.
- A shared runtime is a committed evolution. This step must support its
  implementation, not merely hide a new independent parser per consumer
  behind a factory and call the sharing objective satisfied.
- Bound implementation scope explicitly: decide whether the first increment
  shares only a document/realm or also bridges isolated worlds. State which
  behavior is implemented, demonstrated, or deferred. Do not equate these.
- Launcher retains profiles, cookies, windows, account slots, budgets and
  automation policy. No global account coordinator in the SDK now.
- Inventory/depot/etc. are domain APIs/subscriptions, not separate sockets.
  Do not build a generic topic bus or implement unsupported domains.
  Subscription is not an implicit server query or command.
- Breaking API simplification is permitted for this local iteration:
  document migrations and update examples/types/artifacts together. Do not
  keep alternate transports alive as a silent compatibility path.

## Required behavioral boundaries

1. A page runtime can serve a consumer without any launcher bootstrap.
2. Connection and usable/current data are distinct. Generation changes
   invalidate readiness before consumers are notified.
3. Socket replacement, connecting successors, reconnects and late attach
   must not reuse stale completeness or replay historical commands.
4. Stop/unsubscribe affects that consumer, not the game's socket or peers.
5. Consumers cannot mutate shared state or each other's event payloads;
   one throwing listener or failed consumer cannot corrupt its peers.
6. Compatible bundles must not stack hooks; incompatible runtime versions
   must fail explicitly rather than overwrite a live runtime.
7. Concurrent consumers must not create ambiguous duplicate writers or
   upgrade weak inventory/event evidence into transactional confirmation.
8. Preserve not-sent, accepted-for-send and uncertain outcomes; acceptance
   is not server confirmation. Preserve onSend/terminal ordering.
9. Keep capture callbacks short, but do not claim that splitting functions
   or adding async automatically removes CPU work from the renderer.
10. No raw packets, credentials, DOM text, identifiers from real accounts or
    arbitrary page errors in diagnostic artifacts. Prefer counts, bytes,
    durations and controlled enums; telemetry must have bounded overhead.

## Scope and anti-overengineering

Prefer existing modules, tests, build and package outputs. No third repository,
daemon, local server product, plugin framework, React migration, mandatory
worker, generic transport registry or new production dependency without a
demonstrated need. A local synthetic server for tests is not a product service.

Do not redesign game UI, hunt/sniper extensions or launcher UX. Do not treat
previous real-game pauses as an SDK bug already proven.

## Committee

- Coordinator: owns scope/arbitration and cross-repository sequencing.
- Architecture/contracts: design a concrete public lifecycle/API and the
  smallest coherent runtime; writes proposal, not runtime implementation.
- SDK implementation: existing SDK maintainer session, sole runtime editor;
  owns the implementation plan, tests, migrations and official artifacts.
- Independent review: challenges contracts and tests before coding, then
  reviews the exact implemented SHA and runs independent verification.
- Launcher integration: sequenced after SDK standalone proof, in its own
  repository. Do not change the live account/profile/process.

## Phases and evidence

A. Read baseline, apply relevant skills, propose at most two alternatives.
B. At most two concrete discussion rounds; coordinator settles residuals.
Record API/lifecycle, sharing boundary, command ownership and tests.
C. Implement with behavior-first tests; record a meaningful red/green case.
D. Verify standalone distribution and runtime behavior, then independent
review and targeted corrections.
E. Integrate the launcher by exact SDK SHA and validate its bridge separately.
No alternate socket strategy or silent fallback.

Required cases: standalone MAIN bootstrap; constructor behavior; host/socket
filtering; existing socket adoption; bootstrap before consumer attach;
late attach with/without an already collected complete state; replacement
and stale events; stop/restart; two consumers with isolation; compatible and
incompatible bundles; pending commands and concurrent actions; immediate
responses, rejection, uncertainty and disconnect; malformed/large messages.
Add real-browser synthetic evidence where unit fakes cannot prove behavior.
No live account or external game interaction is required.

Use the repository's existing unit/build/type/API/distribution checks.
Performance observations need a baseline, equivalent conditions and repeated
measurements, not a single timing assertion on a shared host. Do not invent
universal thresholds or equate lab observations with production field data.

## Working protocol

Each decision report: issue, evidence, at most two alternatives, recommendation,
impact and the next executable step. Reports must say what was actually run.
Use exact SHAs and named artifacts, not "looks good."

Only the implementation owner edits runtime. Each session uses its own
worktree; use Git objects to read peer commits. Never reset someone else's
work or touch a main checkout. Commit locally with the required trailer.
No push, PR, release or publication.

Do not pause for routine approval after the coordinator freezes an in-scope
plan. A real blocker requires evidence, a bounded attempted alternative and
an explicit decision request. Avoid repetitive experiments without a new
hypothesis. Send phase completions, actionable blockers and new evidence,
not acknowledgments. No browser/Electron helper starts without a reserved
serial window from the coordinator; stop only your own helpers.

## Skills

Read `ferramentas.md`. Invoke installed skills if available in the session's
catalog; otherwise read their installed SKILL.md and necessary references.
Report actual use. Skills are guidance under repository rules and scope,
not permission to delete existing code, expand the committee, add tooling,
send data externally or perform real-account actions.
