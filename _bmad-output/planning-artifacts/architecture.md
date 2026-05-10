---
stepsCompleted:
  - step-01-init
  - step-02-context
  - step-03-starter
  - step-04-decisions
  - step-05-patterns
  - step-06-structure
  - step-07-validation
  - step-08-complete
status: complete
lastStep: 8
completedAt: '2026-05-08'
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/research/technical-claude-code-migration-research-2026-05-08.md
  - _bmad-output/planning-artifacts/product-brief-ClaudeMemoryMover.md
  - _bmad-output/planning-artifacts/product-brief-ClaudeMemoryMover-distillate.md
  - claude-memory-move-research.md
  - initial-prompt.md
workflowType: architecture
project_name: ClaudeMemoryMover
user_name: Developer
date: '2026-05-08'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:** 36 FRs across 7 capability areas:

1. **Export (FR1–FR7)** — Multi-select by category and project, sessions/credentials opt-in, single JSON bundle.
2. **Import & Path Remapping (FR8–FR16)** — Cross-OS detection, per-project guided remapping with auto-suggest, skip option, per-category merge/overwrite, dry-run; remaps paths inside `settings.json` permissions and `.claude.json` fields.
3. **Backup & Rollback (FR17–FR19)** — Auto-timestamped pre-write backup, reported up front, single-command restore.
4. **Path Repair (FR20–FR23)** — Standalone `fix-paths` command: scan, decode, auto-suggest, confirm/override/skip.
5. **Team Sharing (FR24–FR26)** — Sanitized bundle stripping personal data, preserving CLAUDE.md / MCP / commands / permission patterns.
6. **Bundle Format (FR27–FR30)** — Records `originalPath` per project, embeds Claude Code version fingerprint, human-readable JSON, warns (doesn't block) on version mismatch.
7. **CLI Interface (FR31–FR36)** — 100% interactive/silent parity, machine-parseable `--json`, structured errors with affected-file + operation + suggested-fix, standardized exit codes, shell completions, progress to stderr.

**Non-Functional Requirements:** 19 NFRs across 4 areas:

- **Performance:** Startup <500ms; typical export/import <10s; with sessions <60s; `--dry-run` no slower than live.
- **Security:** Hard-coded credential exclusion (enforced in code, not docs); zero runtime network calls; no data in bundle beyond explicit selection; prominent warning on `--include-credentials`.
- **Reliability:** Atomic file writes (temp-then-rename); fatal errors leave pre-import state intact; `--dry-run` byte-for-byte lossless; complete (not partial) restorable backups; no silent failures.
- **Compatibility:** Node.js v18 LTS+; explicitly tested on Win11, macOS 14, Ubuntu 22.04; pre-built binaries for win-x64, macos-arm64, macos-x64, linux-x64; honors `CLAUDE_CONFIG_DIR`.

**Scale & Complexity:**

- Complexity: **Medium** — small surface, non-trivial correctness burden (cross-OS path semantics, atomic writes, lossy slug encoding, selective merge).
- Primary domain: **CLI / systems tooling** (Node.js, file I/O, terminal UX).
- Estimated architectural components: **~12–15 modules** — 6 command handlers, bundle format/IO, slug codec, remapping engine, backup/rollback service, sanitization rules, CLI parser, output formatter, prompts wrapper, Claude Code config locator.

### Technical Constraints & Dependencies

**Hard Constraints (from PRD):**

- Node.js v18 LTS minimum (matches Claude Code's requirement).
- No `postinstall` lifecycle scripts.
- Production dependencies pinned to exact versions in `package-lock.json`.
- Minimal dependency footprint — prefer Node built-ins (`fs/promises`, `path`, `os`, `zlib`, `readline`).
- Path operations exclusively via Node `path`/`os` APIs.
- Honor `CLAUDE_CONFIG_DIR` env var.

**Open Dependency Choices** (resolved in later steps):

- Interactive prompts: `@clack/prompts` vs `inquirer`.
- Argument parsing: `commander` vs `yargs` vs `minimist`.
- Color: `chalk` vs `picocolors` vs none.
- Binary distribution: Node SEA (v20+ built-in) vs `pkg` vs `nexe`.

**Verified Ground Truth (from research):**

- Slug algorithm: `path.replace(/[:\\/]/g, '-')` — **lossy** on `-` in folder names.
- `~/.claude/` resolved via `os.homedir()`, NOT `%APPDATA%` on Windows.
- `~/.claude.json` is **separate** from `.claude/` — lives at home root.
- Session JSONL records embed `cwd` — authoritative for original path.
- `settings.json` permissions contain absolute paths (e.g. `Read(C:\agents\**)`) requiring remap.

**Pre-resolved Open Questions:**

- `share` command output: single generic bundle (no named profiles in v1).
- MEMORY.md merge strategy: layered merge with conflict-policy choice (`keep` default, `replace`, `rename`, `individual`); index rebuilt from final on-disk state to stay consistent with files.

### Cross-Cutting Concerns Identified

1. **Auto-backup invariant** — Every filesystem mutation must produce a complete pre-write backup. Enforced architecturally, not per-command.
2. **Dry-run propagation** — `--dry-run` must reach every write site without ad-hoc `if` checks; needs a write-gate abstraction that no-ops under dry-run.
3. **Path remapping engine** — Shared service used by `import`, `fix-paths`, and `share`. Single source of truth for slug codec, cross-OS conversion, and auto-suggest. Drift here breaks the central differentiator.
4. **Output mode duality** — Every command emits human text by default and a JSON object on `--json`. Errors always go to stderr (structured: affected file + operation + suggested fix). Needs an output formatter abstraction.
5. **Atomic write discipline** — All writes use write-temp + rename. Centralized in the write-gate.
6. **Sanitization profiles** — Two profiles: "redact credentials only" (default export) and "strip personal + paths" (share). Declarative, not hard-coded per command.
7. **Format version handshake** — Single check point at bundle parse time; warns on mismatch.
8. **Cross-platform test strategy** — CI must run all three OSes; unit tests need filesystem mocks for Windows path semantics on non-Windows runners.
9. **Risk-aware command design** — Every destructive command has the same dry-run + auto-backup + rollback triad. Users learn it once.
10. **Slug ambiguity** — Decoder is lossy; architecture prefers authoritative sources (session `cwd`, bundle `originalPath`) over slug reversal; falls back to slug + user confirmation only when nothing better exists.

### PRD Follow-Up Items

- **NFR15 updated** (2026-05-08): Node.js minimum bumped from v18 LTS to v22 LTS. Rationale: v18 reached EOL April 2025; v22 has been in active LTS since October 2024 and provides materially better Node SEA support (which we've selected as the binary distribution mechanism). PRD edited in place.

## Starter Template Evaluation

### Primary Technology Domain

**CLI Tool (Node.js, TypeScript).** A short-running, file-system-bound utility with a small command surface (6 top-level commands), strict performance and correctness NFRs, and pre-built binary distribution.

### Starter Options Considered

| Option | Verdict | Reason |
| --- | --- | --- |
| **No starter — bespoke structure** | Selected | Best fit for "minimal dependency footprint" NFR, <500ms startup NFR, and Node SEA single-file bundling. Code organization is defined by this architecture process, which is more valuable than inheriting one from a generic template. |
| **oclif** (Heroku/Salesforce) | Rejected | Plugin system, lifecycle hooks, and command discovery framework are heavy for a 6-command tool. Conflicts with minimal-deps NFR. Boot overhead risks the <500ms startup NFR. |
| **gluegun** | Rejected | Mid-weight CLI framework. Bundles prompts/file helpers we'd choose differently. Adds non-essential surface area. |
| **Citty** (UnJS) | Rejected | Modern lightweight choice, but adds an abstraction layer with no offsetting benefit at our scale. Direct use of `commander` is cleaner. |

### Selected Approach: Bespoke Minimal Stack

**Rationale:** The PRD's hard NFRs (minimal deps, <500ms startup, audit-friendly dependency tree, Node SEA bundling) all point in the same direction — own the structure ourselves, pull in only the libraries we need. The architecture process here is more valuable than a template's prebaked decisions.

### Initialization Steps

```bash
mkdir cmemmov && cd cmemmov
npm init -y

# Production dependencies (pinned to exact versions)
npm install --save-exact commander@latest @clack/prompts@latest picocolors@latest

# Dev dependencies
npm install --save-dev --save-exact \
  typescript@latest \
  @types/node@latest \
  vitest@latest \
  tsup@latest \
  @vitest/coverage-v8@latest \
  eslint@latest \
  @typescript-eslint/parser@latest \
  @typescript-eslint/eslint-plugin@latest

# TypeScript config
npx tsc --init
```

Run `npm install --save-exact` (or set `save-exact=true` in `.npmrc`) to satisfy the PRD's pinned-exact-versions NFR.

### Architectural Decisions Provided by the Stack

**Language & Runtime:**

- TypeScript (strict mode), compiled to ESM for distribution
- Node.js v22 LTS minimum
- ESM (`"type": "module"` in package.json)

**Argument Parsing — `commander`:**

- Mature, zero runtime dependencies, ~180kb installed
- Subcommand support fits `cmemmov export | import | fix-paths | share | rollback | completion`
- Custom error formatting hooks (needed for our structured-error NFR)

**Interactive Prompts — `@clack/prompts`:**

- Modern, accessible terminal UX
- Designed for guided wizard flows like our import path-remapping UI
- Graceful Ctrl+C handling (relevant for atomic-write discipline)

**Color — `picocolors`:**

- ~3kb, zero dependencies
- API-compatible enough with `chalk` for an easy swap if needed

**Build Tooling — `tsup`:**

- Wraps esbuild — sub-second TypeScript builds
- Outputs a single bundled `.js` file (required for Node SEA)
- Emits `.d.ts` declarations
- Sensible defaults, minimal config

**Testing — `vitest`:**

- Native TypeScript and ESM support
- Jest-compatible API
- Fast watch mode and built-in V8 coverage
- Filesystem mocking via `vi.mock` patterns (essential for cross-OS path testing)

**Linting — ESLint + `typescript-eslint`:**

- Standard TypeScript linting
- Custom rules to enforce architectural invariants (e.g., banning `process.env.HOME` in favor of `os.homedir()`, banning hardcoded path separators)

**Code Organization:**

- Defined in step 6 (Component Structure) — not inherited from a template

**Development Experience:**

- `npm run dev` — `tsup --watch` with source maps
- `npm test` — `vitest run` (CI); `npm run test:watch` (local)
- `npm run build` — produces `dist/cmemmov.js` for npm publish + Node SEA input
- `npm run build:binary` — Node SEA binary build (configured in later step)

### Final Dependency Footprint

| Dependency | Purpose | Approx Size |
| --- | --- | --- |
| `commander` | Argument parsing | ~180kb |
| `@clack/prompts` | Interactive UX | ~100kb |
| `picocolors` | Color | ~3kb |
| **Total runtime deps** | 3 packages | ~285kb |

Everything else — file I/O, atomic writes, JSON, gzip, path resolution, slug encoding, sanitization, prompts wrapper, output formatter — uses Node built-ins.

**Note:** Project initialization with this dependency set should be the first implementation story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (block implementation):**

- Bundle schema validation strategy (drives bundle parser design)
- Atomic write mechanism (drives WriteGate abstraction in step 6)
- Error model shape (drives every command's error handling)
- Path engine ownership (single shared service vs duplicated logic — already settled in cross-cutting concerns)

**Important Decisions (shape architecture):**

- Bundle integrity verification approach
- Backup retention policy
- Dry-run propagation mechanism
- CI matrix and release flow
- Lint strictness and custom rules

**Deferred (post-MVP):**

- Cryptographic signing of bundles (no current threat model that justifies key management)
- Encrypted bundles (per product brief — credentials already excluded by default)
- Telemetry / observability (forbidden by NFR7)
- Pre-commit hooks (add only if we hit a problem they'd solve)

### Bundle Architecture

**Schema validation — Zod:**

- Bundles are untrusted input from another machine; runtime validation is non-negotiable
- Single schema definition produces both runtime validators and TypeScript types — eliminates drift
- ~150kb dep but earns its keep at the parsing boundary
- All `JSON.parse` of bundle data flows through the Zod schema; ESLint rule will ban raw `JSON.parse` outside the bundle parser module

**Bundle integrity — SHA256 checksum embedded in bundle metadata:**

- Detects accidental corruption (incomplete file copies, rsync glitches, stray trailing bytes)
- Computed over the canonicalized payload (everything except the `integrity` field itself)
- Uses Node's built-in `crypto` — no extra dependency
- `--no-integrity-check` flag on import for pathological cases (manually edited bundle, partial recovery)
- Not a security feature; not a signature; documented as such

**Bundle compression — auto-gzip when sessions included or bundle >5MB:**

- Plain `.cmemmov` files stay human-readable in a text editor (the inspectability differentiator)
- Wrapped to `.cmemmov.gz` only when size justifies it — sessions are the only category that pushes past 5MB
- Uses Node's built-in `zlib.gzipSync`/`gunzipSync` — no extra dependency
- Auto-detected on import by file magic bytes (not extension), so renaming doesn't break import

### Error & Output Architecture

**Error model — `CmemmovError` class + discriminated-union codes:**

- Single thrown type carrying `{ code, file, operation, hint, cause, exitCode }`
- Code is a string literal type (e.g., `'BUNDLE_INVALID_SCHEMA'`, `'BACKUP_FAILED'`, `'PATH_REMAP_AMBIGUOUS'`)
- Maps cleanly to human output (red text + hint) and `--json` output (structured payload)
- `cause` chains underlying errors (e.g., the original `ENOENT` under a `BACKUP_FAILED`)
- All non-`CmemmovError` thrown errors are wrapped at the command boundary into `CmemmovError({ code: 'INTERNAL', cause: e })`

**Output formatter — bespoke, no logger library:**

- A small `Output` module owns all stdout/stderr writes
- Two modes: `human` (default) and `json` (when `--json` flag set)
- Progress goes to stderr in both modes; final result goes to stdout (JSON object) or stderr (human summary)
- No log files written at runtime (NFR7 — zero network/observability surface)

**Exit code taxonomy:**

- `0` — success (all selected items processed)
- `1` — partial success (some items skipped, see summary)
- `2` — fatal (nothing written; bundle invalid, backup failed pre-write, etc.)
- `CmemmovError` carries `exitCode`; the top-level CLI shell reads it and exits cleanly

### Filesystem Discipline

**Atomic writes — `fs.rename` after write-to-temp:**

- Every write goes: write content to `<target>.cmemmov-tmp-<pid>-<random>`, then `fs.rename` to the target path
- `rename` is atomic on the same filesystem on all three target OSes
- Cross-volume scenarios (rare): fall back to `copyFile` + `unlink` with an explicit warning that this isn't atomic; the pre-write backup remains the safety net

**Backup retention — keep last 10, prune oldest on new backup:**

- Default: 10 most recent backups under `~/.claude/backups/cmemmov/<timestamp>/`
- `--keep-backups N` flag overrides the default
- `cmemmov rollback` consumes the most recent
- Pruning happens after a successful new backup, never before — guarantees we always have at least one good rollback point

**Dry-run propagation — `WriteGate` abstraction:**

- Every filesystem write — including the auto-backup itself — goes through a `WriteGate` interface
- In live mode, the gate executes the write
- In `--dry-run` mode, the gate records the intended operation (path, type of change, byte count) and returns success
- At end of run, the recorded operations become the dry-run preview summary
- Detailed design in step 6 (Component Structure)
- Architecturally enforces NFR12 (dry-run is byte-for-byte lossless) — no per-call `if (dryRun)` pattern

### Distribution & CI

**CI platform — GitHub Actions:**

- Free for public repos; first-class matrix support for Win/macOS/Linux
- Standard for OSS Node packages

**CI matrix — 3 OS × Node v22 LTS:**

- `windows-latest`, `macos-latest`, `ubuntu-latest`
- Single Node version (the project minimum)
- Both unit and integration tests run on all three OSes (NFR16 — "should work" is not acceptable)
- Cross-OS path tests use filesystem mocks for Windows-path-on-Linux semantics; real-disk integration tests run only on the matching OS

**Release process — tag-triggered:**

- Author runs `npm version <patch|minor|major>` + `git push --tags`
- GitHub Actions on tag: lint → test on all 3 OS → build npm package → publish to npm → build 4 binaries (win-x64, macos-arm64, macos-x64, linux-x64) via Node SEA → upload to GitHub Release
- Author writes the release notes manually before tagging — no semantic-release / changesets ceremony

**Versioning — semver, starting at 0.1.0:**

- Pre-1.0 signals "not yet stable" — bump to 1.0.0 when v1 success criteria from PRD are met
- Breaking bundle format changes bump the bundle's own `version` field independently from package version

### Code Quality

**Lint strictness — `@typescript-eslint/strict-type-checked` + custom rules:**

- Strict TypeScript ruleset baseline
- Custom architectural rules:
  - Ban `process.env.HOME` — must use `os.homedir()`
  - Ban hardcoded `'\\'` or `'/'` literals in path-handling code — must use `path.sep`, `path.join`, etc.
  - Require `await` on all `fs/promises` calls
  - Ban raw `JSON.parse` outside the bundle parser — must go through the Zod schema
- Custom rules implemented as a small local rule directory at `eslint-rules/` (loaded via the flat-config `plugins` field; not a published npm package)
- Test files are exempt from `no-restricted-imports` so fixture setup and mock injection can use direct `fs/promises` access. Two slightly different mechanisms: `src/**/*.test.ts` is explicitly listed in the rule block's `ignores`; `tests/**/*.test.ts` lives outside the rule block's `files: ['src/**/*.ts']` selector and is therefore never matched by the rule. Both forms are intentional and ratified in Story 3.0.
- Build/config touchpoint: `tsconfig.json` enables `resolveJsonModule: true` so service modules can `import pkg from '../package.json'` for the `cmemmov --version` flag (added in Story 1.3)

**Pre-commit hooks — none initially:**

- Add only if we observe a class of bug they'd prevent
- Solo developer with CI gating; pre-commit ceremony is optional

**Test coverage targets:**

- 80% line coverage minimum, project-wide
- 100% line + branch coverage on the path engine (`pathToSlug`, `slugToPath`, cross-OS conversion, auto-suggest)
- 100% line coverage on the bundle schema parser
- These are the load-bearing modules where silent bugs cause the named failure mode (data loss / orphaned memories)

### Decision Impact Analysis

**Implementation Sequence:**

1. Repo init + tooling (TypeScript, Vitest, ESLint with custom rules, tsup)
2. Path engine module (slug codec, cross-OS conversion, auto-suggest) — fully tested in isolation
3. Bundle schema (Zod) + parser/serializer
4. WriteGate abstraction + atomic write helper + backup module
5. Output formatter + Error model
6. Command handlers (`export` first, then `import`, then `fix-paths`, `share`, `rollback`, `completion`)
7. CI matrix + release pipeline
8. Node SEA binary builds

**Cross-Component Dependencies:**

- Every command depends on: WriteGate, Output formatter, Error model, Claude config locator
- `import` and `fix-paths` depend on: Path engine, Bundle parser, Backup module
- `export` and `share` depend on: Bundle serializer, Sanitization module, Path engine (read-only)
- `rollback` depends on: Backup module only — minimal surface
- Lint plugin depends on nothing application code; runs in the dev toolchain

## Implementation Patterns & Consistency Rules

### Code Naming

| Element | Convention | Example |
| --- | --- | --- |
| Source files | `kebab-case.ts` | `path-engine.ts`, `write-gate.ts`, `bundle-parser.ts` |
| Test files | `<module>.test.ts` colocated | `path-engine.test.ts` next to `path-engine.ts` |
| Type-only files | `*.types.ts` | `bundle.types.ts` |
| Classes / Interfaces / Types | `PascalCase`, no `I` prefix | `WriteGate`, `Bundle`, not `IBundle` |
| Functions / variables | `camelCase` | `pathToSlug`, `originalPath` |
| Compile-time constants | `SCREAMING_SNAKE_CASE` | `MAX_BUNDLE_SIZE`, `DEFAULT_BACKUP_KEEP` |
| Error codes | `SCREAMING_SNAKE_CASE`, format `<DOMAIN>_<KIND>` | `BUNDLE_INVALID_SCHEMA`, `PATH_REMAP_AMBIGUOUS` |
| Domains for error codes | Fixed set | `BUNDLE`, `PATH`, `BACKUP`, `IMPORT`, `EXPORT`, `SHARE`, `FIXPATHS`, `INTERNAL` |

### TypeScript Style

- Prefer `type` for: unions, primitives, function types, mapped types
- Prefer `interface` for: extensible object shapes (rare in this codebase)
- Banned by ESLint: `any`, non-null assertion `!`, type assertion `as` (except in tests for narrowing fixtures)
- Narrowing prefers Zod schemas and discriminated unions over assertions
- All exports are named — default exports only on the main CLI entry binary

### Module Imports

- ESM extension required in import paths: `import { foo } from './foo.js'` (TypeScript resolves to `foo.ts`)
- Path aliases: none — keep relative imports honest
- Never import from `dist/`; only from `src/`
- No barrel files (`index.ts`) — explicit imports keep the dep graph readable

### Bundle JSON Conventions

- All keys: `camelCase` (`originalPath`, not `original_path`)
- Boolean fields: `is`/`has` prefix where it improves readability (`hasCredentials`, `isCompressed`)
- Timestamp fields: ISO 8601 strings (`exportedAt: "2026-05-08T23:00:00Z"`)
- Path fields: absolute paths exactly as they appear on the source machine — never normalized away (the user's mental model matters)
- Optional fields: omitted when not set, not included as `null`
- Schema version: top-level `version` (semver string for the bundle format, separate from the package version)

### Output Stream Conventions

- `stdout`: human summary (default mode) or the final JSON object (`--json` mode); exactly one final output per command
- `stderr`: progress messages, warnings, errors — always
- No interleaving: progress messages flush to stderr before the final stdout output is written
- Progress messages start with an active verb: `Reading...`, `Writing...`, `Backing up to...`, `Remapping paths...`
- Banned by ESLint: `console.log`, `console.error`, raw `process.stdout.write`, raw `process.stderr.write` — outside the `Output` module

### Path Handling

- All paths absolute when held in memory; normalize on entry via `path.resolve`
- Path joining: `path.join` / `path.resolve` only — never string concatenation with separators
- ESLint banned: hardcoded `'/'` or `'\\'` in path-related code, `process.env.HOME`
- The slug codec lives in one module (`path-engine.ts`) — agents must call it, never reimplement
- When recording a path in the bundle, keep it as the user sees it on the source machine (don't normalize Windows backslashes to forward slashes); when comparing/searching on the local machine, always normalize via `path.resolve`

### Async & Error Patterns

- All I/O via `fs/promises` — `await` mandatory (ESLint enforced)
- No callback APIs in application code
- Errors thrown across module boundaries are always `CmemmovError`; raw errors are wrapped at the throwing module's edge
- No silent `catch` blocks — every catch either rethrows (often wrapped) or handles a specific known case with a comment explaining why
- Top-level `try/catch` lives only in the CLI shell (`src/cli.ts`); below that, errors propagate

### Test Patterns

- Unit tests: colocated `*.test.ts` next to source, mock filesystem via `vi.mock('node:fs/promises')` or `memfs`
- Integration tests: `tests/integration/<command>.test.ts` — use a temp dir under `os.tmpdir()`, real filesystem
- Test fixtures: `tests/fixtures/` (sample bundles, sample slug edge cases, sample memory directories)
- Cross-OS path tests: parameterize over `{ platform: 'win32' | 'darwin' | 'linux' }` using a mockable `os`/`path` injection — runs on all 3 in unit tests
- Structure: `describe(moduleName, () => { describe(functionName, () => { it('should ...') }) })`
- One `expect` concept per `it` — multiple assertions allowed if they verify the same concept

### Module Organization Principles

- **Pure modules** (no side effects): `path-engine`, `bundle-schema`, `slug-codec`, `sanitization-rules`. These have no `fs` dependency at all.
- **Service modules** (gated I/O): `bundle-parser`, `bundle-serializer`, `backup-service`, `claude-locator`. These use `fs/promises` directly but receive paths as injected arguments.
- **Command modules**: orchestrate services to produce a result. Live under `src/commands/`. Receive parsed args, return an exit code or throw `CmemmovError`.
- **CLI shell** (`src/cli.ts`): single entry point. Parses args via `commander`, dispatches to command modules, catches errors, sets exit code.

### Comment Discipline

- Default: no comments. Code should be self-documenting via naming.
- Exception: comment the why of non-obvious architectural choices (e.g., `// must use os.homedir() — process.env.HOME is unreliable on Windows`)
- No block comments describing what a function does — TypeScript signatures + names cover that
- Banned: TODO/FIXME/XXX without an associated GitHub issue number and a date

### Enforcement

| Rule | How Enforced |
| --- | --- |
| Naming conventions | ESLint (`@typescript-eslint/naming-convention`) |
| No `console.*` outside Output module | Custom ESLint rule (loaded from `eslint-rules/`) |
| No `process.env.HOME` | Custom ESLint rule |
| No hardcoded path separators | Custom ESLint rule (regex on string literals in path-handling files) |
| No raw `JSON.parse` outside bundle parser | Custom ESLint rule (file-scoped) |
| Async I/O always awaited | `@typescript-eslint/no-floating-promises` |
| No `any` / `as` / `!` | `@typescript-eslint/strict-type-checked` |
| Bundle schema invariants | Zod schemas at the parsing boundary |
| Path engine called, not reimplemented | Code review + naming convention (`pathToSlug` is exported only from `path-engine.ts`) |

### Anti-Patterns (Banned)

- Reimplementing the slug codec inside a command module
- Calling `fs.writeFile` outside the `WriteGate`
- `console.log('done')` for progress output
- `if (process.platform === 'win32')` inside command code — platform branching belongs in `path-engine` only
- Catching an error and swallowing it without rethrowing as `CmemmovError`
- Hardcoding `~/.claude` instead of calling the Claude config locator
- Reading a `.cmemmov` bundle with `JSON.parse` directly — must go through the schema parser

## Project Structure & Boundaries

### Complete Project Directory Tree

```text
cmemmov/
├── README.md
├── LICENSE                              # MIT
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsup.config.ts                       # build config (single bundled .js for npm + Node SEA)
├── vitest.config.ts                     # test config (coverage thresholds enforced here)
├── eslint.config.js                     # flat config, references local rules
├── .gitignore
├── .nvmrc                               # pins Node v22 for contributors
├── .editorconfig
├── .github/
│   └── workflows/
│       ├── ci.yml                       # matrix: win-latest × macos-latest × ubuntu-latest, node 22
│       └── release.yml                  # tag-triggered: npm publish + Node SEA binary builds × 4
├── docs/
│   ├── bundle-format.md                 # spec for .cmemmov JSON schema (authoritative)
│   ├── path-remapping.md                # path engine deep-dive (the differentiator)
│   ├── slug-algorithm.md                # path → slug encoding, lossy decode, fallback to cwd
│   └── contributing.md
├── eslint-rules/                        # local ESLint rules (referenced from eslint.config.js)
│   ├── no-process-env-home.js
│   ├── no-hardcoded-separator.js
│   ├── no-console-outside-output.js
│   └── no-raw-json-parse.js
├── src/
│   ├── cli.ts                           # main entry: parses args, dispatches, catches, exits
│   ├── version.ts                       # version constant (tsup-injected at build time)
│   │
│   ├── commands/                        # one file per command + flat helpers (no barrel files)
│   │   ├── export.ts
│   │   ├── export.test.ts
│   │   ├── export-selection.ts          # interactive category + project picker
│   │   ├── export-selection.test.ts
│   │   ├── import.ts
│   │   ├── import.test.ts
│   │   ├── import-path-remap.ts         # per-project guided path remapping flow
│   │   ├── import-path-remap.test.ts
│   │   ├── import-conflict-resolver.ts  # MEMORY.md / topic file merge policy
│   │   ├── import-conflict-resolver.test.ts
│   │   ├── fix-paths.ts
│   │   ├── fix-paths.test.ts
│   │   ├── share.ts
│   │   ├── share.test.ts
│   │   ├── rollback.ts
│   │   ├── rollback.test.ts
│   │   ├── completion.ts                # shell completion script generator (bash/zsh/fish/pwsh)
│   │   └── completion.test.ts
│   │
│   ├── core/                            # PURE modules — no fs, no os, no process
│   │   ├── path-engine.ts               # the differentiator: slug codec + cross-OS + auto-suggest
│   │   ├── path-engine.test.ts
│   │   ├── path-engine.types.ts         # types specific to path engine
│   │   ├── bundle-schema.ts             # Zod schemas; types derived via z.infer
│   │   ├── bundle-schema.test.ts
│   │   ├── sanitization-rules.ts        # declarative rules: redact-credentials, strip-personal
│   │   ├── sanitization-rules.test.ts
│   │   ├── decision-schema.ts           # shape of interactive/silent decisions (parity surface)
│   │   ├── decision-schema.test.ts
│   │   ├── error.ts                     # CmemmovError + error code union + exit code mapping
│   │   └── error.test.ts
│   │
│   ├── services/                        # GATED I/O — receive paths as args, never resolve them
│   │   ├── claude-locator.ts            # finds ~/.claude (honors CLAUDE_CONFIG_DIR)
│   │   ├── claude-locator.test.ts
│   │   ├── claude-reader.ts             # reads ~/.claude/* + ~/.claude.json into typed structs
│   │   ├── claude-reader.test.ts
│   │   ├── write-gate.ts                # atomic write-temp+rename; dry-run no-ops + recording
│   │   ├── write-gate.test.ts
│   │   ├── claude-writer.ts             # writes via WriteGate; never writes directly
│   │   ├── claude-writer.test.ts
│   │   ├── bundle-parser.ts             # bytes → validated Bundle (Zod), incl. integrity check
│   │   ├── bundle-parser.test.ts
│   │   ├── bundle-serializer.ts         # Bundle → bytes (canonical JSON, optional gzip, checksum)
│   │   ├── bundle-serializer.test.ts
│   │   ├── backup-service.ts            # pre-write backup + retention pruning
│   │   └── backup-service.test.ts
│   │
│   └── ui/                              # all stdout/stderr + interactive prompts
│       ├── output.ts                    # the only place that writes to stdout/stderr
│       ├── output.test.ts
│       ├── prompts.ts                   # @clack/prompts wrappers — silent-mode aware
│       └── prompts.test.ts
│
├── tests/
│   ├── integration/                     # real-fs tests; each builds an isolated temp ~/.claude/
│   │   ├── export-import-roundtrip.test.ts
│   │   ├── cross-os-import.test.ts      # win bundle → mac/linux target with mocked platform
│   │   ├── fix-paths.test.ts
│   │   ├── share.test.ts
│   │   ├── rollback.test.ts
│   │   ├── dry-run-isolation.test.ts    # asserts NFR12: dry-run leaves disk byte-identical
│   │   └── helpers/
│   │       ├── temp-claude-dir.ts       # builds a fake ~/.claude/ in os.tmpdir()
│   │       ├── claude-tree-fixtures.ts  # canned realistic .claude trees
│   │       └── platform-mock.ts         # injects platform/homedir for cross-OS tests
│   └── fixtures/
│       ├── bundles/
│       │   ├── valid-windows.cmemmov
│       │   ├── valid-linux.cmemmov
│       │   ├── valid-with-sessions.cmemmov.gz
│       │   ├── invalid-schema.cmemmov
│       │   ├── corrupted-checksum.cmemmov
│       │   └── older-bundle-version.cmemmov
│       ├── claude-trees/
│       │   ├── windows-typical/         # snapshot of a representative ~/.claude/
│       │   └── linux-typical/
│       └── slug-edge-cases.json         # paths with -, spaces, unicode, drive letters
│
└── dist/                                # gitignored; tsup output
    ├── cmemmov.js                       # bundled ESM (npm + SEA input)
    └── cmemmov.d.ts                     # type declarations
```

### Architectural Boundaries

**Layered dependency rule (enforced by code review and ESLint `no-restricted-imports`):**

```text
ui → commands → services → core
core depends on nothing (pure)
ui depends only on commander/clack/picocolors and Node built-ins
services depend on core + Node fs/promises + os
commands depend on services + core + ui
cli.ts depends on commands + ui
```

**Allowed cross-layer imports:**

- `commands/*` → `services/*`, `core/*`, `ui/*`
- `services/*` → `core/*`, Node built-ins
- `core/*` → other `core/*`, no Node built-ins except `node:path` (pure types/utilities)
- `ui/*` → `core/*` (for error types), no `services` or `commands`

**Forbidden:**

- `services/*` importing from `commands/*` or `ui/*`
- `core/*` importing from anywhere outside `core/*` (no `fs`, no `os`, no `process`)
- Anyone except `services/write-gate.ts` and `services/backup-service.ts` calling `fs.writeFile` / `fs.rename` / `fs.unlink`
- Anyone except `services/claude-locator.ts` calling `os.homedir()` directly
- Anyone except `services/bundle-parser.ts` calling `JSON.parse` on bundle bytes

### Requirements → Structure Mapping

| Functional Requirement | Lives In |
| --- | --- |
| FR1–FR7 (Export) | `src/commands/export.ts`, `export-selection.ts`, `services/bundle-serializer.ts`, `core/sanitization-rules.ts` |
| FR8–FR16 (Import + Path Remapping) | `src/commands/import.ts`, `import-path-remap.ts`, `import-conflict-resolver.ts`, `services/bundle-parser.ts`, `services/claude-writer.ts`, `core/path-engine.ts` |
| FR17–FR19 (Backup & Rollback) | `src/services/backup-service.ts`, `src/commands/rollback.ts` |
| FR20–FR23 (Path Repair) | `src/commands/fix-paths.ts`, `core/path-engine.ts` |
| FR24–FR26 (Team Sharing) | `src/commands/share.ts`, `core/sanitization-rules.ts` |
| FR27–FR30 (Bundle Format) | `src/core/bundle-schema.ts`, `services/bundle-parser.ts`, `services/bundle-serializer.ts`, `docs/bundle-format.md` |
| FR31–FR36 (CLI Interface) | `src/cli.ts`, `src/ui/output.ts`, `src/core/error.ts`, `src/commands/completion.ts` |

### Cross-Cutting Concerns → Locations

| Concern | Location |
| --- | --- |
| Auto-backup invariant | `services/backup-service.ts` (called automatically by import + fix-paths command modules before any write) |
| Dry-run propagation | `services/write-gate.ts` (every write goes through it; no command checks `dryRun` flag directly) |
| Path remapping engine | `core/path-engine.ts` (single source of truth — slug codec, cross-OS, auto-suggest) |
| Output mode duality | `ui/output.ts` (only module that writes to stdout/stderr) |
| Atomic write discipline | `services/write-gate.ts` (write-to-temp + rename) |
| Sanitization profiles | `core/sanitization-rules.ts` (declarative; consumed by export and share) |
| Format version handshake | `services/bundle-parser.ts` (single check at parse time) |
| Error model | `core/error.ts` (CmemmovError + code union) |
| Decision schema (silent-mode parity) | `core/decision-schema.ts` (interactive prompts and CLI flags both populate this) |

### Key Module Specs

**`core/path-engine.ts` — The Differentiator:**

```typescript
export function pathToSlug(absolutePath: string): string;
export function slugToPath(slug: string, sourcePlatform: NodeJS.Platform): string | null;
export function suggestRemap(originalPath: string, targetPlatform: NodeJS.Platform, targetHomedir: string): string | null;
export function findMatchingDir(originalPath: string, scanRoots: string[]): string | null;
export function isCrossPlatformMigration(sourcePlatform: NodeJS.Platform, currentPlatform: NodeJS.Platform): boolean;
```

**`services/write-gate.ts` — Dry-Run + Atomicity Gate:**

```typescript
export type WriteOp =
  | { kind: 'write'; path: string; bytes: number }
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'mkdir'; path: string }
  | { kind: 'remove'; path: string };

export interface WriteGate {
  write(path: string, content: Buffer | string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  remove(path: string): Promise<void>;
  recordedOps(): readonly WriteOp[];
}

export function makeLiveWriteGate(): WriteGate;
export function makeDryRunWriteGate(): WriteGate;
```

**`core/error.ts` — Single Error Type:**

```typescript
export type ErrorCode =
  | 'BUNDLE_INVALID_SCHEMA' | 'BUNDLE_CHECKSUM_MISMATCH' | 'BUNDLE_VERSION_MISMATCH'
  | 'PATH_REMAP_AMBIGUOUS' | 'PATH_NOT_FOUND'
  | 'BACKUP_FAILED' | 'ROLLBACK_NOT_AVAILABLE'
  | 'IMPORT_PARTIAL' | 'EXPORT_NOTHING_SELECTED'
  | 'SHARE_INVALID_SOURCE' | 'FIXPATHS_NO_PROJECTS'
  | 'INTERNAL';

export class CmemmovError extends Error {
  readonly code: ErrorCode;
  readonly file?: string;
  readonly operation?: string;
  readonly hint?: string;
  readonly exitCode: 1 | 2;
  readonly cause?: unknown;
}
```

### Build & Distribution

**`npm run build` (`tsup`):**

- Input: `src/cli.ts`
- Output: `dist/cmemmov.js` (single bundled ESM file, ~300kb gzipped) + `dist/cmemmov.d.ts`
- Externals: nothing — fully bundles `commander`, `@clack/prompts`, `picocolors`, `zod` for SEA
- Source maps: enabled for development; stripped in published npm package

**`npm publish`:**

- `package.json#files`: `["dist/cmemmov.js", "dist/cmemmov.d.ts", "README.md", "LICENSE"]`
- `bin`: `{ "cmemmov": "dist/cmemmov.js" }`
- Excludes: tests, fixtures, eslint-rules, docs, .github, source files

**`npm run build:binary` (Node SEA):**

- Inputs: `dist/cmemmov.js`, a SEA config blob, the matching Node binary for each target
- Outputs: `cmemmov-windows-x64.exe`, `cmemmov-macos-arm64`, `cmemmov-macos-x64`, `cmemmov-linux-x64`
- macOS binaries are codesigned in CI to avoid Gatekeeper issues (ad-hoc signing acceptable for v0.x; proper signing as v1.0 milestone)
- Built on each target OS in CI (cross-compilation isn't supported by Node SEA)

### Development Workflow

- `npm run dev` — `tsup --watch` rebuilds `dist/cmemmov.js` on save; run from another terminal as `node dist/cmemmov.js export`
- `npm test` — `vitest run`; coverage report on `--coverage`
- `npm run test:watch` — `vitest --watch`
- `npm run lint` — `eslint . --max-warnings=0`
- `npm run typecheck` — `tsc --noEmit` (separate from build to catch type errors tsup might miss)
- `npm run check` — runs lint + typecheck + test sequentially (CI uses this)

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:**

- TypeScript + Node v22 LTS + ESM + tsup + Vitest + Zod form a fully compatible modern Node stack — no version conflicts.
- `@clack/prompts` + `commander` + `picocolors` all support ESM and Node v22 cleanly; total runtime dep tree is small (3 packages, ~285kb), satisfying the minimal-deps NFR.
- Node SEA + tsup single-bundle output are mutually reinforcing: tsup produces exactly the single ESM file SEA requires.
- ESLint flat config + custom rules is the standard modern pattern and aligns with the typescript-eslint v8+ ecosystem.

**Pattern Consistency:**

- Naming conventions (kebab-case files, camelCase symbols, SCREAMING_SNAKE_CASE error codes) are coherent across the structure.
- "No barrel files" + named exports + explicit `.js` ESM extensions form a single import discipline.
- "Core depends on nothing" matches the placement of `path-engine.ts` in `core/` — it's pure and platform-testable.
- "WriteGate is the only thing that calls `fs.writeFile`" maps directly to a single ESLint `no-restricted-imports` rule.

**Structure Alignment:**

- The layered dependency rule (`ui → commands → services → core`) supports both the "no slug codec reimplementation" anti-pattern and the "auto-backup invariant" — backup-service lives at the right layer to be unforgettable.
- Module locations align with cross-cutting concerns: dry-run in `write-gate.ts`, sanitization in `core/`, output formatting in `ui/output.ts`.
- Tests colocated with source for unit + `tests/integration/` for filesystem integration matches the testing strategy.

### Requirements Coverage Validation

**Functional Requirements (36/36 covered):**

| FR Block | Coverage |
| --- | --- |
| FR1–FR7 (Export) | `commands/export.ts`, `export-selection.ts`, `bundle-serializer.ts`, `sanitization-rules.ts` |
| FR8–FR16 (Import + Path Remapping) | `commands/import.ts` + helpers, `bundle-parser.ts`, `claude-writer.ts`, `path-engine.ts` |
| FR17–FR19 (Backup & Rollback) | `backup-service.ts`, `commands/rollback.ts` |
| FR20–FR23 (Path Repair) | `commands/fix-paths.ts`, `path-engine.ts` |
| FR24–FR26 (Team Sharing) | `commands/share.ts`, `sanitization-rules.ts` |
| FR27–FR30 (Bundle Format) | `bundle-schema.ts`, `bundle-parser.ts`, `bundle-serializer.ts`, `docs/bundle-format.md` |
| FR31–FR36 (CLI Interface) | `cli.ts`, `output.ts`, `error.ts`, `completion.ts` |

**Non-Functional Requirements (18/19 fully covered, 1 graceful):**

| NFR | Status |
| --- | --- |
| NFR1 (<500ms startup) | Covered — minimal deps + bespoke structure |
| NFR2 (<10s typical) | Covered — async I/O throughout |
| NFR3 (<60s with 500MB sessions) | Graceful — see Important Gap #1 |
| NFR4 (dry-run no slower) | Covered — WriteGate recording is O(n) of writes |
| NFR5–9 (security) | Covered — sanitization rules + zero network calls |
| NFR10–14 (reliability) | Covered — atomic WriteGate + backup-service + dry-run gate |
| NFR15 (Node version) | Covered — v22 LTS (PRD update flagged in PRD Follow-Up Items) |
| NFR16 (3-OS testing) | Covered — CI matrix |
| NFR17 (pre-built binaries × 4) | Covered — `release.yml` |
| NFR18 (path/os built-ins only) | Covered — custom ESLint rules enforce |
| NFR19 (CLAUDE_CONFIG_DIR) | Covered — `claude-locator.ts` |

### Implementation Readiness Validation

**Decision Completeness:** All critical decisions are documented with concrete library/version choices, ESLint rules, and architectural enforcement mechanisms. An AI agent picking up this document can implement without making material decisions on its own.

**Structure Completeness:** Every functional requirement maps to a specific file. The layered dependency rule is enforced both by code review and by tooling. Cross-cutting concerns are localized to single modules.

**Pattern Completeness:** Naming, type style, async/error patterns, output streams, path handling, and test organization are all explicit. The anti-patterns list calls out the failure modes that would otherwise be likely (slug reimplementation, ad-hoc dry-run checks, console.log).

### Gap Analysis Results

**Critical Gaps (block implementation):** None.

**Important Gaps (should address before v1.0):**

1. **NFR3 — large session bundles & memory pressure:** The current bundle parser reads the entire `.cmemmov` file into memory before validation. For 500MB session-heavy bundles, V8's 3–5× heap amplification could push toward OOM on 4GB-class machines. **Mitigation:** Document this as a known limitation for v1.0; users with massive session histories use `--exclude-sessions` (the default). Streaming JSONL parsing for the sessions section is a Growth-tier feature (post-MVP).
2. **macOS Gatekeeper signing for SEA binaries:** Ad-hoc signing acceptable for v0.x; proper Apple Developer ID signing required at v1.0. Adds operational complexity (cert management) and possibly $99/year Apple Developer fee. **Mitigation:** Flag as a v1.0 milestone task; for v0.x, document the `xattr -d com.apple.quarantine ./cmemmov` workaround in the README.
3. **Active Claude Code process detection:** The PRD's user journeys assume Claude Code isn't running during migration. The architecture currently doesn't check or enforce this. If a session JSONL is actively being written to during export, partial reads are possible. **Mitigation:** README guidance to close Claude Code first; on EBUSY/EPERM during read, surface a clean error suggesting the user close Claude Code rather than failing cryptically.
4. **Concurrent cmemmov runs:** Backup directories use timestamps; two parallel runs in the same second could collide. **Mitigation:** Add PID + random suffix to backup directory names — small change in `backup-service.ts`.

**Nice-to-Have Gaps (post-v1):**

- Streaming JSONL session export/import — addresses NFR3 fully when implemented
- Bundle diff/preview command (`cmemmov diff <file>`) — already in PRD's Growth section
- Snapshot management (`cmemmov snapshot save/restore`) — already in PRD's Growth section
- Lock file or process registry to prevent two concurrent imports — minor

### Validation Issues Addressed

All four important gaps have stated mitigations that don't require architectural changes — they're either documentation tasks (gaps 1, 2, 3) or trivial code adjustments (gap 4 in `backup-service.ts`). None block starting implementation.

### Architecture Completeness Checklist

**Requirements Analysis:**

- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions:**

- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**Implementation Patterns:**

- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure:**

- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

#### Overall Status: READY FOR IMPLEMENTATION

All 16 checklist items confirmed. No critical gaps. The four important gaps have stated mitigations that don't block kicking off the first implementation story.

#### Confidence Level: High

The PRD's primary risk (silent data loss / orphaned project memories) is architecturally addressed via three mutually reinforcing mechanisms: the auto-backup invariant, the WriteGate (atomic + dry-run), and the centralized path-engine. Each has tests that gate the build. The differentiator (cross-OS path remapping) is in a single pure module that's testable on any platform.

**Key Strengths:**

- Path engine is one module — the differentiator can't drift between commands
- WriteGate makes dry-run architecturally enforceable — no scattered `if (dryRun)` checks to forget
- Layered dependency rule is mechanically enforced via ESLint
- Single error type + structured codes maps cleanly to both human and JSON output
- Bundle schema validation via Zod at the parsing boundary catches malformed input before it can propagate
- 100% / 100% coverage targets on path-engine and bundle-schema match where silent bugs would hurt most
- Three-OS CI matrix with real-disk integration tests per OS — "should work" is rejected by the test plan

**Areas for Future Enhancement:**

- Streaming session import/export (post-v1, addresses NFR3 fully)
- macOS Developer ID signing pipeline (v1.0 milestone)
- Active Claude Code process detection / friendly error messages
- Snapshot / diff commands (already in PRD Growth tier)

### Implementation Handoff

**AI Agent Guidelines:**

- Follow architectural decisions exactly as documented; do not introduce new dependencies, new layers, or new commands without updating this document
- Use the patterns in §"Implementation Patterns & Consistency Rules" verbatim — naming, async/error handling, output stream usage
- Respect the layered dependency rule (`ui → commands → services → core`); ESLint will fail builds that violate it
- Use the module specs (`path-engine`, `WriteGate`, `CmemmovError`) as defined; don't redesign their public surface
- Refer to this document as the source of truth — when the PRD and this architecture conflict, this architecture wins (it is downstream and more specific); when this architecture is silent, the PRD's FRs/NFRs apply

**First Implementation Priority:**

1. Repo initialization with the bespoke stack (commands from §"Initialization Steps")
2. Local ESLint plugin scaffolding (`eslint-rules/` + `eslint.config.js`)
3. `core/path-engine.ts` + tests (the differentiator — test it first, get to 100% coverage before touching anything else)
4. `core/bundle-schema.ts` (Zod schemas) + tests
5. `core/error.ts` (CmemmovError + code union)
6. `services/write-gate.ts` + tests
7. `services/claude-locator.ts` + `claude-reader.ts` + `bundle-parser.ts` + `bundle-serializer.ts` + `backup-service.ts` + `claude-writer.ts`
8. `ui/output.ts` + `ui/prompts.ts`
9. Commands in dependency order: `export` → `import` → `fix-paths` → `share` → `rollback` → `completion`
10. CI matrix + release pipeline + Node SEA binary build

## Revision History

- 2026-05-09 — Architecture review pass (Story 3.0): verified `suggestRemap` return type is `string | null` (matches Story 2.1 fix); replaced `eslint-plugin-cmemmov/` references with the actual `eslint-rules/` directory layout; documented `tsconfig.json: resolveJsonModule: true` (introduced in Story 1.3); added the Code Quality note ratifying the test-file exemption from `no-restricted-imports` (introduced in Story 1.5). No remaining drift found from Stories 2.0–2.4.
