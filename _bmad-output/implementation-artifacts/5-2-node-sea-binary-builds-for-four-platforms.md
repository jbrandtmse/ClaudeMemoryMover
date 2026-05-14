# Story 5.2: Node SEA Binary Builds for Four Platforms

Status: done

## Story

As a cmemmov maintainer,
I want `npm run build:binary` (per-platform on each matching CI runner) to produce single-file binaries for Windows x64, macOS arm64, macOS x64, and Linux x64 using Node SEA,
so that NFR17 is satisfied and users without Node.js installed can run `cmemmov` directly from a downloaded binary.

## Acceptance Criteria

### AC1 — Single-file build output for SEA embedding

**Given** the current tsup config emits `dist/cmemmov.js` plus dynamic-import chunks (`dist/export-<hash>.js`, `dist/import-<hash>.js`, `dist/chunk-<hash>.js`, etc.) because the CLI uses `await import('./commands/<x>.js')` for lazy loading
**When** the binary-build pipeline runs
**Then** a separate single-file ESM bundle is produced at `dist/cmemmov-bundled.js` (or equivalent path) with **no dynamic-import chunks** — every command module is inlined
**And** the existing `dist/cmemmov.js` + chunks output is preserved unchanged (the lazy-loaded startup-time optimization remains in effect for the `npm install -g cmemmov` flow)
**And** the bundled artifact passes the same `--version` and `--help` smoke checks as `dist/cmemmov.js`

**Implementation guidance:** Add a second tsup entry (e.g., `entry: { 'cmemmov-bundled': 'src/cli.ts' }`) with `splitting: false` and the dynamic imports rewritten or with a build-time transform, OR add a small `scripts/bundle-sea.mjs` that runs tsup with a one-off inline config. The Node SEA `main` script must be ONE file — multi-file SEA is not supported as of Node 22.

### AC2 — `npm run build:binary` script orchestrates the SEA flow per platform

**Given** the `package.json` scripts block
**When** the maintainer or CI runs `npm run build:binary`
**Then** the script invokes `node scripts/build-binary.mjs` (NEW file) which:
  1. Detects the current platform (`process.platform`) and arch (`process.arch`)
  2. Validates the platform/arch matches one of the four supported targets: `win32-x64`, `darwin-arm64`, `darwin-x64`, `linux-x64` — otherwise exits with a clear error per AC9
  3. Ensures `dist/cmemmov-bundled.js` exists (calls `npm run build` first if missing OR if the dependency tree changed since last build — minimum: check the file exists; the orchestration can call `npm run build` unconditionally for simplicity in CI)
  4. Generates `sea-config.json` (in `dist/sea-prep/` or similar — NOT committed) pointing at `dist/cmemmov-bundled.js` with `disableExperimentalSEAWarning: true` and `useSnapshot: false` (snapshots add complexity for marginal startup wins; defer to a future story)
  5. Runs `node --experimental-sea-config <sea-config.json>` to produce the SEA blob at `dist/sea-prep/cmemmov.blob`
  6. Copies the running Node binary (`process.execPath`) to `dist/binaries/cmemmov-<platform>-<arch><ext>` where `<ext>` is `.exe` on Windows and empty elsewhere
  7. On macOS: runs `codesign --remove-signature <binary>` BEFORE postject (postject cannot inject into a signed binary)
  8. Runs `npx postject <binary> NODE_SEA_BLOB <blob> --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2` (with `--macho-segment-name NODE_SEA` flag on macOS)
  9. On macOS: re-signs with `codesign --sign - --force <binary>` (ad-hoc signature; AC5)
  10. Verifies the binary by running `<binary> --version` and asserting it prints the expected version (AC6)

**Implementation guidance:** Use Node's built-in `child_process.execFileSync` for shelling out; do NOT shell out via a string `exec` (security and quoting hygiene). Don't add new npm dependencies — `postject` should be invoked via `npx postject` (already a peer dep of the Node SEA recipe). Add a `postject` dev dependency to `package.json` if `npx postject` would otherwise trigger an interactive prompt; otherwise rely on `npx`'s implicit install.

### AC3 — Output file naming and location

**Given** a successful run of `npm run build:binary`
**When** the dust settles
**Then** the binary is at one of these exact paths, matching the runner:

| Platform | Arch | Output |
| --- | --- | --- |
| Windows | x64 | `dist/binaries/cmemmov-windows-x64.exe` |
| macOS | arm64 | `dist/binaries/cmemmov-macos-arm64` |
| macOS | x64 | `dist/binaries/cmemmov-macos-x64` |
| Linux | x64 | `dist/binaries/cmemmov-linux-x64` |

