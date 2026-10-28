# Engineering skills: provenance and use

Installed personally for GitHub Copilot, outside both repositories. No
production dependency, repository customization or MCP server is added.
Sources are public and pinned; original instructions are not rewritten.
Installation uses the skills CLI, local pinned sources, copy mode, and
DISABLE_TELEMETRY=1 / DO_NOT_TRACK=1.

| Skill                          | Source revision                                                        | License                       | Purpose                                                         |
| ------------------------------ | ---------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------- |
| systematic-debugging           | obra/superpowers@2ce8aa15d05bd57213e6f746f953aafb7ded7a8b              | MIT                           | Evidence and one bounded hypothesis before a fix                |
| test-driven-development        | same revision                                                          | MIT                           | Behavior-first tests; inspect writing-good-tests.md             |
| verification-before-completion | same revision                                                          | MIT                           | Fresh evidence and requirement checks before completion         |
| webapp-testing                 | anthropics/skills@dbd4588f9e1033efb41dad4bef2f7947c8993d44             | Apache-2.0, skill LICENSE.txt | Browser proof for a local standalone example when needed        |
| performance                    | addyosmani/web-quality-skills@afa8da942115f2961fdbfa80807ea0b232ff6c00 | MIT                           | Baselines, traces, comparable conditions and honest uncertainty |

Installed paths: ~/.agents/skills/<skill>/SKILL.md.

Selection deliberately excludes React/cloud skills, full orchestration packs
and broad audit bundles. We need native browser APIs and existing TypeScript
tests, not a framework migration.

Read and apply only relevant skills/references. Unit tests use the repository's
existing runner; webapp-testing is not a requirement to add Python/Playwright
to every test or to install browsers before a runnable proof needs them.
Performance budgets for content sites are not automatic SDK budgets.
Chrome DevTools MCP is optional, not installed or assumed available.
Never send a private URL or authenticated data to external measurement tools.

Record which skill was actually invoked/read and what it changed in the
work. "Installed" does not mean "used" or "verification passed."
