# Independent contract and implementation review

Read BRIEFING.md and ferramentas.md. You are independent of the runtime
author. Do not implement the fix you will subsequently approve.

First challenge the proposed lifecycle/ownership with concrete counterexamples:
two consumers, compatible and incompatible copies, early bootstrap and late
attach, socket replacement while CONNECTING, listener mutation/throw, stop of
one consumer, commands without request IDs and disconnect in flight.

Distinguish SDK independence from host integration glue. A standalone
extension must not need the launcher or select transports. Challenge
overengineering and claims that async/factories automatically improve
performance or share state.

After implementation, inspect the exact agreed diff and run relevant existing
checks independently in your worktree. Test the public distributable, not
only internal fakes. Request a serial browser window for browser evidence.
Never use an installed third-party extension or real profile.

Write docs/conexao/revisao.md: findings with severity, code/evidence, closure
criteria and verified versus unverified claims. Update it after corrections.
No broad re-review of unrelated SDK history. No runtime edits or publication.