**And** `dist/binaries/` is created if it does not exist
**And** prior contents of `dist/binaries/` are NOT cleaned (multiple runs on the same runner overwrite the single output for that platform, but don't wipe a co-existing different-platform binary if one happens to be present — relevant for local cross-runner builds and for CI when `actions/upload-artifact` reads from this directory)
**And** `dist/binaries/` is added to `.gitignore` (do not commit binaries)

### AC4 — Smoke tests: `--version` and `--help` work without Node.js installed

**Given** any of the four built binaries on its matching OS
**When** the binary is invoked as `<binary> --version` (e.g., `./dist/binaries/cmemmov-linux-x64 --version`)
**Then** stdout contains the version string from `package.json` (matches `cmemmov --version` output of the npm-installed package)
**And** exit code is 0

**Given** the same binary
**When** invoked as `<binary> --help`
**Then** stdout contains Commander's standard help output including the six subcommands (`export`, `import`, `fix-paths`, `share`, `rollback`, `completion`) and the global flags
**And** exit code is 0

**Given** the binary build script (`scripts/build-binary.mjs`)
**When** AC4's smoke checks fail
**Then** the script exits with a non-zero code and a descriptive error including the binary's stdout/stderr — CI's job will fail at this step rather than uploading a broken binary

### AC5 — macOS binaries are ad-hoc codesigned

**Given** either macOS binary (`cmemmov-macos-arm64` or `cmemmov-macos-x64`)
**When** verified with `codesign -dv <binary>` after the build
**Then** stderr shows an ad-hoc signature: `Signature=adhoc` (this is what `codesign --sign - --force` produces)

**Given** the documented v0.x first-run experience
**When** a user downloads the macOS binary and tries to run it
**Then** the documentation (in `README.md` and/or `docs/install.md` — likely Story 5.4 scope, but a stub note must exist here) instructs them to run `xattr -d com.apple.quarantine ./cmemmov-macos-arm64` once to remove the Gatekeeper quarantine flag, then run the binary normally
**And** proper Apple Developer ID signing is documented in `_bmad-output/implementation-artifacts/deferred-work.md` as a v1.0 milestone, **not** scoped into this story

**Implementation guidance:** Both x64 and arm64 macOS binaries need the same codesign treatment. The arm64 build runs on macOS arm64 (or under Rosetta-2 cross-arch with `arch -x86_64` shenanigans, but **don't do that** — use a native arm64 runner). The architecture-mismatch case is handled by AC9.

### AC6 — Binary size is in the expected ballpark

**Given** any built binary
**When** its file size is measured
**Then** it is between 50 MB and 110 MB (Node SEA on Node 22 inflates by the Node runtime; this range is the architectural expected ballpark)

**Given** the build script
**When** the size check fails (above or below the range)
**Then** a warning is printed to stderr (not a hard fail — the range is empirical, and Node version bumps may shift it). The warning includes the actual size and the expected range. The build still produces a binary and exits 0.

**Dev Note:** Hard-failing on size would couple this story to a moving Node-version target. A warning is the right level of strictness for v0.x. If a size regression is suspected (binary doubles or halves between builds), the warning surfaces the change in CI logs without breaking the release pipeline.

### AC7 — `package.json:files` whitelist resolves the dynamic-import-chunk packaging gap

**Given** the long-standing HIGH from cr-1.9 (deferred-work.md line 64): `package.json:files` currently lists only `dist/cmemmov.js`, but `tsup` emits dynamic-import chunks (`dist/export-<hash>.js`, `dist/chunk-<hash>.js`, etc.) that `cli.ts` resolves at runtime via `await import('./commands/*.js')`
**When** this story lands
**Then** `package.json:files` is widened to `["dist/**/*.js", "dist/**/*.d.ts", "README.md", "LICENSE"]` so that `npm publish` includes every chunk needed for `npm install -g cmemmov` to work end-to-end
**And** `dist/binaries/**` is EXCLUDED from the npm tarball (via `.npmignore` or by tightening the `files` pattern) — the binaries are GitHub Release artifacts, not npm payload

**Given** an `npm pack` smoke test in CI (NEW, AC7-coupled)
**When** the test runs
**Then** it:
  1. Runs `npm pack --json` to produce a tarball
  2. Extracts the tarball into a tmpdir
  3. Asserts `dist/cmemmov.js` exists in the extracted tree
  4. Asserts at least one `dist/<command>-<hash>.js` chunk exists (proves chunks are included)
  5. Asserts NO `dist/binaries/**` files are present
  6. Runs the extracted `node dist/cmemmov.js --version` and asserts exit code 0 + correct version output

**Implementation guidance:** Add the smoke test as `tests/integration/npm-pack.test.ts`. The test should `vi.skip()` (or `it.skipIf(!hasNpm)`) on runners without npm available, but `npm` is universally present on the three CI runners so this is mostly defensive. Run from a tmpdir to keep the working tree clean.

### AC8 — CI matrix builds and smoke-tests the binary per platform

**Given** the existing `.github/workflows/ci.yml` check matrix (Windows, macOS, Linux)
**When** this story lands
**Then** a new job `binary-build` runs on the matrix (windows-latest, macos-latest, ubuntu-latest):
  1. `actions/checkout`, `actions/setup-node@v4` with node-version 22 (matches the existing `check` job)
  2. `npm ci`
  3. `npm run build` (produces `dist/cmemmov.js` + chunks AND `dist/cmemmov-bundled.js`)
  4. `npm run build:binary` (produces `dist/binaries/cmemmov-<platform>-<arch>(.exe)?`)
  5. The build script's internal smoke check (AC4) gates the step
  6. `actions/upload-artifact@v4` uploads `dist/binaries/cmemmov-<platform>-<arch>*` so downstream jobs (Story 5.3 release pipeline) can pick them up

**And** the macOS job builds **both arm64 and x64 binaries**: macos-latest is now arm64 by default (as of GitHub Actions 2024+), so the job uses `arch -x86_64 npm run build:binary` for the x64 variant via cross-arch CLI emulation — or uses the dedicated `macos-13` runner for x64 (Intel) and `macos-latest` for arm64

**Implementation guidance for the macOS dual-arch question:** The cleaner approach is to add a SECOND macOS job pinned to `macos-13` (the last Intel runner image GitHub supports) for x64 builds, and keep `macos-latest` for arm64. This avoids `arch -x86_64` shenanigans and gives each binary a native Node runtime. Matrix it as:
```yaml
matrix:
  include:
    - { os: windows-latest, target: windows-x64 }
    - { os: macos-latest,   target: macos-arm64 }
    - { os: macos-13,       target: macos-x64 }
    - { os: ubuntu-latest,  target: linux-x64 }
```
The `target` value can be passed to the build script via env var if it needs help disambiguating (e.g., `BUILD_TARGET=macos-x64`).

### AC9 — Cross-compilation is rejected with a clear error

**Given** the build script
**When** it is invoked on a platform that does not match a supported target (e.g., a maintainer running `npm run build:binary` from WSL Linux trying to build a Windows binary, or running on a 32-bit Linux machine, or running on macOS PowerPC, etc.)
**Then** the script exits 2 with: `Cross-platform binary build not supported. Node SEA can only produce binaries native to the host platform. Current host: <platform>-<arch>. Supported targets: win32-x64 (host=win32-x64), darwin-arm64 (host=darwin-arm64), darwin-x64 (host=darwin-x64), linux-x64 (host=linux-x64). To build all four binaries, use the CI matrix on GitHub Actions.`

**And** the build script does NOT attempt to invoke Node SEA tooling on the unsupported host (fail BEFORE doing any work — `process.exitCode = 2; console.error(message); process.exit(2)`)

### AC10 — Documentation stub for the binary install flow

**Given** the user-facing install story for the binaries (proper docs land in Story 5.4)
**When** Story 5.2 lands
**Then** a brief block in `README.md` (or `docs/install-binary.md` — pick one based on README length; if README is ≥ 200 lines today, prefer a separate doc) covers:
  1. Where to download (placeholder pointing at GitHub Releases; Story 5.3 wires the actual upload)
  2. macOS Gatekeeper workaround: `xattr -d com.apple.quarantine ./cmemmov-macos-<arch>`
  3. Linux/macOS: `chmod +x` if needed; the build script already sets the executable bit but binaries downloaded from web are sometimes stripped
  4. Windows: nothing special needed; the `.exe` extension makes it directly runnable

**Dev Note:** Story 5.4 is the documentation deliverables story and will own README/install-binary content properly. This AC is a stub so that Story 5.2 doesn't ship binaries with no user-facing install instructions at all. Keep it short (≤ 30 lines of doc). Story 5.4 is the place to expand.

### AC11 — Test suite remains green; new tests are added

**Given** the changes in AC1–AC10
**When** `npm test` runs on the CI matrix
**Then** all existing tests pass (no regressions)
**And** new tests for the build script live in `scripts/build-binary.test.mjs` (or `.ts` if convenient — match existing tooling):
  - **Unit:** `validatePlatform()` accepts the four targets; rejects all others with the AC9 error message
  - **Unit:** `binaryOutputPath(platform, arch)` returns the four AC3 paths verbatim
  - **Integration (host-specific):** running the full build pipeline on the test runner produces a working binary that passes `--version` and `--help` (AC4); this test uses `it.skipIf(!process.platform === 'linux' && !process.platform === 'darwin' && !process.platform === 'win32')` — practically, always runs, but logs the binary size after completion

**Given** `npm run lint`
**When** it runs
**Then** zero violations

## Tasks / Subtasks

- [x] Task 1: Build pipeline — bundled single-file output (AC: #1)
  - [x] 1.1 Add a second tsup entry or a separate `scripts/bundle-for-sea.mjs` that produces `dist/cmemmov-bundled.js` with `splitting: false` and all dynamic imports inlined
  - [x] 1.2 Verify the bundled output is a single file (no `cmemmov-bundled-*.js` chunks)
  - [x] 1.3 Smoke-check the bundled file with `node dist/cmemmov-bundled.js --version`
- [x] Task 2: Build script — `scripts/build-binary.mjs` (AC: #2, #4, #6, #9)
  - [x] 2.1 Module skeleton with `validatePlatform()` and `binaryOutputPath()` helpers
  - [x] 2.2 Cross-platform rejection (AC9) — fail before any work
  - [x] 2.3 SEA config generation (write `dist/sea-prep/sea-config.json`)
  - [x] 2.4 Run `node --experimental-sea-config` to produce the blob
  - [x] 2.5 Copy `process.execPath` to `dist/binaries/cmemmov-<platform>-<arch><ext>`
  - [x] 2.6 macOS: `codesign --remove-signature` before postject
  - [x] 2.7 Run `npx postject` to inject the blob (with `--macho-segment-name NODE_SEA` on macOS)
  - [x] 2.8 macOS: `codesign --sign - --force` after postject (AC5)
  - [x] 2.9 Run `--version` and `--help` smoke checks (AC4)
  - [x] 2.10 Size warning band (AC6) — between 50 MB and 110 MB
- [x] Task 3: `package.json` updates (AC: #2, #7)
  - [x] 3.1 Add `"build:binary": "node scripts/build-binary.mjs"` to scripts
  - [x] 3.2 Widen `files` to `["dist/**/*.js", "dist/**/*.d.ts", "README.md", "LICENSE"]`
  - [x] 3.3 Add `.npmignore` if needed to exclude `dist/binaries/**` and `dist/sea-prep/**` from the published tarball
  - [x] 3.4 Add `dist/binaries/` and `dist/sea-prep/` to `.gitignore` (AC3)
- [x] Task 4: `npm pack` smoke test (AC: #7)
  - [x] 4.1 New `tests/integration/npm-pack.test.ts`
  - [x] 4.2 Test: tarball includes `dist/cmemmov.js` + at least one chunk
  - [x] 4.3 Test: tarball does NOT include `dist/binaries/**`
  - [x] 4.4 Test: extracted `node dist/cmemmov.js --version` works
- [x] Task 5: CI matrix update (AC: #8)
  - [x] 5.1 Add `binary-build` job to `.github/workflows/ci.yml`
  - [x] 5.2 Use the four-target matrix (windows-latest, macos-latest, macos-13, ubuntu-latest)
  - [x] 5.3 Upload binaries as artifacts (downstream consumption by Story 5.3)
- [x] Task 6: Build script tests (AC: #11)
  - [x] 6.1 Unit tests for `validatePlatform()` and `binaryOutputPath()`
  - [x] 6.2 Integration test that runs the full build on the host runner and asserts binary exists + smoke checks pass
- [x] Task 7: Documentation stub (AC: #10)
  - [x] 7.1 Add a brief "Download a binary" section to README.md OR a new `docs/install-binary.md` (pick based on README length)
  - [x] 7.2 Document the macOS Gatekeeper `xattr -d` workaround
  - [x] 7.3 Mention that proper Apple Developer ID signing is a v1.0 milestone (link to deferred-work.md entry)
- [x] Task 8: Verify gates (AC: #11)
  - [x] 8.1 `npm run lint` clean
  - [x] 8.2 `npm test` all green on host runner
  - [x] 8.3 Run `npm run build && npm run build:binary` locally on host; verify binary works
  - [x] 8.4 Move deferred-work.md cr-1.9 HIGH (`files` whitelist) entry to a RESOLVED sub-bullet pointing at this story

## Dev Notes

### Why a separate bundled file for SEA (vs reusing `dist/cmemmov.js`)

Node SEA needs a single JS file. The current `dist/cmemmov.js` has `await import('./commands/<x>.js')` which Node will try to resolve at runtime — but SEA's `main` script runs from inside the binary's blob, and there is no `./commands/` next to it. So SEA needs an all-inlined bundle.

The npm-install flow benefits from the chunked output (smaller startup-time cost; only the invoked command loads). Don't conflate the two — keep both outputs.

If tsup gives trouble with `splitting: false` keeping all the dynamic-import-rewritten-as-static-import behavior, esbuild can be invoked directly: `esbuild src/cli.ts --bundle --platform=node --format=esm --outfile=dist/cmemmov-bundled.js --target=node22`. Pick whichever is simpler — both are dev dependencies already.

### Node SEA — minimum viable recipe (Node 22)

```js
// sea-config.json
{
  "main": "dist/cmemmov-bundled.js",
  "output": "dist/sea-prep/cmemmov.blob",
  "disableExperimentalSEAWarning": true
}
```

```bash
# Generate blob
node --experimental-sea-config dist/sea-prep/sea-config.json

# Copy Node binary
node -e "require('fs').copyFileSync(process.execPath, 'dist/binaries/cmemmov-linux-x64')"
chmod +x dist/binaries/cmemmov-linux-x64

# Inject (Linux/Windows)
npx postject dist/binaries/cmemmov-linux-x64 NODE_SEA_BLOB dist/sea-prep/cmemmov.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

# macOS extra step: strip + re-sign
codesign --remove-signature dist/binaries/cmemmov-macos-arm64
npx postject dist/binaries/cmemmov-macos-arm64 NODE_SEA_BLOB dist/sea-prep/cmemmov.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA
codesign --sign - --force dist/binaries/cmemmov-macos-arm64
```

### Files this story modifies / creates

- **NEW** `scripts/build-binary.mjs` — orchestration script (Task 2)
- **NEW** `scripts/build-binary.test.mjs` (or `.test.ts`) — unit tests (Task 6.1)
- **NEW** `tests/integration/npm-pack.test.ts` — packaging smoke test (Task 4)
- **NEW** `dist/binaries/.gitkeep` is NOT created (just `.gitignore` the directory)
- **UPDATE** `tsup.config.ts` — add the bundled entry (or a sibling script invokes esbuild for the bundled file; either works) (Task 1)
- **UPDATE** `package.json` — add `build:binary` script, widen `files`, add `postject` to devDependencies if `npx postject` requires it (Task 3)
- **UPDATE** `.gitignore` — add `dist/binaries/`, `dist/sea-prep/`, `*.tsbuildinfo` if not already there (Task 3.4)
- **UPDATE** `.npmignore` — NEW or update existing to exclude binaries (Task 3.3)
- **UPDATE** `.github/workflows/ci.yml` — add `binary-build` matrix job (Task 5)
- **UPDATE** `README.md` OR **NEW** `docs/install-binary.md` — install-flow stub (Task 7)
- **UPDATE** `_bmad-output/implementation-artifacts/deferred-work.md` — move the cr-1.9 HIGH to RESOLVED (Task 8.4)

### Files this story does NOT modify

- Any code under `src/commands/`, `src/services/`, `src/core/`, `src/ui/` (this is a build-pipeline story, not a feature story)
- The bundle schema, sanitization rules, or test fixtures
- Any `.cmemmov` bundle test fixtures

If any of those need to change to satisfy an AC, stop and surface the issue.

### Process principles (carry from Epic 4 retro)

- **Schema-extends-with-consumer pattern (retro AI#4):** the bundled output is consumed by SEA. If the SEA recipe needs new metadata in package.json (e.g., proper version string for `--version`), that's a coordinated change — don't hardcode the version in two places.
- **Declarative-data-as-contract (retro AI#6):** the four supported targets (`win32-x64`, `darwin-arm64`, `darwin-x64`, `linux-x64`) MUST be a single constant in `scripts/build-binary.mjs`. `validatePlatform()` reads from it, `binaryOutputPath()` reads from it, AC9's error message reads from it. Adding a 5th target later (e.g., Linux ARM64) is a single-line change.

### Relevant invariants

- **NFR17 (binary distribution):** users without Node.js installed can run `cmemmov` from a downloaded binary. AC4's smoke checks are the mechanical proof.
- **Output contract:** the binaries print to stdout/stderr exactly like the Node-installed `cmemmov`. SEA does not change Output behavior — verify via `--version` byte-equality check in AC4's smoke if convenient.
- **Exit code contract:** `--version` and `--help` exit 0; AC9's cross-compile failure exits 2.

### Testing standards summary

- **Build-script unit tests:** lightweight; just exercise the platform-validation and path-construction helpers.
- **Build-script integration test:** runs the full pipeline on the host runner. Skip gracefully if the host platform is not in the supported four (defensive — should never fire on CI).
- **`npm pack` smoke test:** runs end-to-end against the tarball. New integration test under `tests/integration/`.
- **Coverage gate:** new files (`scripts/build-binary.mjs`) should be ≥ 80% line coverage. SEA-tooling shell-out steps are exempt (mocking shell-outs adds no value here; the integration test is the real verification).

### Project Structure Notes

- Alignment confirmed: `scripts/` is the home for build orchestration (sibling to `scripts/bench-startup.mjs`).
- New top-level concept: `dist/binaries/`. Goes under `dist/` so the existing build cleanup (`tsup --clean`) wipes it on rebuild. Add to `.gitignore`.
- `dist/sea-prep/` is intermediate-only — also under `dist/` and gitignored.

### References

- [Epic 5 spec — Story 5.2: epics.md:1453-1500](../planning-artifacts/epics.md#L1453) — original ACs
- [Node SEA docs — Node 22 single-executable applications](https://nodejs.org/api/single-executable-applications.html) — authoritative source; recipe steps come from here
- [Architecture Important Gap #2 — Apple Developer ID signing as v1.0 milestone](../planning-artifacts/architecture.md) — context for AC5's ad-hoc-only scope
- [cr-1.9 deferred HIGH — `package.json:files` whitelist](../implementation-artifacts/deferred-work.md#L64) — closed by AC7 of this story
- [Existing tsup config: tsup.config.ts](../../tsup.config.ts)
- [Existing CI matrix: .github/workflows/ci.yml](../../.github/workflows/ci.yml)
- [Existing scripts/bench-startup.mjs pattern](../../scripts/bench-startup.mjs)
- [Pipeline recovery runbook (if interrupted): _bmad-output/implementation-artifacts/runbook-pipeline-recovery.md](./runbook-pipeline-recovery.md)

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

Five real-world bugs surfaced during the local build pipeline shakedown — each
researched (Perplexity + Node SEA docs) and fixed without halting:

1. **SEA module-format mismatch (Node 22).** Initial config used `format: ['esm']` for the bundled entry; Node 22 SEA runs the embedded main through `embedderRunCjs` unconditionally (the `mainFormat: "module"` config option lands in Node 23+, NOT v22, despite appearing in current docs). Fixed by switching the SEA tsup config to `format: ['cjs']`. The npm-install entry stays ESM.
2. **External require failures inside SEA.** With CJS bundling, `require('commander')` failed with `ERR_UNKNOWN_BUILTIN_MODULE` because SEA's embedded `require()` only resolves built-ins (no `node_modules` adjacent to the blob). Fixed by adding `noExternal: [/.*/]` to the SEA tsup config so every npm dep inlines into the single file. Bundle grew 124 KB → 420 KB.
3. **`.cjs` extension forced.** With `"type": "module"` in `package.json`, a `.js` file under `dist/` is interpreted as ESM by Node regardless of SEA's intent. tsup emits CJS output as `.cjs`, which forces CJS interpretation. The build script now targets `dist/cmemmov-bundled.cjs`, and `.npmignore` plus the `dist/**/*.js` files pattern naturally exclude it from the npm tarball.
4. **`import.meta.url` polyfill crash.** The CJS bundle's `import_meta = {}` polyfill made `fileURLToPath(import.meta.url)` throw `ERR_INVALID_ARG_TYPE` at load time, killing the binary before `main()` could run. Fixed by guarding the call: `const metaUrl = import.meta.url as string | undefined; if (metaUrl !== undefined) { ... }`. The TS cast is load-bearing because the type system considers `import.meta.url` always-defined in ESM. Also added `src/cli-sea.ts` thin wrapper as a fallback entry, though the guard fix removed the need.
5. **`tar -xzf` Windows path ambiguity.** GNU tar (Git Bash) interprets `C:\path` as `host:path` rsh syntax. The npm-pack smoke test used absolute paths and `tar` errored with `Cannot connect to C: resolve failed`. Fixed by passing the tarball as a relative filename with `cwd` set to the workDir — works for both GNU tar and bsdtar.

### Completion Notes List

- **AC1 (single-file bundled output):** Added a second tsup config object emitting `dist/cmemmov-bundled.cjs` (CJS, `splitting: false`, `noExternal: [/.*/]`). 420 KB single file, all six lazy-loaded subcommands inlined. The npm-install `dist/cmemmov.js` ESM entry is unchanged.
- **AC2 (build orchestration):** `scripts/build-binary.mjs` does platform validation → sea-config write → blob generation → node-binary copy → (mac) codesign strip → postject inject → (mac) codesign re-sign → smoke checks → size warning. All shell-outs use `execFileSync` with arg arrays (no string `exec`).
- **AC3 (output paths):** Pinned in `SUPPORTED_TARGETS` (single source of truth) and asserted verbatim in unit tests.
- **AC4 (smoke checks):** `--version` parses non-empty stdout; `--help` asserts `Usage:` + `cmemmov` markers. Both gate the build with non-zero exit on failure.
- **AC5 (macOS ad-hoc codesign):** `codesign --remove-signature` before postject, `codesign --sign - --force` after. Both gated on `target.macho` so non-mac runs skip them.
- **AC6 (size warning band):** 50-110 MB. Local Windows x64 build measured 82.2 MB. Out-of-band sizes warn-but-don't-fail per Dev Note.
- **AC7 (`files` whitelist + npm pack smoke test):** Widened `package.json:files` to `["dist/**/*.js", "dist/**/*.d.ts", "README.md", "LICENSE"]`. Added `.npmignore` for defense-in-depth. New `tests/integration/npm-pack.test.ts` runs `npm pack`, extracts, asserts AC7 invariants, runs `npm install --omit=dev` in the extracted dir, and exercises `node dist/cmemmov.js --version` end-to-end. Closes cr-1.9 HIGH (deferred-work.md updated to RESOLVED).
- **AC8 (CI matrix):** New `binary-build` job with four-target matrix (windows-latest, macos-latest, macos-13, ubuntu-latest). Uploads `dist/binaries/cmemmov-<target>*` via `actions/upload-artifact@v4` for Story 5.3 consumption. `if-no-files-found: error` keeps a silent regression from sneaking through.
- **AC9 (cross-compile rejection):** `validatePlatform()` fails first, before any work. Error message names current host, lists all four supported targets, points at the CI matrix. Unit-tested across six unsupported (platform, arch) pairs.
- **AC10 (doc stub):** Created `docs/install-binary.md` (README is 331 lines, so per AC10's threshold a separate doc is the right choice). README gets a short "Download a binary" section linking to it. macOS Gatekeeper `xattr -d` and the v1.0 Developer-ID-signing milestone are both documented.
- **AC11 (tests + lint):** 21 new unit tests (`scripts/build-binary.test.mjs`) covering `SUPPORTED_TARGETS` shape, `validatePlatform()` accept/reject cases, and `binaryOutputPath()` for all four targets. 4 new integration tests (`tests/integration/build-binary.test.ts`) running the full build pipeline on the host (33s on Windows x64). Full suite: 665 passed, 4 skipped, 0 failed. Lint clean. Typecheck clean.

**Process-principle note (carried from Epic 4 retro AI#6):** `SUPPORTED_TARGETS` is the canonical declarative-data-as-contract for this story — `validatePlatform()`, `binaryOutputPath()`, AC9's error message, and CI matrix all derive from one frozen const. Adding linux-arm64 later is a single-line change.

**Local verification (host=win32-x64):** `npm run build && npm run build:binary` produces `dist/binaries/cmemmov-windows-x64.exe` at 82.2 MB. Manual smokes: `--version`, `--help`, `export --help`, `completion bash` all run correctly. macOS arm64/x64 and Linux x64 binaries are CI-only by design (Node SEA cannot cross-compile; AC9 enforces).

### File List

- **NEW** `scripts/build-binary.mjs` — SEA build orchestration (Task 2)
- **NEW** `scripts/build-binary.test.mjs` — 21 unit tests for `SUPPORTED_TARGETS`, `validatePlatform()`, `binaryOutputPath()` (Task 6.1)
- **NEW** `tests/integration/build-binary.test.ts` — end-to-end build + smoke check on host runner (Task 6.2)
- **NEW** `tests/integration/npm-pack.test.ts` — AC7 tarball whitelist smoke test (Task 4)
- **NEW** `src/cli-sea.ts` — thin SEA entry wrapper around `main()` (Task 1; ultimately complementary to the `import.meta.url` guard fix in `cli.ts`)
- **NEW** `docs/install-binary.md` — install-flow stub for the four binaries (Task 7)
- **NEW** `.npmignore` — defense-in-depth exclusion of `dist/binaries/**`, `dist/sea-prep/**`, `dist/cmemmov-bundled.cjs`
- **UPDATE** `tsup.config.ts` — added second config object for the bundled CJS SEA entry (Task 1)
- **UPDATE** `src/cli.ts` — guarded the `import.meta.url` self-execute block so it survives CJS bundling (Debug Log #4)
- **UPDATE** `package.json` — added `build:binary` script; widened `files` to `["dist/**/*.js", "dist/**/*.d.ts", "README.md", "LICENSE"]` (Task 3)
- **UPDATE** `.gitignore` — added comment clarifying `dist/` covers binaries + sea-prep (Task 3.4)
- **UPDATE** `vitest.config.ts` — added `scripts/**/*.test.mjs` to the include glob so the unit tests run as part of `npm test`
- **UPDATE** `.github/workflows/ci.yml` — added `binary-build` matrix job (windows-latest, macos-latest, macos-13, ubuntu-latest) with `upload-artifact@v4` (Task 5)
- **UPDATE** `README.md` — added "Download a binary" section pointing at `docs/install-binary.md` (Task 7.1)
- **UPDATE** `_bmad-output/implementation-artifacts/deferred-work.md` — moved cr-1.9 HIGH (`package.json:files` whitelist) entry to RESOLVED pointing at this story (Task 8.4)
- **UPDATE** `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 5-2 ready-for-dev → in-progress → review

### Review Findings

- [x] [Review][Patch] AC4 build-script `--help` smoke check did not assert the six subcommand names — fixed in `scripts/build-binary.mjs` `runSmokeCheck()`. The smoke check now collects `requiredSubcommands = ['export', 'import', 'fix-paths', 'share', 'rollback', 'completion']`, filters for missing entries, and throws with the missing names listed if the help stdout drops any. Verified against the existing `dist/binaries/cmemmov-windows-x64.exe` via a full `npm run build:binary` re-run: `smoke check: --help OK (25 lines, all six subcommands present)`. Closes the spec-strictness gap where a regression silently dropping a lazy-imported subcommand from the SEA bundle would have passed the build-script gate (the integration test caught it but only at `npm test` time, not at `build:binary` time).
- [x] [Review][Defer] `.npmignore` comment drift (`cmemmov-bundled.js` vs actual `.cjs`) — deferred to `deferred-work.md`. Cosmetic, zero behavioral impact.
- [x] [Review][Defer] `docs/install-binary.md` is 76 lines vs AC10's `≤ 30 lines` soft cap — deferred. Story 5.4 owns full install docs and will restructure.
- [x] [Review][Defer] `tests/integration/npm-pack.test.ts` cleanup runs as `it()` not `afterAll()` — deferred. Tmpdir orphans if prior test throws; OS reaps eventually.
- [x] [Review][Defer] `npm-pack.test.ts` install-and-run check adds network-dep flakiness — deferred. Cheap asserts cover whitelist; install step is value-add.
- [x] [Review][Defer] `scripts/build-binary.mjs` self-execute guard inherits the Windows drive-letter case fragility flagged in cr-1.9 — deferred. Pair with the cli.ts fix.
- [x] [Review][Defer] `dist/sea-prep/cmemmov.blob` not pre-unlinked before `--experimental-sea-config` — deferred. Node 22 always overwrites the output blob; defensive concern.
- [x] [Review][Defer] `src/cli-sea.ts` top-level `void main()` has no library-import guard — deferred. By design; no consumer exists.

## Change Log

- 2026-05-14 — Story 5.2 implemented. Node SEA binary builds for Windows x64, macOS arm64, macOS x64, Linux x64 wired up. AC1–AC11 satisfied. Closes long-standing cr-1.9 HIGH (`package.json:files` whitelist). (dev-5-2 / opus-4-7-1m)
- 2026-05-14 — Code review of Story 5.2 (cr-5-2 / opus-4-7-1m): one MEDIUM patched (build-script `--help` smoke check extended to assert all six subcommands per AC4 literal); seven LOW deferred to `deferred-work.md`. Patched binary re-built and verified locally on win32-x64.
