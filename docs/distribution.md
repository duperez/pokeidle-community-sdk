# Distribution and consumer diagnostics

The SDK remains **private and experimental**. No workflow publishes to npm, creates a GitHub Release, signs artifacts or
requires registry credentials. CI builds on pull requests, pushes to `main` and manual dispatch, and retains verified
`sdk-<checkout-revision>` workflow artifacts for 30 days. Download them from the successful Actions run, not from an
unrelated branch or an untrusted comment.

## Reproduce an artifact

Use Node 22 (`nvm use`) and npm 10.8.2 (`npm install --global npm@10.8.2`), then:

```sh
npm ci
npm run distribution -- --require-clean
npm run test:distribution
```

`artifacts/sdk/` contains:

| File                                   | Purpose                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `pokeidle-community-sdk-<version>.tgz` | Installable npm package containing ESM, CJS, IIFE and declarations            |
| `manifest.json`                        | Schema 1 identity, compatibility, toolchain and SHA-256 of every package file |
| `SHA256SUMS`                           | SHA-256 of the archive and manifest                                           |

`distribution` builds the SDK **twice from an empty `dist/`**, packs it twice and compares the complete file inventories
and archive bytes before writing the artifact. Dependency versions come from `package-lock.json`; the manifest records
its SHA-256, platform/architecture and the exact Node, npm, TypeScript and esbuild versions actually used. There are no build timestamps, machine
paths, environment variables, account data or credentials in the manifest. Reproduction means the same commit, lockfile,
toolchain and platform yield identical archive bytes; native dependencies/toolchains on other platforms are not claimed
to produce identical archives. CI independently checks runtime/type consumption on Linux, macOS and Windows, and Node
20/22/24. This does not certify compatibility with every future game revision or every Electron version.

Use `--require-clean` for transferable artifacts. Without it, local work is allowed but is marked `dirty: true` and emits
a warning; its Git revision alone does **not** identify those uncommitted changes. Never distribute it as a clean commit
build. Re-run distribution after any source, documentation or metadata change.

The validator checks archive SHA-256, npm SHA-512 integrity, `SHA256SUMS`, and the size/SHA-256 of **all files installed
offline from the tarball**, rejecting extra or missing package files. External-consumer tests also install a real tarball
outside the checkout and exercise ESM, CJS, portable CJS types, async transports and the classic browser IIFE. No tests
connect to the game.

## Schema 1 and launcher integration

The top-level manifest fields are `schemaVersion`, `name`, `version`, `revision` (full Git hash), `dirty`, `toolchain`,
`lockfileSha256`, `compatibility`, `artifact` and `files`. `artifact` has `file`, `sha256` and npm `integrity`;
`files` is a sorted array of `{ path, size, sha256 }` entries relative to the installed package root (not the tarball's
`package/` prefix). Hashes are lowercase hexadecimal; sizes are bytes.

Prefer installing the tarball as a dependency:

```sh
npm install /path/to/pokeidle-community-sdk-0.0.1.tgz
```

For vendoring, take **all parts from the same verified artifact**:

| Consumer            | Package paths                                                                     |
| ------------------- | --------------------------------------------------------------------------------- |
| ESM/bundler         | `dist/index.js` and its relative modules; package exports select ESM declarations |
| CommonJS host       | Self-contained `dist/index.cjs`                                                   |
| CommonJS TypeScript | Entire `dist/cjs/` tree, including `package.json`; import types from `index.js`   |
| Page-world script   | `dist/pokeidle-sdk.iife.js`, exposing `globalThis.PokeIdleSDK`                    |

Keep the SDK license and upstream metadata alongside vendored files. The launcher's existing `vendor/pokeidle-sdk.json`
can retain its `versao`, `commit`, CJS `sha256`, `navegador.sha256` and `declaracoes[].sha256`; map them to `version`,
`revision` and matching `files[].sha256` here. Do not mix declarations, CJS and IIFE from different revisions, even if
their package versions match: unreleased revisions can all identify as `0.0.1`.

The consumer's installation-diagnostics UI should display the SDK package version, full source revision and build
dirty/verification status together with its own version/revision and runtime versions. Bundle these metadata at build
time; do not infer them from the current working directory, fetch account data, dump packets or add a runtime SDK API.
Report a missing or unverified identity as unknown/unverified, never as the latest known successful revision. The SDK
manifest is not a UI and does not include player state or runtime logs.

Checksums detect corruption and revision mixups; **they are not signatures or proof of authenticity**. Authenticate the
repository and successful Actions run out of band. Official publication, signing, durable release retention and registry
access need a separate explicit decision; none is silently enabled here.
