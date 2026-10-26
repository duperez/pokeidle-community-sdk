# Security policy

## Supported versions

Only the latest release (and `main`) receives fixes. The project is pre-1.0.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting:
**Security → Report a vulnerability** on this repository
(<https://github.com/duperez/pokeidle-community-sdk/security/advisories/new>).

What counts as a security issue here:

- a way for the library to leak data it should redact (tokens, session data, personal data in inspector output),
- a way around the command guards (`orbs.sacar` is refused, irreversible commands need confirmation),
- a way for server-controlled data to corrupt the library's state or objects (prototype pollution and similar),
- a vulnerable dependency that affects users of the library.

You can expect an answer within about a week. Please give a reasonable time to fix before disclosing. This is a volunteer
project with no bounty.

Problems with the **game itself** are not ours to fix: report those to the game's team.
