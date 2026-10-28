# Architecture and API contract

Read BRIEFING.md and ferramentas.md. Your deliverable is a concrete,
implementable proposal, not a catalog of patterns.

Inspect the SDK baseline and existing standalone example. Resolve public
construction/attach/start/stop/readiness semantics without a transport option;
separate the game's connection ownership from the SDK's attachment.

Define the smallest sharing scope for this increment and how future isolated
world consumers attach without a public API rewrite. Make bootstrap timing,
compatible bundle rendezvous, version mismatch, generations, snapshot/event
ownership, late attachment and shared action ownership explicit.

Do not push a global account manager, generic bus or worker architecture.
Explain any cross-context bridge as a bounded integration boundary, not a
second WebSocket strategy.

Write docs/conexao/proposta-arquitetura.md in your worktree. Include the
recommended API sketch (clearly proposed), rejected alternative, lifecycle
table, migration implications, acceptance cases and unresolved decisions.
Commit locally. Discuss directly with the implementer and reviewer once IDs
are supplied; stop after two rounds and return residuals to the coordinator.
Do not edit runtime or start browser processes.
