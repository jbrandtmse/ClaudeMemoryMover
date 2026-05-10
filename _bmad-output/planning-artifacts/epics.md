---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
status: complete
completedAt: '2026-05-09'
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
---

# ClaudeMemoryMover - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for ClaudeMemoryMover (`cmemmov`), decomposing the requirements from the PRD and Architecture into implementable stories. No UX Design document exists — `cmemmov` is a CLI tool with terminal-based interactive prompts, and all interaction patterns are specified in the PRD's "CLI Tool Specific Requirements" section.

## Requirements Inventory

### Functional Requirements

**Export**

- **FR1:** User can interactively select which artifact categories to include in an export (global memories, project memories, global settings, project settings, CLAUDE.md files, MCP configuration, custom commands, teams, plugins, session history)
- **FR2:** User can interactively select which individual projects to include in an export, independent of category selection
- **FR3:** User can export all projects and all categories without making individual selections
- **FR4:** Session history is excluded from exports by default; user can explicitly opt it in
- **FR5:** Credentials are excluded from exports by default; user can explicitly opt them in with acknowledgment of the security implications
- **FR6:** The system produces a single portable `.cmemmov` JSON bundle file as the export artifact
- **FR7:** User can specify the output file path and name for the export bundle

**Import & Path Remapping**

- **FR8:** User can import a `.cmemmov` bundle file onto any supported target machine
- **FR9:** The system automatically detects when the export source OS and current OS differ and initiates a guided path remapping flow
- **FR10:** User can review, confirm, or override path remapping suggestions for each project individually during import
- **FR11:** The system auto-suggests new target paths by searching for directories matching the original project name on the current machine
- **FR12:** User can skip individual projects during import; skipped projects are listed in the post-import summary with instructions to re-associate later
- **FR13:** User can choose, per category, whether to merge imported data with existing Claude Code data or overwrite it
- **FR14:** User can preview all changes an import will make without writing anything to disk
- **FR15:** The system remaps absolute paths embedded in permission rules within settings.json files during import
- **FR16:** The system remaps absolute paths embedded in `.claude.json` global state fields during import

**Backup & Rollback**

- **FR17:** The system automatically creates a timestamped backup of the target `~/.claude/` state before any import write
- **FR18:** The system reports the backup location to the user before import begins
- **FR19:** User can restore the most recent pre-import backup with a single command

**Path Repair**

- **FR20:** User can re-associate existing Claude Code project slugs with new repository locations without performing a full export/import cycle
- **FR21:** The system scans `~/.claude/projects/`, displays each slug with its decoded original path, and indicates whether that path currently exists on disk
- **FR22:** The system auto-suggests new paths for missing projects by searching for matching directory names on the current machine
- **FR23:** User can confirm, override, or skip each path remapping suggestion during path repair; a backup is created before any directory is renamed

**Team Sharing**

- **FR24:** User can produce a sanitized team bundle that strips personal data — credentials, personal memory files, machine-specific paths, and user-identifying fields
- **FR25:** The sanitized team bundle retains team-relevant artifacts: CLAUDE.md files, MCP server definitions, custom commands, and shared permission patterns
- **FR26:** User can import a team bundle to bootstrap a consistent Claude Code baseline on a new machine

**Bundle Format & Compatibility**

- **FR27:** The export bundle records the original absolute path for every included project, independent of slug encoding
- **FR28:** The export bundle includes a Claude Code version fingerprint derived from installed Claude Code
- **FR29:** The system warns the user during import when the source and target Claude Code versions differ significantly; import is not blocked
- **FR30:** The export bundle is human-readable JSON inspectable and editable in any text editor

**CLI Interface & Scripting**

- **FR31:** User can run any command in non-interactive mode using CLI flags, with no prompts
- **FR32:** User can request machine-parseable JSON output from any command; the result object is emitted to stdout on completion
- **FR33:** All commands report errors to stderr with the affected file path, the attempted operation, and a plain-English suggested fix
- **FR34:** All commands exit with a standardized code: `0` = success, `1` = partial success (items skipped), `2` = fatal error (nothing written)
- **FR35:** User can generate shell completion scripts for bash, zsh, fish, and PowerShell
- **FR36:** The system emits incremental progress to stderr during long-running operations so users can confirm the tool is active

### NonFunctional Requirements

**Performance**

- **NFR1:** `cmemmov` starts and displays its first output within 500ms on any supported platform
- **NFR2:** Export and import of a typical Claude Code installation (up to 20 projects, no session history) completes within 10 seconds
- **NFR3:** Export and import including session history completes within 60 seconds for installations up to 500MB of session data
- **NFR4:** `--dry-run` completes in the same time as the equivalent live operation — it is a read-only preview, not a slower simulation

**Security**

- **NFR5:** Credentials (`.credentials.json`) are never written to the export bundle unless `--include-credentials` is explicitly passed — enforced in code, not just documentation
- **NFR6:** The `share` command never includes credentials under any circumstance, regardless of flags passed
- **NFR7:** `cmemmov` makes zero network calls at runtime — no telemetry, no version checks, no analytics — unless a future opt-in update command is explicitly invoked by the user
- **NFR8:** The export bundle contains no data beyond what the user explicitly selected during the export flow
- **NFR9:** When `--include-credentials` is used, a warning is printed before export proceeds and a warning field is embedded in the bundle itself

**Reliability**

- **NFR10:** A fatal error during import must leave the target machine's `~/.claude/` in its pre-import state — partial writes that produce an inconsistent state are not acceptable
- **NFR11:** The auto-backup created before any import or fix-paths operation must be a complete, restorable copy of `~/.claude/` — not a partial or incremental snapshot
- **NFR12:** `--dry-run` must be lossless — running it must leave the filesystem byte-for-byte identical to its state before the command ran
- **NFR13:** All file write operations use atomic patterns (write to temp, rename) where the target filesystem supports it, to prevent partial-write corruption on crash or interruption
- **NFR14:** Any unhandled error produces a non-zero exit code and a human-readable stderr message — no silent failures

**Compatibility**

- **NFR15:** `cmemmov` runs on Node.js v22 LTS and above
- **NFR16:** `cmemmov` is explicitly tested on Windows 11, macOS 14 (Sonoma), and Ubuntu 22.04 LTS — CI must cover all three; "should work" is not acceptable
- **NFR17:** Pre-built binaries are published for Windows x64, macOS arm64, macOS x64, and Linux x64 at every release, for users without Node.js in their PATH
- **NFR18:** Path handling uses Node.js `path` and `os` built-ins exclusively — no hardcoded separators or platform-specific string patterns in source code
- **NFR19:** `cmemmov` respects the `CLAUDE_CONFIG_DIR` environment variable to locate the Claude Code directory, matching Claude Code's own resolution behavior

### Additional Requirements

**Starter Template — Bespoke Minimal Stack (per Architecture §"Starter Template Evaluation"):** No starter template. Architecture explicitly evaluated and rejected oclif, gluegun, and Citty in favor of a hand-built minimal stack to satisfy the <500ms startup NFR, minimal-dependency NFR, and Node SEA single-bundle distribution. **Epic 1 Story 1 must initialize the repo from scratch using the steps documented in Architecture §"Initialization Steps".**

**Technology Stack & Toolchain (locked by Architecture):**

- TypeScript (strict mode), ESM (`"type": "module"`), Node.js v22 LTS minimum
- Runtime deps (3, all `--save-exact`): `commander`, `@clack/prompts`, `picocolors`, plus `zod` for bundle schema validation
- Dev deps: `typescript`, `@types/node`, `vitest`, `@vitest/coverage-v8`, `tsup`, `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`
- Build via `tsup` to a single bundled ESM file (`dist/cmemmov.js`)
- Test via `vitest` with V8 coverage; lint via ESLint flat config
- No `postinstall` lifecycle scripts; `package-lock.json` with all production deps pinned to exact versions

**Architectural Invariants (must be enforced in code, not docs):**

- Layered dependency rule: `ui → commands → services → core`; `core` imports nothing from `fs`, `os`, or `process`
- Single source of truth for slug codec, cross-OS conversion, and auto-suggest in `core/path-engine.ts` — no reimplementation in command modules
- All filesystem writes (including the auto-backup itself) flow through `services/write-gate.ts` (atomic write-to-temp + rename; dry-run no-ops with operation recording)
- All bundle bytes parsed exclusively through `services/bundle-parser.ts` (Zod schema + SHA256 integrity check); raw `JSON.parse` of bundle data banned outside that module
- All stdout/stderr writes flow through `ui/output.ts`; `console.log`/`console.error`/raw `process.stdout.write` banned elsewhere
- All cross-module errors are `CmemmovError` (single discriminated-union error type with `code`, `file`, `operation`, `hint`, `cause`, `exitCode`)

**Local ESLint Plugin (`eslint-rules/`):** Architectural invariants are enforced via a small local ESLint plugin with custom rules:

- `no-process-env-home` — must use `os.homedir()`
- `no-hardcoded-separator` — must use `path.sep` / `path.join`
- `no-console-outside-output` — `console.*` allowed only in `ui/output.ts`
- `no-raw-json-parse` — bundle parsing must go through Zod schema

**Bundle Format Requirements (per Architecture):**

- SHA256 checksum embedded in bundle metadata; computed over canonicalized payload (excluding the integrity field itself); `--no-integrity-check` escape hatch documented
- Auto-gzip when sessions included or bundle >5MB; auto-detected on import via magic bytes (not extension)
- Top-level `version` field for bundle format (semver, separate from package version)
- Camel-case keys, ISO 8601 timestamps, optional fields omitted (not `null`)
- Source-machine paths preserved verbatim in the bundle (don't normalize Windows backslashes to forward slashes); normalization happens only at consumption time

**Backup Service Behavior:**

- Default retention: keep last 10 backups under `~/.claude/backups/cmemmov/<timestamp>-<pid>-<random>/`
- `--keep-backups N` flag overrides default
- Pruning happens after a successful new backup, never before — guarantees at least one valid rollback point
- Backup directory naming includes PID + random suffix to prevent concurrent-run collisions (Architecture Important Gap #4 mitigation)

**CI & Release Pipeline:**

- GitHub Actions matrix: `windows-latest` × `macos-latest` × `ubuntu-latest`, single Node version (v22 LTS)
- CI gate: `lint` + `typecheck` + `test` (unit + integration) on all three OSes
- Tag-triggered release: `npm version` + `git push --tags` → CI runs full check matrix → `npm publish` → Node SEA binary builds for win-x64, macos-arm64, macos-x64, linux-x64 → upload to GitHub Release
- macOS binaries codesigned (ad-hoc for v0.x; proper Apple Developer ID signing as a v1.0 milestone)
- Versioning: semver, starting at `0.1.0`; bump to `1.0.0` when v1 success criteria met; bundle format `version` evolves independently from package version

**Test Coverage Targets:**

- 80% line coverage minimum, project-wide
- **100% line + branch coverage on `core/path-engine.ts`** (the differentiator; silent bugs orphan project memories)
- **100% line coverage on `core/bundle-schema.ts` + `services/bundle-parser.ts`** (untrusted input boundary)
- Cross-OS path tests parameterized over `{ platform: 'win32' | 'darwin' | 'linux' }` using mockable `os`/`path` injection
- Real-disk integration tests in `tests/integration/` use temp dirs under `os.tmpdir()` and run on the matching OS

**Documentation Deliverables (in `docs/`):**

- `bundle-format.md` — authoritative spec for `.cmemmov` JSON schema
- `path-remapping.md` — path engine deep-dive
- `slug-algorithm.md` — path → slug encoding, lossy decode behavior, fallback to session `cwd`
- `contributing.md` — contributor guide

**Edge Cases & Operational Concerns (Architecture Important Gaps):**

- Active Claude Code process during migration: surface a clean error on `EBUSY`/`EPERM` during read suggesting the user close Claude Code, rather than failing cryptically (Important Gap #3)
- README guidance to close Claude Code before migration; macOS Gatekeeper workaround (`xattr -d com.apple.quarantine ./cmemmov`) documented for v0.x binary distribution (Important Gap #2)
- Streaming session JSONL parse for large bundles is post-v1 (Important Gap #1) — v1.0 documents the memory-pressure limit; users with large session histories use `--exclude-sessions` (the default)

### UX Design Requirements

**N/A** — `cmemmov` is a terminal-only CLI tool. No UX Design document exists in the planning artifacts. All interactive UX is specified in the PRD §"CLI Tool Specific Requirements" (output formats, exit codes, scripting support, error message conventions) and is enforced architecturally via `ui/output.ts` and `ui/prompts.ts`. Terminal interaction patterns (interactive menus, confirmations, auto-suggestion display) use `@clack/prompts` per Architecture §"Starter Template Evaluation".

### FR Coverage Map

| FR | Epic | Brief |
|---|---|---|
| FR1 | Epic 1 | Interactive category multi-select on export |
| FR2 | Epic 1 | Per-project selection on export |
| FR3 | Epic 1 | "Export everything" shortcut |
| FR4 | Epic 1 | Sessions opt-in, excluded by default |
| FR5 | Epic 1 | Credentials opt-in, excluded by default |
| FR6 | Epic 1 | Single `.cmemmov` JSON bundle artifact |
| FR7 | Epic 1 | `--output <path>` for export |
| FR8 | Epic 1 | Import a `.cmemmov` bundle |
| FR9 | Epic 2 | Auto-detect cross-OS, initiate remap flow |
| FR10 | Epic 1 | Review/confirm/override remap per project |
| FR11 | Epic 1 + Epic 2 | Auto-suggest matching dirs (same-OS in Epic 1, cross-OS expansion in Epic 2) |
| FR12 | Epic 1 | Skip individual projects, post-import summary |
| FR13 | Epic 1 | Per-category merge/overwrite |
| FR14 | Epic 1 | `--dry-run` preview |
| FR15 | Epic 2 | Remap permission paths in `settings.json` |
| FR16 | Epic 2 | Remap paths in `.claude.json` global state |
| FR17 | Epic 1 | Auto-timestamped pre-write backup |
| FR18 | Epic 1 | Backup location reported up front |
| FR19 | Epic 1 | `cmemmov rollback` single-command restore |
| FR20 | Epic 3 | `cmemmov fix-paths` re-associates without round-trip |
| FR21 | Epic 3 | Scan + decode + indicate disk presence |
| FR22 | Epic 3 | Auto-suggest replacement paths |
| FR23 | Epic 3 | Confirm/override/skip + backup before rename |
| FR24 | Epic 4 | Sanitized team bundle strips personal data |
| FR25 | Epic 4 | Team bundle preserves CLAUDE.md/MCP/commands/permissions |
| FR26 | Epic 4 | Team bundle imports via standard import flow |
| FR27 | Epic 1 | Bundle records `originalPath` per project |
| FR28 | Epic 1 | Bundle includes Claude Code version fingerprint |
| FR29 | Epic 1 | Warn (don't block) on version mismatch |
| FR30 | Epic 1 | Bundle is human-readable JSON |
| FR31 | Epic 1 | Silent mode (CLI flags, no prompts) |
| FR32 | Epic 1 | `--json` machine-parseable output |
| FR33 | Epic 1 | Structured errors (file + operation + hint) |
| FR34 | Epic 1 | Standard exit codes 0/1/2 |
| FR35 | Epic 5 | Shell completion (bash/zsh/fish/pwsh) |
| FR36 | Epic 1 | Progress to stderr during long ops |

All 36 FRs mapped.

## Epic List

### Epic 1: Foundation & Same-OS Migration (Alex's Journey)

A user can run `cmemmov export` on one same-OS machine and `cmemmov import <bundle>` on another to migrate their full Claude Code environment, with auto-backup and one-command rollback. This epic stands up the entire architectural backbone — path engine (100% coverage), bundle format with SHA256 + auto-gzip, WriteGate (atomic + dry-run), backup service, error model, output formatter, prompts wrapper, claude config locator, CLI shell — and delivers the export, import (same-OS auto-match path), and rollback commands. CI matrix on 3 OSes is set up here so every subsequent epic inherits it.

**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR10, FR11 (same-OS), FR12, FR13, FR14, FR17, FR18, FR19, FR27, FR28, FR29, FR30, FR31, FR32, FR33, FR34, FR36

### Epic 2: Cross-OS Migration & Path Intelligence (Maya's Journey)

A user can migrate their `~/.claude/` across operating systems (Windows ↔ macOS ↔ Linux) without manually editing the bundle. Adds automatic source-OS detection, the guided per-project path-remapping flow with directory auto-suggestion, and remapping of absolute paths embedded in `settings.json` permission rules and `.claude.json` global state fields. This is where the central differentiator (slug-aware cross-OS path remapping) earns its keep.

**FRs covered:** FR9, FR11 (cross-OS expansion), FR15, FR16

### Epic 3: Path Repair Standalone Command (Jordan's Journey)

A user whose project associations are already broken (e.g., from a manual rsync that landed repos at different paths) can run `cmemmov fix-paths` to scan `~/.claude/projects/`, decode each slug, detect missing directories, auto-suggest replacements, and bulk re-associate — all without a full export/import cycle. Backup is created before any directory rename. Standalone command consuming the existing path engine and backup service from Epic 1.

**FRs covered:** FR20, FR21, FR22, FR23

### Epic 4: Team Sharing & Sanitization (Taylor's Journey)

A team lead can produce a sanitized, version-controllable team baseline bundle (`cmemmov share`) that strips personal data — credentials, personal memories, machine-specific paths, user-identifying fields — while preserving CLAUDE.md, MCP server definitions, custom commands, and shared permission patterns. New team members import the bundle via the standard `cmemmov import` flow (built in Epic 1) for one-command onboarding. Adds the "strip-personal" sanitization profile alongside the "redact-credentials-only" profile already used by export.

**FRs covered:** FR24, FR25, FR26

### Epic 5: Distribution, Shell Completion & Release Polish

`cmemmov` is globally installable via `npm install -g cmemmov` and downloadable as a pre-built single-file binary for Windows x64, macOS arm64, macOS x64, and Linux x64. Shell completion works in bash, zsh, fish, and PowerShell. The release pipeline is fully automated (tag → CI on 3 OSes → npm publish → Node SEA binaries → GitHub Release upload). Documentation deliverables — `README.md`, `docs/bundle-format.md`, `docs/path-remapping.md`, `docs/slug-algorithm.md`, `docs/contributing.md` — are complete. Operational concerns covered here: macOS Gatekeeper workaround documentation, active-Claude-Code-process EBUSY-friendly errors. Per the PRD: "(final epic)."

**FRs covered:** FR35

## Epic 1: Foundation & Same-OS Migration (Alex's Journey)

A user can run `cmemmov export` on one same-OS machine and `cmemmov import <bundle>` on another to migrate their full Claude Code environment, with auto-backup and one-command rollback. This epic stands up the entire architectural backbone — path engine (100% coverage), bundle format with SHA256 + auto-gzip, WriteGate (atomic + dry-run), backup service, error model, output formatter, prompts wrapper, claude config locator, CLI shell — and delivers the export, import (same-OS auto-match path), and rollback commands. CI matrix on 3 OSes is set up at the end so it can validate the full Epic 1 surface.

### Story 1.1: Repository Initialization & Build Toolchain

As a developer working on cmemmov,
I want a fully configured Node.js + TypeScript + ESM project with the architecture-mandated toolchain locked in place,
So that every subsequent story builds on a stable foundation matching the architecture's specifications.

**Acceptance Criteria:**

**Given** an empty repository
**When** I run `npm install`
**Then** dependencies resolve including production deps `commander`, `@clack/prompts`, `picocolors`, `zod`, and dev deps `typescript`, `@types/node`, `vitest`, `@vitest/coverage-v8`, `tsup`, `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`
**And** every dependency in `package-lock.json` is pinned to an exact version (no `^` or `~` prefixes)
**And** `package.json` declares no `postinstall`, `preinstall`, or other lifecycle scripts that execute arbitrary code

**Given** the project
**When** I inspect `package.json`
**Then** `"type": "module"` is set, `"engines.node": ">=22.0.0"` is declared, `"bin": { "cmemmov": "dist/cmemmov.js" }` is configured, and `"files"` whitelists only `dist/cmemmov.js`, `dist/cmemmov.d.ts`, `README.md`, `LICENSE`

**Given** the project
**When** I run `npm run typecheck`
**Then** `tsc --noEmit` exits 0 with no type errors
**And** `tsconfig.json` has `"strict": true`, ESM module resolution, and emits `.d.ts` declarations

**Given** the project
**When** I run `npm run lint`
**Then** ESLint flat config runs `--max-warnings=0` cleanly against the (placeholder) source

**Given** the project
**When** I run `npm run test`
**Then** vitest runs (passes with placeholder test file)

**Given** the project
**When** I run `npm run build`
**Then** tsup produces a single bundled ESM `dist/cmemmov.js` plus `dist/cmemmov.d.ts`

**Given** the project
**When** I run `npm run check`
**Then** lint + typecheck + test run sequentially and all pass

**Given** the project root
**When** I inspect the filesystem
**Then** `.nvmrc` pins Node v22, `.editorconfig` is present, `.gitignore` excludes `dist/` and `node_modules/`, and an MIT `LICENSE` file is present

**Given** `.github/workflows/ci-seed.yml`
**When** a PR is opened
**Then** a lightweight 3-OS matrix job (`windows-latest`, `macos-latest`, `ubuntu-latest`, Node v22) runs `npm ci && npm run lint && npm run typecheck` only — no integration tests yet
**And** Story 1.13 supersedes this seed workflow with the full `npm run check` matrix once the surface is large enough to warrant it; the seed exists to catch toolchain drift during foundation work (Stories 1.2–1.9)

### Story 1.2: Local ESLint Plugin — Architectural Invariant Rules

As a developer working on cmemmov,
I want a local ESLint plugin that mechanically enforces the architecture's banned-pattern invariants,
So that drift from the cross-cutting discipline (single source of truth for slug codec, atomic writes, output, bundle parsing) is caught at lint time, not in code review months later.

**Acceptance Criteria:**

**Given** the `eslint-rules/` package wired into `eslint.config.js`
**When** I lint a file containing `process.env.HOME`
**Then** the `no-process-env-home` rule reports an error pointing at the offending line with a hint to use `os.homedir()`

**Given** the lint config
**When** I lint a file in path-handling code containing a hardcoded `'/'` or `'\\'` separator literal in a string
**Then** the `no-hardcoded-separator` rule reports an error with a hint to use `path.sep`, `path.join`, or `path.resolve`

**Given** the lint config
**When** I lint a file outside `src/ui/output.ts` containing `console.log`, `console.error`, `console.warn`, `process.stdout.write`, or `process.stderr.write`
**Then** the `no-console-outside-output` rule reports an error

**Given** the lint config
**When** I lint a file outside `src/services/bundle-parser.ts` containing `JSON.parse` of a value that flows from bundle bytes
**Then** the `no-raw-json-parse` rule reports an error with a hint to route bundle parsing through the Zod schema

**Given** each custom rule
**When** I run `npm run test` against the `eslint-rules/` package
**Then** each rule has at least one positive test (rule fires on a violating fixture) and one negative test (rule does not fire on valid code)

**Given** the project's `eslint.config.js`
**When** ESLint runs
**Then** the local plugin loads alongside `@typescript-eslint/strict-type-checked` and `@typescript-eslint/naming-convention`, applying both rule sets to all `src/**/*.ts` files

### Story 1.3: Path Engine — Slug Codec & Same-OS Path Resolution

As a developer working on cmemmov,
I want a tested-to-100%-coverage `core/path-engine.ts` module exposing the slug codec, same-OS slug-to-path decode, directory matching, and cross-platform detection,
So that every command consumes a single, verified source of truth for path remapping logic and the central differentiator cannot drift across commands.

**Acceptance Criteria:**

**Given** an absolute path `'C:\\Users\\Josh\\dev\\my-app'` on win32
**When** I call `pathToSlug(path)`
**Then** it returns `'C--Users-Josh-dev-my-app'` matching Claude Code's `path.replace(/[:\\/]/g, '-')` algorithm exactly

**Given** an absolute path `'/home/jordan/dev/api-gateway'` on darwin or linux
**When** I call `pathToSlug(path)`
**Then** it returns `'-home-jordan-dev-api-gateway'`

**Given** a slug encoded from a same-OS path containing no `-` characters in any folder name
**When** I call `slugToPath(slug, currentPlatform)`
**Then** it returns the original absolute path verbatim

**Given** a slug for a path that originally contained a `-` character in a folder name (lossy decode case)
**When** I call `slugToPath(slug, sourcePlatform)`
**Then** it returns `null` (signaling ambiguity; consumers must fall back to authoritative sources like session `cwd` or bundle `originalPath`)

**Given** an `originalPath` and a list of `scanRoots` on the current machine
**When** I call `findMatchingDir(originalPath, scanRoots)`
**Then** if any `scanRoot` contains a directory with the same trailing folder name, its absolute path is returned; otherwise `null`

**Given** a source platform and a current platform
**When** I call `isCrossPlatformMigration(source, current)`
**Then** it returns `true` iff `source !== current`

**Given** the `core/path-engine.ts` module
**When** I run `npm run test -- --coverage`
**Then** line coverage is 100% AND branch coverage is 100% on this module
**And** `vitest.config.ts` enforces these thresholds — adding an untested branch causes coverage failure in CI

**Given** the slug-edge-cases fixture (paths with `-`, spaces, unicode, drive letters, UNC paths)
**When** unit tests run with mockable `os`/`path` injection over `{platform: 'win32'|'darwin'|'linux'}`
**Then** every fixture case produces the expected output on all three platforms

**Given** the architectural invariant that the slug codec lives in exactly one module
**When** I grep the codebase for `path.replace(/[:\\\\/]/g, '-')`
**Then** the regex appears only inside `path-engine.ts`; no command or service file reimplements it

### Story 1.4: Core Models — Bundle Schema, Error, Sanitization Rules

As a developer working on cmemmov,
I want pure-module definitions for the bundle schema (Zod), the single error type (`CmemmovError`), and the redact-credentials sanitization profile,
So that the parsing boundary, error model, and security profile are defined once and consumed consistently by every command and service.

**Acceptance Criteria:**

**Given** `core/bundle-schema.ts`
**When** I parse a valid fixture bundle
**Then** the Zod schema validates successfully and TypeScript types are derived via `z.infer<typeof BundleSchema>` (no manually-typed parallel definitions)

**Given** `core/bundle-schema.ts`
**When** I parse an invalid fixture bundle (missing required field, wrong type, extra unrecognized field)
**Then** Zod throws with a descriptive error referencing the failing schema path

**Given** `core/error.ts`
**When** I instantiate `new CmemmovError({ code: 'BACKUP_FAILED', file: '/path', operation: 'backup', hint: 'check write permissions', cause: originalError })`
**Then** the instance carries all fields and `exitCode` is mapped per code (e.g., `BUNDLE_INVALID_SCHEMA` → 2; `IMPORT_PARTIAL` → 1; `INTERNAL` → 2)

**Given** `core/error.ts`
**When** I inspect the `ErrorCode` union type
**Then** it contains exactly the 12 codes from architecture: `BUNDLE_INVALID_SCHEMA`, `BUNDLE_CHECKSUM_MISMATCH`, `BUNDLE_VERSION_MISMATCH`, `PATH_REMAP_AMBIGUOUS`, `PATH_NOT_FOUND`, `BACKUP_FAILED`, `ROLLBACK_NOT_AVAILABLE`, `IMPORT_PARTIAL`, `EXPORT_NOTHING_SELECTED`, `SHARE_INVALID_SOURCE`, `FIXPATHS_NO_PROJECTS`, `INTERNAL`

**Given** `core/sanitization-rules.ts` with the `redact-credentials` profile only
**When** I apply it to a fixture export bundle that includes `.credentials.json` content
**Then** credential content is removed and a `wasRedacted: true` marker is recorded; all other artifacts pass through unchanged

**Given** `core/sanitization-rules.ts`
**When** I look for the `strip-personal` profile
**Then** it is NOT yet defined (deferred to Epic 4 — Story 4.x)

**Given** the `core/` directory
**When** I inspect imports
**Then** no `core/*.ts` file imports from `node:fs`, `node:os`, or `process` (pure modules — architecturally enforced via `no-restricted-imports`)

### Story 1.5: Filesystem Discipline — WriteGate & Backup Service

As a developer working on cmemmov,
I want a `WriteGate` abstraction that all file writes flow through (atomic write-temp+rename in live mode, no-op recording in dry-run mode) plus a `backup-service` that produces complete pre-write snapshots with retention,
So that NFR10 (fatal errors leave pre-import state intact), NFR11 (complete restorable backups), NFR12 (dry-run byte-lossless), and NFR13 (atomic writes) are enforced architecturally rather than per-command.

**Acceptance Criteria:**

**Given** a live `WriteGate`
**When** I call `gate.write(targetPath, content)`
**Then** content is first written to `<targetPath>.cmemmov-tmp-<pid>-<random>` and then atomically renamed to `targetPath`
**And** an interrupted process (SIGKILL between write and rename) leaves no partial file at `targetPath`

**Given** a dry-run `WriteGate`
**When** I call `gate.write`, `gate.rename`, `gate.mkdir`, or `gate.remove`
**Then** no filesystem operation occurs
**And** `gate.recordedOps()` returns the operations in invocation order with `kind`, `path`, and (for writes) `bytes`

**Given** a cross-volume rename scenario (target on different filesystem)
**When** the live gate's `rename(from, to)` cannot be atomic
**Then** it falls back to `copyFile` + `unlink` and prints a warning via the Output module explaining non-atomicity
**And** the operation completes successfully

**Given** the `backup-service` module
**When** I call `createBackup(claudeDir)`
**Then** a complete recursive copy of `claudeDir` is created at `~/.claude/backups/cmemmov/<ISO-timestamp>-<pid>-<random>/` including the adjacent `~/.claude.json` file
**And** the directory naming includes PID + random suffix to prevent concurrent-run collisions

**Given** `backup-service` with 10 existing backups and default retention
**When** I create an 11th backup
**Then** the new backup is created first and only after success is the oldest pruned
**And** if the new backup fails for any reason, no pruning occurs and all 10 prior backups remain

**Given** `backup-service` with `--keep-backups 3`
**When** I create a backup
**Then** only the 3 most recent backups are retained after pruning

**Given** any source file other than `services/write-gate.ts` and `services/backup-service.ts`
**When** ESLint runs
**Then** `no-restricted-imports` (or equivalent rule) fails the build if that file imports `fs.writeFile`, `fs.rename`, `fs.unlink`, `fs.copyFile`, or `fs.rmdir`

**Given** a byte-for-byte filesystem snapshot taken before a dry-run command
**When** any dry-run command completes
**Then** the filesystem is byte-for-byte identical to the snapshot (NFR12 verified by integration test under `tests/integration/dry-run-isolation.test.ts`)

**Given** the live `WriteGate` and the dry-run `WriteGate` consuming an identical input stream of operations
**When** both are exercised over the same workload
**Then** the dry-run gate's per-operation cost is O(1) record-only (a struct push to `recordedOps`, zero I/O) — guaranteeing dry-run wall-clock time tracks live wall-clock time minus the I/O portion (NFR4 satisfied by construction)
**And** a unit test asserts that no `node:fs` write API is reachable from the dry-run code path, and an ESLint `no-restricted-imports` configuration bans `fs.writeFile`/`fs.rename`/`fs.unlink`/`fs.copyFile`/`fs.rmdir` inside `WriteGate`'s dry-run branch — so a future regression that adds an I/O call to the dry-run path fails the build

### Story 1.6: Bundle I/O — Parser & Serializer

As a developer working on cmemmov,
I want a `bundle-parser` (bytes → validated `Bundle`) and `bundle-serializer` (`Bundle` → bytes) that handle Zod validation, SHA256 integrity, format-version handshake, and auto-gzip uniformly,
So that every command reads and writes bundles through a single trusted boundary and corrupt or malformed input is caught at the edge.

**Acceptance Criteria:**

**Given** uncompressed bundle bytes
**When** `bundle-parser` processes them
**Then** the pipeline runs in order: `JSON.parse` → Zod validation → SHA256 integrity check (computed over canonicalized payload excluding the `integrity` field itself) → format-version handshake (warn if mismatch); the result is a typed `Bundle`

**Given** gzipped bundle bytes (any file extension)
**When** `bundle-parser` reads them
**Then** gzip magic bytes are detected via byte inspection (not extension), the content is gunzipped, then the same parse pipeline runs

**Given** bundle bytes whose embedded SHA256 checksum does not match the canonicalized payload
**When** parser runs without `--no-integrity-check`
**Then** it throws `CmemmovError({ code: 'BUNDLE_CHECKSUM_MISMATCH', exitCode: 2 })` with a hint

**Given** the same corrupted-checksum bytes
**When** parser runs with `--no-integrity-check`
**Then** a warning is emitted to stderr via Output and parsing proceeds

**Given** a bundle whose format `version` differs from the current bundle format version
**When** parser runs
**Then** a `BUNDLE_VERSION_MISMATCH` warning is emitted to stderr; parsing is NOT blocked (matches FR29 behavior)

**Given** a `Bundle` struct with no sessions and total serialized size <5MB
**When** `bundle-serializer` serializes it
**Then** the output is plain JSON (not gzipped), human-readable, with camelCase keys, ISO 8601 timestamp strings, optional fields omitted (not `null`), and source-machine paths preserved verbatim (Windows backslashes not normalized)

**Given** a `Bundle` struct including sessions OR total serialized size ≥5MB
**When** `bundle-serializer` serializes it
**Then** the output is gzipped with detectable magic bytes, and the SHA256 checksum stored in metadata is computed against the pre-gzip canonical payload

**Given** a `Bundle`
**When** I serialize it and immediately parse the result
**Then** the parsed `Bundle` is structurally identical to the input via deep equality

**Given** any source file other than `services/bundle-parser.ts`
**When** it calls `JSON.parse` on bundle bytes
**Then** the `no-raw-json-parse` ESLint rule fails the build

**Given** the `bundle-parser.ts` module
**When** tests run with coverage
**Then** line coverage is 100% on this module

### Story 1.7: Claude Code Surface — Locator, Reader, Writer

As a developer working on cmemmov,
I want services that locate the Claude Code config directory (honoring `CLAUDE_CONFIG_DIR`), read the full `~/.claude/` + `~/.claude.json` surface into typed structures, and write categories back through the WriteGate with merge/overwrite semantics,
So that every command reads and writes Claude Code state through a single typed surface — no command reads or writes raw `~/.claude/` paths directly.

**Acceptance Criteria:**

**Given** no `CLAUDE_CONFIG_DIR` environment variable
**When** `claude-locator` runs
**Then** it returns `path.join(os.homedir(), '.claude')` for the config dir and `path.join(os.homedir(), '.claude.json')` for the global state file

**Given** `CLAUDE_CONFIG_DIR=/custom/path`
**When** `claude-locator` runs
**Then** it returns `/custom/path` for the config dir and the corresponding `.claude.json` location matching Claude Code's own resolution behavior (NFR19)

**Given** any source file other than `services/claude-locator.ts`
**When** it calls `os.homedir()` or reads `process.env.CLAUDE_CONFIG_DIR`
**Then** the build fails (the `no-process-env-home` rule plus `no-restricted-imports` enforces this)

**Given** a fixture `~/.claude/` tree (e.g., `tests/fixtures/claude-trees/linux-typical/`)
**When** `claude-reader` runs against it
**Then** it returns a typed struct populated with all categories: `globalMemory`, `projectMemory`, `globalSettings`, `projectSettings`, `claudeMd`, `mcpConfig`, `customCommands`, `teams`, `plugins`, `sessionHistory`, plus `claudeJson` content and a `credentialsRef` (path only, not content)

**Given** `claude-reader`
**When** it encounters `EBUSY` or `EPERM` reading a session JSONL (active Claude Code process)
**Then** it surfaces `CmemmovError({ code: 'INTERNAL', hint: 'close Claude Code and retry', file: <path> })` instead of failing cryptically (Architecture Important Gap #3 mitigation)

**Given** `claude-writer` with a live or dry-run `WriteGate`
**When** I call `applyCategory({ category: 'globalMemory', mode: 'merge', data, gate })`
**Then** writes flow through the gate (atomic in live, recorded-only in dry-run); merge semantics for `globalMemory` apply layered MEMORY.md merge with default conflict policy `keep` and the index is rebuilt from the final on-disk state

**Given** `claude-writer` with `mode: 'overwrite'` for a category
**When** I apply it
**Then** the target category is replaced wholesale via the gate

**Given** `claude-writer` in this Epic 1 scope
**When** processing any category
**Then** it does NOT modify paths embedded in `settings.json` permission rules or `.claude.json` global state fields (path remapping is deferred to Epic 2)

**Given** `claude-reader` and a project slug under `~/.claude/projects/<slug>/`
**When** I call `claude-reader.resolveOriginalPath(slug)`
**Then** it returns `{ path: string, source: 'sessionCwd' | 'slugDecode' | null }` where (a) `source: 'sessionCwd'` and `path` is the `cwd` field read from the most recent session JSONL when at least one session exists, (b) `source: 'slugDecode'` and `path` is `path-engine.slugToPath(slug, currentPlatform)` when no session JSONL exists AND slug decode is unambiguous, (c) `source: null` and `path` is the verbatim slug string when slug decode is ambiguous (lossy)
**And** this is the ONE function consumed by both `cmemmov export` (Story 1.10) and `cmemmov fix-paths` (Story 3.1) for authoritative original-path resolution — no command implements a parallel resolver, and a `grep` for `cwd` extraction logic outside `claude-reader.ts` returns zero matches

**Given** `claude-writer` and the canonical 10-category list
**When** I inspect each category's documented merge semantics
**Then** the table below is reflected in the writer's per-category branches and asserted by unit tests; categories not appearing in this table cause a build error (an exhaustiveness check on the category union):

| Category | `merge` semantics | `overwrite` semantics |
| --- | --- | --- |
| `globalMemory` | Layered MEMORY.md merge with default conflict policy `keep` (existing entries win); index rebuilt from final on-disk state | Replace MEMORY.md and the entire memory file set wholesale |
| `projectMemory` | Per-project layered merge identical to `globalMemory` | Replace the project's memory directory wholesale |
| `globalSettings` | Deep object merge; permission-rule arrays de-duplicated by string equality | Replace `~/.claude/settings.json` wholesale |
| `projectSettings` | Per-project deep object merge | Replace per-project `settings.json` wholesale |
| `claudeMd` | Existing CLAUDE.md kept on conflict (a CLAUDE.md is project-defining; surprise-overwrite is unsafe) | Replace CLAUDE.md wholesale |
| `mcpConfig` | MCP server entries unioned by `name`; existing entry kept on collision | Replace MCP config wholesale |
| `customCommands` | Command files unioned by filename; existing kept on collision | Replace commands directory wholesale |
| `teams` | Teams unioned by `id`; existing kept on collision | Replace teams config wholesale |
| `plugins` | Plugin entries unioned by `name`; existing kept on collision | Replace plugins config wholesale |
| `sessionHistory` | Append-only union by `sessionId` (existing JSONL files never overwritten) | Replace `~/.claude/projects/<slug>/sessions/` wholesale (rare; only when user explicitly chose `--mode overwrite=sessionHistory`) |

### Story 1.8: UI Layer — Output Formatter, Prompts Wrapper, Decision Schema

As a developer working on cmemmov,
I want an `output` module that is the only place writing to stdout/stderr (with human and JSON modes), a `prompts` wrapper around `@clack/prompts` that is silent-mode-aware, and a `decision-schema` that defines the parity surface between interactive prompts and CLI flags,
So that NFR14 (no silent failures), FR31 (silent mode parity), FR32 (`--json` output), FR33 (structured errors), and the "no interleaving" output discipline are enforced by construction.

**Acceptance Criteria:**

**Given** the output module in human mode
**When** any command writes a final summary
**Then** the summary goes to stdout; all progress messages flush to stderr first; there is exactly one final stdout write per command and no interleaving with stderr

**Given** the output module in `--json` mode
**When** any command completes (success or fail)
**Then** a single JSON object is emitted to stdout with shape `{ success, command, summary, errors, warnings }`; progress lines are emitted to stderr as unstructured text

**Given** any source file outside `src/ui/output.ts`
**When** ESLint runs
**Then** `console.log`, `console.error`, `console.warn`, `process.stdout.write`, and `process.stderr.write` are flagged by the `no-console-outside-output` rule

**Given** a `CmemmovError` surfaced through the output module
**When** in human mode
**Then** stderr shows the structured error with `code`, `file`, `operation`, `hint`, and a colored headline
**And** when in `--json` mode, the error is included in the final stdout JSON object's `errors` array with all fields

**Given** the prompts module in interactive mode
**When** a command needs a category multi-select
**Then** `@clack/prompts` presents the selection UI; Ctrl+C is handled gracefully (exits with code 130 without partial writes)

**Given** the prompts module in `--silent` mode with all required CLI flags supplied
**When** a command needs a decision
**Then** the prompt function returns the value derived from the flags WITHOUT prompting

**Given** the prompts module in `--silent` mode with a required CLI flag missing
**When** a command tries to ask for that decision
**Then** it throws `CmemmovError({ code: 'INTERNAL', exitCode: 2, hint: '--<flag-name> required in silent mode' })`

**Given** `core/decision-schema.ts`
**When** I inspect it
**Then** every interactive prompt (categories, projects, merge mode, skip/override decisions, credential opt-in) has a corresponding CLI flag, and both populate the same `Decision` struct

### Story 1.9: CLI Shell — `cmemmov` Entry Point & Command Dispatch

As a developer working on cmemmov,
I want `src/cli.ts` as the single command-dispatch entry point that parses args via `commander`, dispatches to placeholder command handlers, catches all errors, and exits with the correct code,
So that every command added in subsequent stories plugs into a stable shell with consistent error handling, exit codes (FR34), and global flag handling (FR31, FR32).

**Acceptance Criteria:**

**Given** `cmemmov --help`
**When** invoked
**Then** stdout shows usage with all six top-level commands (`export`, `import`, `fix-paths`, `share`, `rollback`, `completion`) and global flags (`--silent`, `--json`, `--dry-run`, `--help`, `--version`)

**Given** `cmemmov --version`
**When** invoked
**Then** stdout shows the version string from `src/version.ts` (which is injected at build time by tsup from `package.json`)

**Given** `cmemmov bogus-command`
**When** invoked
**Then** a structured error is printed to stderr (via Output) and the process exits with code 2

**Given** any command throwing a `CmemmovError`
**When** `cli.ts` catches it
**Then** the error is rendered via Output (mode-appropriate) and the process exits with `error.exitCode`

**Given** any command throwing a non-`CmemmovError`
**When** `cli.ts` catches it
**Then** it wraps the error as `CmemmovError({ code: 'INTERNAL', cause: e, exitCode: 2 })`, renders via Output, and exits 2

**Given** the codebase
**When** I inspect `try`/`catch` blocks
**Then** the only top-level `try`/`catch` is in `src/cli.ts`; below that, errors propagate via throws (architecture rule)

**Given** any command placeholder (export/import/fix-paths/share/rollback/completion) until its dedicated story implements it
**When** invoked
**Then** it throws `CmemmovError({ code: 'INTERNAL', hint: 'not yet implemented', exitCode: 2 })` so the dispatch surface is honest about what works

**Given** the CLI shell entry point
**When** I inspect its top-level (eagerly-evaluated) imports
**Then** only `commander`, the `version` constant, and the dispatch table are imported eagerly; each command module (`commands/export.ts`, `commands/import.ts`, …) is `import()`-ed dynamically only when its command is dispatched — so `cmemmov --help` and `cmemmov --version` do NOT load `@clack/prompts`, `zod`, `picocolors`, the bundle parser, the path engine, or any service module
**And** this is enforced by a unit test that imports `cli.ts` in isolation and asserts the resulting module graph contains no edge into `commands/`, `services/`, or `core/` (other than `core/error.ts` and the version constant) — supports the NFR1 <500 ms startup budget that Story 1.13 measures end-to-end

### Story 1.10: Export Command

As a Claude Code user (Alex),
I want to run `cmemmov export` interactively or via flags to produce a single `.cmemmov` JSON bundle of my chosen artifact categories and projects,
So that I can capture my full Claude Code environment for migration, backup, or version control without manual file editing.

**Acceptance Criteria:**

**Given** a populated `~/.claude/` and I run `cmemmov export` interactively
**When** the command starts
**Then** a category multi-select appears (FR1) showing all 10 categories: `globalMemory`, `projectMemory`, `globalSettings`, `projectSettings`, `claudeMd`, `mcpConfig`, `customCommands`, `teams`, `plugins`, `sessionHistory`

**Given** the same interactive flow
**When** I confirm category selection
**Then** a per-project multi-select appears (FR2) showing decoded original paths from session `cwd`; an `--all-projects` flag bypasses this prompt (FR3)

**Given** default export
**When** it runs
**Then** session history is excluded by default (FR4); the user can opt in via `--include-sessions`

**Given** default export
**When** it runs
**Then** credentials are excluded by default (FR5); the user can opt in via `--include-credentials`

**Given** `cmemmov export --include-credentials`
**When** the command begins
**Then** a prominent stderr warning appears BEFORE the bundle is written (NFR9), and the resulting bundle includes a top-level `warning` metadata field naming credential inclusion

**Given** export completes successfully
**When** I inspect the output
**Then** a single `.cmemmov` JSON bundle file is produced (FR6) at the path supplied by `--output <path>` (FR7) or at the default `claude-export-<YYYY-MM-DD>.cmemmov` in the current working directory

**Given** an export bundle
**When** I open it in a text editor
**Then** it is human-readable JSON (FR30); each project entry includes `originalPath` (FR27); top-level metadata includes a Claude Code version fingerprint derived from the installed Claude Code (FR28)

**Given** `cmemmov export --silent --categories global-memory,settings --projects all --output ./e.cmemmov`
**When** the command runs
**Then** no prompts appear; decisions populate from flags (FR31); the bundle is produced
**And** if `--categories` is missing in silent mode, the command exits 2 with a structured error naming the missing flag

**Given** `cmemmov export --json`
**When** the command runs
**Then** progress messages go to stderr and a single JSON object is emitted to stdout on completion with `success`, `command: 'export'`, `summary`, `errors`, `warnings` (FR32, FR33)

**Given** a long-running export with sessions
**When** it runs
**Then** incremental progress lines are emitted to stderr at category and project boundaries (FR36)

**Given** an export where no categories were selected
**When** it runs
**Then** it throws `CmemmovError({ code: 'EXPORT_NOTHING_SELECTED', exitCode: 2 })`

**Given** an export bundle and the user's selection
**When** I diff bundle contents against the selection
**Then** the bundle contains nothing beyond the explicitly selected categories and projects (NFR8)

**Given** a project for which `claude-reader.resolveOriginalPath` (Story 1.7) returns `source: 'slugDecode'` (memory-only project, slug decoded best-effort) or `source: null` (lossy slug, no session)
**When** the per-project multi-select is presented interactively
**Then** the project entry is labeled `<decoded-path>  (best-effort — no sessions)` for `source: 'slugDecode'` cases and `<slug-verbatim>  (path unknown)` for `source: null` cases
**And** before the project is included in the bundle, the user is prompted to confirm the path or type a corrected one; the confirmed/corrected path is what the bundle records as `originalPath` for that project (FR27)

**Given** the same memory-only-project case in `--silent` mode
**When** the project is processed without a corresponding `--project-path <slug>=<path>` flag
**Then** the command exits 2 with `CmemmovError({ code: 'PATH_REMAP_AMBIGUOUS', hint: '--project-path <slug>=<path> required for memory-only project <slug>' })` — silent mode never silently picks a best-effort decode as the authoritative `originalPath`

### Story 1.11: Import Command — Same-OS Happy Path

As a Claude Code user (Alex),
I want to run `cmemmov import <bundle>` on a same-OS machine and have it auto-back-up, auto-confirm projects whose paths exist, let me skip those that don't, and apply per-category merge/overwrite — with a `--dry-run` preview that touches nothing,
So that migrating my Claude Code environment to a same-OS new machine is a one-command operation with a guaranteed rollback path.

**Acceptance Criteria:**

**Given** a same-OS bundle and a target machine
**When** I run `cmemmov import bundle.cmemmov`
**Then** BEFORE any write, an auto-backup of the current `~/.claude/` (and `~/.claude.json`) is created (FR17, NFR11) and its absolute path is reported to stderr at the top of the run (FR18)

**Given** a same-OS import processing each project
**When** the bundle's `originalPath` for a project exists on the target
**Then** the project is auto-confirmed for remap with no prompt (FR10, FR11 same-OS branch)

**Given** a same-OS import processing a project whose `originalPath` does NOT exist on the target
**When** the project is processed
**Then** the user is prompted with three options: skip, override (type a new path), or accept auto-suggestion (when `findMatchingDir` returns one)

**Given** the user types "skip" for a project
**When** import completes
**Then** the project appears in the post-import summary with instructions to run `cmemmov fix-paths` to associate it later (FR12)

**Given** an import processed with default `--mode merge`
**When** a category has conflicting MEMORY.md content
**Then** layered merge applies with conflict policy default `keep`; the MEMORY.md index is rebuilt from the final on-disk state

**Given** an import processed with `--mode overwrite=globalSettings`
**When** the `globalSettings` category is applied
**Then** the target category is replaced wholesale via the WriteGate (FR13)

**Given** `cmemmov import bundle.cmemmov --dry-run`
**When** the command runs
**Then** the WriteGate records all intended ops without writing; a summary printed shows projected changes (project counts, category writes, the backup that WOULD have been created) (FR14)
**And** the filesystem is byte-for-byte identical to its pre-run state (NFR12; asserted by `tests/integration/dry-run-isolation.test.ts`)

**Given** a bundle whose format `version` differs from the current bundle version
**When** import begins
**Then** a `BUNDLE_VERSION_MISMATCH` warning is emitted to stderr; import is NOT blocked (FR29)

**Given** a bundle with a corrupted checksum
**When** import begins (without `--no-integrity-check`)
**Then** import throws `BUNDLE_CHECKSUM_MISMATCH` and exits 2 BEFORE any write or backup; the pre-existing `~/.claude/` is untouched (NFR10)

**Given** an import that fails partway through with an unexpected error
**When** `cli.ts` catches it
**Then** the auto-backup remains intact; a `CmemmovError` is surfaced; the user can restore via `cmemmov rollback` (NFR10, NFR14)

**Given** Epic 1 scope (same-OS happy path)
**When** import processes paths in `settings.json` permission rules or `.claude.json` global state fields
**Then** it does NOT remap them (path remapping is Epic 2); same-OS imports assume embedded paths are still valid

**Given** import with full success
**When** complete
**Then** exit 0; if any projects were skipped, exit 1 with the summary listing them (FR34)

### Story 1.12: Rollback Command

As a Claude Code user,
I want to run `cmemmov rollback` and have it restore the most recent pre-import backup in one command,
So that I have a low-friction recovery path if an import goes wrong (FR19, NFR11) — knowing the backup was created automatically before the import started.

**Acceptance Criteria:**

**Given** at least one pre-import backup exists under `~/.claude/backups/cmemmov/`
**When** I run `cmemmov rollback`
**Then** the most recent backup is restored over `~/.claude/` and `~/.claude.json` via WriteGate (atomic where possible)

**Given** no backup directory exists at `~/.claude/backups/cmemmov/`
**When** I run `cmemmov rollback`
**Then** it throws `CmemmovError({ code: 'ROLLBACK_NOT_AVAILABLE', exitCode: 2, hint: 'no backups found under ~/.claude/backups/cmemmov/' })`

**Given** rollback succeeds
**When** complete
**Then** the stderr/JSON summary names the backup that was restored (timestamp + directory path); exit code is 0

**Given** `cmemmov rollback --json`
**When** the command runs
**Then** progress goes to stderr; the final JSON object on stdout includes the restored backup path

**Given** the most-recent backup directory is partially corrupted (truncated file, missing required path)
**When** rollback runs
**Then** a clean error explains the corruption; rollback does NOT silently fall back to the next-most-recent backup (user must re-run with `--backup <path>` to choose explicitly)

**Given** `cmemmov rollback --dry-run`
**When** invoked
**Then** the WriteGate records the restoration ops without writing; summary shows what would be restored; filesystem is byte-for-byte unchanged (NFR12)

### Story 1.13: CI Matrix — 3-OS Test Pipeline

As a cmemmov maintainer,
I want a GitHub Actions workflow that runs lint + typecheck + unit + integration tests on Windows, macOS, and Linux for every PR,
So that NFR16 ("explicitly tested on Windows 11, macOS 14, Ubuntu 22.04 — `should work` is not acceptable") is mechanically enforced and no platform regression can land unnoticed.

**Acceptance Criteria:**

**Given** `.github/workflows/ci.yml`
**When** a PR is opened against the main branch
**Then** the workflow runs in parallel on `windows-latest`, `macos-latest`, and `ubuntu-latest`

**Given** any matrix job
**When** it starts
**Then** it sets up Node v22 LTS via `actions/setup-node@<pinned-version>`, runs `npm ci`, and runs `npm run check` (lint + typecheck + test)

**Given** a PR with an ESLint violation
**When** CI runs
**Then** the lint step fails on all three OSes with the rule and offending file in the log

**Given** a PR with a unit test that fails only on Linux
**When** CI runs
**Then** `ubuntu-latest` reports failure and the other matrix jobs complete normally — failure is not masked

**Given** integration tests under `tests/integration/`
**When** CI runs them
**Then** they execute against a temp dir under `os.tmpdir()` on the respective OS
**And** cross-OS path tests are parameterized over `{ platform: 'win32' | 'darwin' | 'linux' }` via mockable `os`/`path` injection so they run on all three runners

**Given** vitest coverage thresholds defined in `vitest.config.ts`
**When** CI runs `npm run test`
**Then** thresholds are enforced: 80% project-wide line coverage, 100% line + branch on `core/path-engine.ts`, 100% line on `core/bundle-schema.ts` and `services/bundle-parser.ts`; falling below any threshold fails CI

**Given** the CI workflow
**When** I review it
**Then** no test is OS-skipped (`describe.skip(...)` / `it.skip(...)` for OS reasons); the only OS-specific behavior is real-disk integration tests asserting platform-specific path semantics, and those tests document why they only run on a specific OS

**Given** the built `dist/cmemmov.js` (or the SEA binary on its native runner once Story 5.2 lands)
**When** the CI step `npm run bench:startup` invokes `cmemmov --help` ten times and takes the median wall-clock time
**Then** the median is <500 ms on each of `windows-latest`, `macos-latest`, `ubuntu-latest`; failure to meet the budget fails CI with the actual measured value in the log (NFR1 verification)

**Given** the integration test step
**When** each top-level command is exercised under a network-blocking shim that patches `node:net`, `node:dgram`, `node:tls`, and `node:https` to throw on `connect`/`request`/`socket` and patches `globalThis.fetch` to throw
**Then** `cmemmov export`, `cmemmov import <bundle>`, `cmemmov fix-paths`, `cmemmov share`, `cmemmov rollback`, and `cmemmov completion <shell>` all complete successfully on representative fixtures with zero socket-attempt errors thrown by the shim (NFR7 / DC8 verification)
**And** a self-test asserts the shim is active by attempting `await fetch('http://example.com')` from inside the shim's harness — that call MUST throw, otherwise the no-network assertion is a false-pass and CI fails

**Given** the integration test step on representative fixtures
**When** export and import are run against a fixture with 20 projects and no session history
**Then** wall-clock time is <20 s on each runner (NFR2's 10 s budget × 2 generous CI margin); the test fails CI if the budget is exceeded with the measured value logged

**Given** the integration test step on a 500 MB session-history fixture (`tests/fixtures/large-bundles/sessions-500mb/`, materialized at runtime by a fixture-builder script — NOT committed to git)
**When** export and import are run with `--include-sessions`
**Then** wall-clock time is <120 s on each runner (NFR3's 60 s budget × 2 generous CI margin)
**And** this test is gated behind `CMEMMOV_RUN_LARGE_PERF=1` so it does NOT run on every PR; it runs nightly via a scheduled workflow and on every release tag — keeping standard PR CI fast while still catching regressions

**Given** any command run during the integration test suite
**When** the test asserts the post-run filesystem state
**Then** no file has been created or written outside (a) `~/.claude/backups/cmemmov/` (auto-backup destination), (b) the user-supplied `--output <path>` for `export`/`share`, (c) the test's own temp directory under `os.tmpdir()`, (d) the existing `~/.claude/` and `~/.claude.json` surfaces being managed — confirming CC1 (no persistent config file is ever written or read by `cmemmov`); a stray write outside this allowlist fails the test

## Epic 2: Cross-OS Migration & Path Intelligence (Maya's Journey)

A user can migrate their `~/.claude/` across operating systems (Windows ↔ macOS ↔ Linux) without manually editing the bundle. Adds automatic source-OS detection, the guided per-project path-remapping flow with directory auto-suggestion, and remapping of absolute paths embedded in `settings.json` permission rules and `.claude.json` global state fields. This is where the central differentiator (slug-aware cross-OS path remapping) earns its keep — it makes `cmemmov` the first migration tool that handles cross-OS Claude Code transitions without manual JSON editing.

### Story 2.1: Path Engine — Cross-OS Conversion & Auto-Suggest

As a developer working on cmemmov,
I want `core/path-engine.ts` extended with cross-OS slug decoding and `suggestRemap` (translates absolute paths from a source platform to a target platform's home-directory-rooted equivalent),
So that the differentiator's path-translation intelligence lives in one tested-to-100%-coverage module that every cross-OS scenario consumes — no command reimplements platform-prefix heuristics.

**Acceptance Criteria:**

**Given** a slug `'C--Users-Josh-dev-app'` and `sourcePlatform: 'win32'`
**When** I call `slugToPath(slug, 'win32')` from any current platform
**Then** it returns `'C:\\Users\\Josh\\dev\\app'` (the original Windows path, lossy-decode caveat documented and applied as in Story 1.3)

**Given** a slug `'-home-jordan-dev-api'` and `sourcePlatform: 'linux'`
**When** I call `slugToPath(slug, 'linux')` from any current platform
**Then** it returns `'/home/jordan/dev/api'`

**Given** a Windows source path `'C:\\Users\\Josh\\dev\\app'`, `targetPlatform: 'darwin'`, `targetHomedir: '/Users/josh'`
**When** I call `suggestRemap(originalPath, targetPlatform, targetHomedir)`
**Then** it detects the `C:\\Users\\<user>\\` prefix, strips it, and returns `/Users/josh/dev/app` with separator normalization

**Given** a macOS source path `/Users/maya/agents/foo`, `targetPlatform: 'win32'`, `targetHomedir: 'C:\\Users\\maya'`
**When** I call `suggestRemap(...)`
**Then** it returns `'C:\\Users\\maya\\agents\\foo'`

**Given** a Linux source path `/home/jordan/dev/api`, `targetPlatform: 'darwin'`, `targetHomedir: '/Users/jordan'`
**When** I call `suggestRemap(...)`
**Then** it returns `/Users/jordan/dev/api`

**Given** a Windows source path `'D:\\scratch\\old-project'` (no recognizable home-directory prefix)
**When** I call `suggestRemap(...)` for any target platform
**Then** it returns `null` (signaling the consumer should prompt the user for manual entry rather than guess)

**Given** a Windows UNC path `'\\\\server\\share\\folder'`
**When** I call `pathToSlug(path)`
**Then** it returns the slug per Claude Code's algorithm (`\\\\` and `\\` replaced with `-`)

**Given** paths containing non-ASCII unicode characters or spaces
**When** I run `pathToSlug` then `slugToPath` same-OS round-trip
**Then** unicode and spaces are preserved (only `:`, `/`, `\` are replaced)

**Given** the extended `core/path-engine.ts` module
**When** I run `npm run test -- --coverage`
**Then** line coverage is still 100% AND branch coverage is still 100%; new cross-OS branches are fully tested

**Given** cross-OS slug-and-path fixtures parameterized over all 6 platform combinations (win→mac, win→linux, mac→linux, mac→win, linux→mac, linux→win)
**When** unit tests run
**Then** every fixture case produces the expected output; fixtures live alongside Story 1.3's `slug-edge-cases.json`

### Story 2.2: Cross-OS Detection & Guided Per-Project Remap UI

As a Claude Code user (Maya),
I want `cmemmov import` to detect when the bundle's source OS differs from my current OS, walk me through each project's remapping with an auto-suggestion I can accept, override, or skip — and to support a `--remap` flag for scripted runs,
So that cross-OS migration becomes a 2-minute guided conversation instead of a manual JSON edit, and skipped projects flow into the same post-import summary I already know from same-OS runs.

**Acceptance Criteria:**

**Given** a bundle exported from Windows and import running on macOS
**When** import begins
**Then** stderr emits an announcement equivalent to "Export source: win32. Current platform: darwin. Path remapping required." (FR9 trigger)

**Given** the cross-OS remap flow processing a project where `path-engine.suggestRemap` returns a candidate AND `findMatchingDir` returns either the same path or a directory match
**When** the project is presented to the user
**Then** the auto-suggestion is shown as the default with options [Y]es accept / [O]verride with custom path / [S]kip; pressing Enter accepts the default

**Given** the cross-OS flow processing a project where `suggestRemap` returns `null` (no recognizable prefix) AND `findMatchingDir` finds nothing
**When** the project is presented
**Then** the original source path is shown and the user is prompted to type a target path or select [S]kip; tab-completion is offered if the prompt library supports it

**Given** `cmemmov import bundle.cmemmov --silent --remap "C:\\Users\\maya\\agents=/Users/maya/agents" --remap "C:\\dev=/Users/maya/dev"`
**When** the command runs
**Then** every project whose `originalPath` starts with one of the remap-prefix LHS values is remapped using that prefix substitution
**And** any project without a matching `--remap` rule causes exit 2 with `CmemmovError({ code: 'PATH_REMAP_AMBIGUOUS', hint: '--remap rule needed for <originalPath>' })`

**Given** a project the user marks Skip during cross-OS remap
**When** import completes
**Then** the post-import summary lists the project with the same "run `cmemmov fix-paths` to associate when ready" message used by Story 1.11 (FR12 carry-over)

**Given** a same-OS bundle (`source.platform === current.platform`)
**When** import runs
**Then** the cross-OS branch is NOT triggered — Story 1.11's same-OS flow applies unchanged

**Given** the cross-OS flow producing remap decisions
**When** the writer needs them (Story 2.3)
**Then** the decisions are captured in a single typed `RemapDecisions` struct (one source of truth) passed to `claude-writer`; no command reimplements the prefix-substitution logic

**Given** an import that completes with all projects remapped successfully
**When** done
**Then** exit 0; the summary names how many projects were auto-confirmed vs. user-confirmed vs. overridden vs. skipped

**Given** `cmemmov import bundle.cmemmov --json` in cross-OS mode
**When** the command runs
**Then** progress goes to stderr (including the "remapping path X → Y" lines); the final JSON object on stdout includes a `summary.remappings` array

### Story 2.3: Settings.json & .claude.json Path Remapping

As a Claude Code user (Maya),
I want `cmemmov import` to remap absolute paths embedded inside `settings.json` permission rules (e.g., `Read(C:\agents\**)` → `Read(/Users/maya/agents/**)`) and inside `.claude.json` global state fields, using the same per-project decisions I already made,
So that I never have to know that permission rules and global state contain machine-specific paths — the migration "just works" end-to-end.

**Acceptance Criteria:**

**Given** a Windows `settings.json` containing `"permissions": ["Read(C:\\agents\\**)", "Write(C:\\Users\\maya\\projects\\**)"]` and `RemapDecisions` mapping `C:\agents` → `/Users/maya/agents` and `C:\Users\maya\projects` → `/Users/maya/projects`
**When** `claude-writer` applies `settings.json`
**Then** the rules are rewritten to `["Read(/Users/maya/agents/**)", "Write(/Users/maya/projects/**)"]` (FR15) using path-engine's prefix-substitution helper

**Given** a `settings.json` with multiple permission rules touching different path prefixes
**When** applied
**Then** each rule is rewritten using the matching `RemapDecisions` entry; rules whose prefixes have no matching decision are passed through unchanged with a warning emitted to stderr (and recorded in `summary.warnings`)

**Given** a `.claude.json` with absolute-path-bearing fields (e.g., `lastSessionCwd`, `recentProjects[].path`, `currentProject`)
**When** `claude-writer` applies it
**Then** each recognized path field is remapped using the corresponding `RemapDecisions` entry; non-path fields (theme, hotkeys, telemetry consent, etc.) pass through verbatim (FR16)

**Given** a `.claude.json` field with a path that has no matching remap decision
**When** applied
**Then** the field is preserved as-is and a warning is emitted to stderr/`summary.warnings` naming the field and path

**Given** the path-remapping logic
**When** invoked from a same-OS import that has zero `RemapDecisions`
**Then** `settings.json` and `.claude.json` are written through verbatim (logic is decision-driven, not platform-driven — keeps the engine general for edge cases like username changes on the same OS)

**Given** any path-remapping write
**When** `--dry-run` is set
**Then** no writes occur; the dry-run summary lists each path that WOULD have been changed in `settings.json` and `.claude.json`, including before/after values

**Given** a permission rule whose path matches no remap decision AND whose target also doesn't exist on the current machine
**When** applied
**Then** the rule is preserved as-is with a warning indicating "consider running `cmemmov fix-paths` or hand-editing"; import does NOT block

**Given** the settings.json/.claude.json remap operation
**When** integrated with WriteGate
**Then** all writes flow through the gate (atomic + dry-run-aware); no `fs.writeFile` calls outside the gate

### Story 2.4: Cross-OS Integration Tests

As a cmemmov maintainer,
I want a comprehensive integration test suite that exercises all six cross-OS combinations (win→mac, win→linux, mac→linux, mac→win, linux→mac, linux→win) as full export → import round-trips,
So that the central differentiator is regression-protected by mechanical assertion, satisfying the PRD's explicit success criterion that "cross-OS migrations complete without manual file editing for all supported artifact categories."

**Acceptance Criteria:**

**Given** `tests/integration/cross-os-import.test.ts`
**When** I list the test cases
**Then** exactly six exist, one per cross-OS combination: win→mac, win→linux, mac→linux, mac→win, linux→mac, linux→win

**Given** each test case
**When** it runs
**Then** it (a) builds a fixture `~/.claude/` tree representative of the source OS using `tests/integration/helpers/temp-claude-dir.ts`, (b) runs export via the production code path to produce a `.cmemmov` bundle, (c) mocks `os.platform()` and `os.homedir()` to the target OS via `tests/integration/helpers/platform-mock.ts`, (d) runs import with prepared remap decisions (or `--remap` flags), (e) asserts the resulting target tree

**Given** a successful cross-OS import test
**When** assertions run
**Then** project directories under target `~/.claude/projects/` retain the source slug as the stable directory identifier — the directory name does NOT change on cross-OS import (slugs are content-addressing keys; renaming would orphan memories and session history); `settings.json` permission rules contain target-OS-style paths; `~/.claude.json` global state path fields are target-OS-style; `MEMORY.md` indexes match the on-disk file layout

> **Dev note (Story 3.0 correction, 2026-05-09):** the source slug is stable because `pathToSlug` applied to the source path produces the canonical key for that project's history. Renaming the directory under target `~/.claude/projects/` to a target-OS-encoded slug would orphan the memories and session JSONL files keyed under the source slug.

**Given** a cross-OS test scenario where the user (simulated) skips one project
**When** the test runs
**Then** the post-import summary structure correctly lists the skipped project; the project directory is NOT created on the target tree

**Given** a cross-OS test running with `--dry-run`
**When** it completes
**Then** byte-for-byte snapshot of the target tree before vs. after shows zero changes (NFR12 enforced cross-OS too)

**Given** a cross-OS test with a corrupted bundle checksum
**When** it runs
**Then** import exits 2 with `BUNDLE_CHECKSUM_MISMATCH`; no auto-backup is created; target tree is untouched (consistency with Story 1.11 same-OS contract)

**Given** the cross-OS integration test file
**When** CI runs
**Then** it executes on all three OS runners (win/mac/linux) — the platform mock makes the source OS portable; only assertions that depend on current-OS filesystem behavior (e.g., `fs.rename` atomicity) are guarded by `os.platform()` checks with documented reasons

## Epic 3: Path Repair Standalone Command (Jordan's Journey)

A user whose project associations are already broken (e.g., from a manual rsync that landed repos at different paths) can run `cmemmov fix-paths` to scan `~/.claude/projects/`, decode each slug, detect missing directories, auto-suggest replacements, and bulk re-associate — all without a full export/import cycle. Backup is created before any directory rename. Standalone command consuming the existing path engine and backup service from Epic 1.

### Story 3.1: Project Inventory & Slug Decode Scan

As a Claude Code user (Jordan),
I want `cmemmov fix-paths` to scan `~/.claude/projects/`, decode each slug to its original path (preferring session `cwd` over lossy slug reversal), and report which projects exist on disk vs. which are missing,
So that I can see at a glance which of my projects have orphaned memories from a moved or renamed directory — before any changes are proposed.

**Acceptance Criteria:**

**Given** a populated `~/.claude/projects/` and I run `cmemmov fix-paths`
**When** the scan phase runs
**Then** stderr/JSON output shows a list with each entry containing `slug`, `decodedPath`, `exists` (boolean), and `source` (`sessionCwd` or `slugDecode`) (FR21)

**Given** a project slug whose path is recoverable from session JSONL `cwd` fields
**When** scan runs
**Then** `decodedPath` is taken from session `cwd` (authoritative source per Architecture §"Verified Ground Truth"); `source: 'sessionCwd'` is recorded

**Given** a project slug whose project directory has no session JSONL files (memory-only project)
**When** scan runs
**Then** `decodedPath` falls back to `path-engine.slugToPath(slug, currentPlatform)`; `source: 'slugDecode'` is recorded; if `slugToPath` returns `null` (lossy), the user is presented with the slug verbatim and asked to confirm the original path (decoded best-effort)

**Given** a project's `decodedPath` exists on the filesystem
**When** checked
**Then** `exists: true` (status FOUND)

**Given** a project's `decodedPath` does NOT exist
**When** checked
**Then** `exists: false` (status NOT FOUND)

**Given** all projects scan as FOUND OR `~/.claude/projects/` is empty
**When** scan completes
**Then** an informational message "No projects need fixing" is emitted; the command exits 0; no remap or apply phase runs (early exit per `FIXPATHS_NO_PROJECTS` handling)

**Given** `cmemmov fix-paths --json`
**When** scan runs
**Then** progress goes to stderr; the final stdout JSON object includes `summary.projects` array with the structured inventory

**Given** `cmemmov fix-paths --dry-run` (with no remappings to apply)
**When** scan runs
**Then** behaves identically to non-dry-run scan (no writes either way) — useful for inspection

### Story 3.2: Auto-Suggestion & Interactive Remap Flow

As a Claude Code user (Jordan),
I want `cmemmov fix-paths` to auto-suggest a new path for each missing project by searching for a directory with the same name under my home tree, and let me confirm, override, or skip per project (or supply a `--remap` flag for scripted runs),
So that I can fix ten broken projects in two minutes — accepting auto-suggestions for the obvious ones and overriding only the edge cases.

**Acceptance Criteria:**

**Given** scan results with N missing projects
**When** the remap phase runs
**Then** for each missing project, `path-engine.findMatchingDir(originalPath, scanRoots)` is called with `scanRoots: [os.homedir(), <common subdirs like dev/, work/, projects/, src/>]` to produce an auto-suggestion (FR22)

**Given** a missing project with an auto-suggestion available
**When** presented to the user
**Then** the prompt shows `<originalPath> → <suggestion>` with options [Y]es accept / [O]verride with custom path / [S]kip; default is Yes (Enter accepts)

**Given** a missing project with no auto-suggestion (`findMatchingDir` returned null)
**When** presented
**Then** the prompt shows `<originalPath> → (no match found)` and asks the user to type a target path or [S]kip

**Given** `cmemmov fix-paths --silent --remap "/home/jordan/dev=/home/jordan/work"`
**When** the command runs
**Then** every missing project whose `originalPath` starts with `/home/jordan/dev` is remapped via prefix substitution
**And** any missing project not covered by a `--remap` rule causes exit 2 with `CmemmovError({ code: 'PATH_REMAP_AMBIGUOUS', hint: '--remap rule needed for <originalPath>' })`

**Given** `cmemmov fix-paths --silent` without any `--remap` flag and missing projects exist
**When** the command runs
**Then** it exits 2 with `PATH_REMAP_AMBIGUOUS` and a hint listing the unhandled projects

**Given** an auto-suggestion that resolves to the same path as `originalPath` (no-op)
**When** processed
**Then** the project is treated as no-op-skip (the rename would be a no-op); recorded in `summary.skipped`

**Given** `--dry-run` set during the remap phase
**When** decisions are collected
**Then** the apply phase is invoked under the dry-run gate; no writes occur; the dry-run summary lists every rename that WOULD happen

**Given** `--json` mode with the remap flow
**When** the command completes
**Then** `summary.remappings` is an array of `{ slug, originalPath, targetPath, action: 'remap' | 'skip' | 'no-op' }`

### Story 3.3: Apply Renames + Update `.claude.json` + Backup

As a Claude Code user (Jordan),
I want `cmemmov fix-paths` to back up `~/.claude/` first, then rename the project directories under `~/.claude/projects/` and update the corresponding entries in `~/.claude.json` so both stay coherent — and to abort safely if something would clobber existing state,
So that fix-paths is trustworthy: my Claude Code state is never left half-renamed, and I always have a rollback point.

**Acceptance Criteria:**

**Given** confirmed remap decisions from Story 3.2
**When** the apply phase begins
**Then** BEFORE any write, an auto-backup of `~/.claude/` and `~/.claude.json` is created via the Story 1.5 `backup-service` (PID+random suffix); the backup path is reported to stderr at the top of the phase (FR23 backup-before-rename)

**Given** a remap decision `(originalPath → newPath)`
**When** applied
**Then** (a) the new slug is computed via `path-engine.pathToSlug(newPath)`, (b) `~/.claude/projects/<oldSlug>` is renamed to `~/.claude/projects/<newSlug>` via WriteGate, (c) the matching entry in `~/.claude.json` is updated to use `newPath` in path/cwd fields and the new slug (FR20)

**Given** a remap decision whose target slug already exists at `~/.claude/projects/<newSlug>` (collision)
**When** applied
**Then** the operation throws `CmemmovError({ code: 'INTERNAL', hint: 'target slug <newSlug> already exists; remove or merge manually before re-running, or run cmemmov rollback' })`; nothing is renamed; the backup remains intact; exit code is 2

**Given** a project being renamed has no corresponding entry in `~/.claude.json` (orphaned slug)
**When** applied
**Then** the project directory is renamed; a warning is emitted naming the orphan; `summary.warnings` records it; exit succeeds

**Given** `~/.claude.json` is missing entirely
**When** the command runs
**Then** only project directories are renamed; a warning informs the user; the apply succeeds for the directory rename

**Given** `--dry-run` flag
**When** the apply phase runs
**Then** no filesystem writes occur (NFR12); the dry-run summary lists each rename and each `~/.claude.json` field update that WOULD occur

**Given** the apply phase fails partway through with an unexpected error
**When** caught
**Then** the backup remains intact; a `CmemmovError` is surfaced; the user can run `cmemmov rollback` to restore the pre-fix-paths state (NFR10)

**Given** the apply phase completes
**When** done
**Then** the final summary names the backup path, count of renames, count of skips, count of warnings; exit code is 0 if all decisions applied cleanly, 1 if any were skipped (consistent with FR34)

### Story 3.4: fix-paths Integration Tests

As a cmemmov maintainer,
I want an integration test suite covering `fix-paths`' scan, remap, and apply phases against realistic fixture trees including edge cases (no projects need fixing, slug collisions, cross-OS slug encoding, lossy slug decode),
So that the standalone path-repair workflow (Jordan's journey) is regression-protected end-to-end and the PRD success criterion "10 projects remapped in two minutes" is mechanically verified.

**Acceptance Criteria:**

**Given** `tests/integration/fix-paths.test.ts`
**When** I list its test cases
**Then** it covers at minimum: (a) clean tree with all projects FOUND (early exit asserted), (b) tree with several missing projects all auto-suggestable, (c) mixed tree (some FOUND, some NOT FOUND), (d) tree with a slug collision on apply, (e) tree with a memory-only project (no session JSONL — fallback to slug decode), (f) cross-OS slug-decode scenario (run via platform mock)

**Given** each test case
**When** it runs
**Then** the test builds a fixture `~/.claude/` tree (using Story 1.13's helpers), runs `fix-paths` via the production CLI shell with prepared remap decisions or `--remap` flags, and asserts (a) `~/.claude/projects/` contents post-apply, (b) `~/.claude.json` contents post-apply, (c) exit code, (d) JSON output structure

**Given** a scenario triggering a successful rename
**When** assertions run
**Then** the new slug exists at `~/.claude/projects/`; the old slug does NOT exist; `~/.claude.json` references the new path with the new slug

**Given** a `--dry-run` integration test
**When** it runs
**Then** byte-for-byte filesystem snapshot before vs. after shows zero changes (NFR12)

**Given** a scenario where the user (simulated) skips a project
**When** the test runs
**Then** the project remains at its old slug; `~/.claude.json` is unchanged for that project; `summary.skipped` lists it

**Given** the slug-collision scenario
**When** apply runs
**Then** the test asserts the operation throws with the documented `code` and `hint`; the backup directory is verified to exist and to contain the pre-apply state; the tree's collided slugs are unchanged

**Given** the cross-OS slug-decode scenario
**When** running on each of win/mac/linux runners via platform mock
**Then** slug decoding behaves consistently across platforms (lossy cases handled the same way); test passes on all three OSes

## Epic 4: Team Sharing & Sanitization (Taylor's Journey)

A team lead can produce a sanitized, version-controllable team baseline bundle (`cmemmov share`) that strips personal data — credentials, personal memories, machine-specific paths, user-identifying fields — while preserving CLAUDE.md, MCP server definitions, custom commands, and shared permission patterns. New team members import the bundle via the standard `cmemmov import` flow (built in Epic 1) for one-command onboarding. Adds the "strip-personal" sanitization profile alongside the "redact-credentials-only" profile already used by export.

### Story 4.1: Strip-Personal Sanitization Profile

As a developer working on cmemmov,
I want a declarative "strip-personal" profile in `core/sanitization-rules.ts` that defines exactly what is stripped (credentials, personal memory files, user-identifying fields, machine-specific paths) vs. preserved (CLAUDE.md, MCP server definitions, custom commands, shared permission patterns, network paths) for every artifact category,
So that NFR6 (never include credentials) is enforced architecturally inside the profile (not at the command level), and `cmemmov share` is a single declarative transformation rather than ad-hoc filtering scattered across modules.

**Acceptance Criteria:**

**Given** `core/sanitization-rules.ts`
**When** I inspect its exports
**Then** it defines two profiles: `redact-credentials` (Epic 1 / Story 1.4) and `strip-personal` (this story); both are declarative data structures, not procedural code

**Given** any bundle that contains credentials (regardless of how they got there, including via `--include-credentials` upstream)
**When** the `strip-personal` profile is applied
**Then** credentials are removed unconditionally; a `wasRedacted: { credentials: true }` marker is recorded in the bundle metadata
**And** there is NO flag, environment variable, or escape hatch that bypasses this — NFR6 is enforced in the profile itself

**Given** a bundle's `globalMemory` and `projectMemory` entries
**When** `strip-personal` is applied
**Then** entries flagged as personal are removed; an entry is flagged personal if (a) its filename matches a configured personal-data pattern (e.g., `personal*`, `private*`, `me_*`, `todo*`), OR (b) its frontmatter has `personal: true`
**And** entries that don't match the personal heuristic — including CLAUDE.md, team conventions, shared rules — are preserved

**Given** `settings.json` permission rules in a bundle
**When** `strip-personal` is applied
**Then** rules with absolute paths under the source machine's home directory (e.g., `Read(C:\\Users\\Josh\\agents\\**)`) are stripped with a warning recorded in the metadata
**And** rules with relative paths (e.g., `Read(./**)`) or network paths (e.g., `Read(\\\\server\\share\\**)`, URLs) are preserved (per PRD Journey 4: "MCP server paths reference `//internal/toolserver` — a network path that resolves the same way on everyone's machine")

**Given** MCP server definitions in a bundle
**When** `strip-personal` is applied
**Then** entries whose command/path field references a network URL or UNC path are preserved verbatim; entries whose command/path field is an absolute local path under the source home directory are stripped with a warning naming the field

**Given** custom commands
**When** `strip-personal` is applied
**Then** all custom commands are preserved (FR25 — explicitly team-relevant)

**Given** `~/.claude.json` content in a bundle
**When** `strip-personal` is applied
**Then** user-identifying fields (e.g., `email`, `name`, `machineId`, `lastSessionCwd`, `recentProjects`) are removed per a documented allowlist; team-relevant fields (theme, allowed-permissions templates) are preserved per the same allowlist

**Given** session history
**When** `strip-personal` is applied
**Then** session history is stripped unconditionally (never team-shareable — contains user paths and conversation content)

**Given** every category in the canonical category list
**When** the `strip-personal` profile is consulted
**Then** every category has an explicit decision (strip / preserve / partial); no category is silently default-handled — adding a new category to the system without updating this profile fails a unit test

**Given** the `core/sanitization-rules.ts` module
**When** tests run with coverage
**Then** line coverage is 100% on this module (the rules ARE the contract — every branch must be exercised)

**Given** the `strip-personal` profile's personal-filename pattern set
**When** I inspect `core/sanitization-rules.ts`
**Then** the patterns are exposed as a named exported constant `PERSONAL_FILENAME_PATTERNS: readonly RegExp[]` (currently `personal*`, `private*`, `me_*`, `todo*`) — defined once at module top level, not inlined inside the profile's filtering body — so that `cmemmov share` (Story 4.2) reads the same constant for its interactive preview and so the `--include-pattern` / `--exclude-pattern` overrides compose against a single source of truth
**And** the constant is documented in `docs/bundle-format.md` with the note: "the heuristic is intentionally conservative — false positives (a team file misidentified as personal and stripped) are safer than false negatives (personal data leaked into a shared bundle); the override flags exist for power users who need to tune the pattern set"

### Story 4.2: `share` Command Implementation

As a Claude Code user (Taylor, team lead),
I want to run `cmemmov share` interactively or via flags to produce a team baseline bundle that has the `strip-personal` profile applied — and to have the command refuse `--include-credentials` at parse time so I can never accidentally publish credentials to a shared repo,
So that I can commit `team-baseline.cmemmov` to version control and trust that no personal data was leaked.

**Acceptance Criteria:**

**Given** a populated `~/.claude/` and I run `cmemmov share` interactively
**When** the command starts
**Then** a category multi-select appears pre-populated to team-relevant categories (`claudeMd`, `mcpConfig`, `customCommands`, `globalSettings` patterns)
**And** `sessionHistory` and personal memory categories are NOT in the selectable set (they are architecturally out of scope for `share`)

**Given** the `share` command running
**When** the bundle is produced
**Then** the `strip-personal` sanitization profile from Story 4.1 is applied unconditionally
**And** the resulting bundle has top-level metadata `profile: 'team-baseline'` distinguishing it from a regular export bundle

**Given** `cmemmov share --include-credentials`
**When** the command parses arguments
**Then** it exits 2 with `CmemmovError({ code: 'SHARE_INVALID_SOURCE', hint: '--include-credentials is not supported by share (NFR6); credentials are always excluded from team bundles' })`
**And** no bundle is produced

**Given** a share bundle produced successfully
**When** I open it in a text editor
**Then** it is human-readable JSON (FR30)
**And** it contains `profile: 'team-baseline'`
**And** it contains team-relevant artifacts (FR24, FR25)
**And** it contains NO credentials (NFR6) and NO personal memory entries (FR24)

**Given** `cmemmov share --output team-baseline.cmemmov`
**When** the command runs
**Then** the bundle is written to the specified path

**Given** `cmemmov share --silent --categories claude-md,mcp,custom-commands,settings --output baseline.cmemmov`
**When** the command runs
**Then** no prompts; bundle produced; passing `--include-credentials` in silent mode also exits 2 (FR31 silent-mode parity preserved, NFR6 still enforced)

**Given** `cmemmov share --json`
**When** the command completes
**Then** final stdout JSON includes `summary.categoriesIncluded`, `summary.itemsStripped` (count), `summary.warnings` (each stripped path/MCP entry recorded with a hint)

**Given** the `share` command implementation
**When** I trace the data flow
**Then** the path from `claude-reader` → sanitization → `bundle-serializer` runs the `strip-personal` profile in the middle; no command-level filtering bypasses it (defense in depth — even if the profile somehow let credentials through, the `share` command would still attempt to strip them at write time, but the architecture is profile-first)

**Given** `cmemmov share --dry-run`
**When** the command runs
**Then** no bundle file is written (NFR12); the dry-run summary lists categories included and items that WOULD be stripped

**Given** `cmemmov share` running interactively (not `--silent`)
**When** sanitization has classified items but BEFORE the bundle file is written
**Then** stderr displays a preview block listing every file/MCP-entry/permission-rule that the `strip-personal` profile classified as personal — each labeled with the matched rule (a regex from `PERSONAL_FILENAME_PATTERNS`, or a structural rule like `home-directory absolute path` / `local MCP command path`) — and the user is prompted: "[Y]es write bundle / [N]o cancel / [E]dit overrides"
**And** `[E]dit` re-prompts for additional `--include-pattern <glob>` and/or `--exclude-pattern <glob>` values, then re-runs sanitization (without re-running the slow read phase) and shows the updated preview

**Given** `cmemmov share --include-pattern "todo*" --exclude-pattern "internal-todo-list.md"` (interactive or silent)
**When** the command composes its effective pattern set
**Then** the effective set is: stock `PERSONAL_FILENAME_PATTERNS` (Story 4.1), MINUS any pattern matched by an `--exclude-pattern`, PLUS every glob from `--include-pattern`
**And** the composed pattern set is logged to stderr at the start of the run so the user sees exactly which patterns are active for this invocation
**And** the override flags do NOT bypass the unconditional credentials-strip rule (NFR6 still enforced — the pattern flags govern personal-memory file detection only, never credentials)

### Story 4.3: `share` + Team Bundle Round-Trip Integration Tests

As a cmemmov maintainer,
I want an integration test suite that exercises the full `share` → version control → `import` round trip on a clean target tree, with explicit negative tests for NFR6 (credentials never included) and personal-data exclusion,
So that the team-onboarding workflow (Taylor's journey) is regression-protected end-to-end and the security-critical NFR6 is mechanically verified rather than trusted to documentation.

**Acceptance Criteria:**

**Given** `tests/integration/share.test.ts`
**When** I list its test cases
**Then** it covers at minimum: (a) basic `share` → `import` round trip on a clean target, (b) `--include-credentials` rejection, (c) home-directory absolute-path stripping, (d) network-path preservation, (e) personal memory exclusion, (f) credential exclusion (positive test starting with credentials present in source `~/.claude/`)

**Given** a fixture `~/.claude/` tree containing credentials, personal memories (`personal_notes.md`), CLAUDE.md, MCP server definitions, custom commands, and `~/.claude.json` with user-identifying fields
**When** `share` is run
**Then** the produced bundle contains CLAUDE.md, MCP servers, and custom commands (FR25)
**And** the bundle contains NO credentials (NFR6) and NO `personal_notes.md` entry (FR24)

**Given** a team bundle imported on a clean target tree (FR26 round-trip)
**When** `import` runs against it (using Epic 1's import command, with appropriate `--remap` decisions if cross-OS)
**Then** the target `~/.claude/` has CLAUDE.md, MCP, custom commands installed
**And** the target's existing `~/.claude/.credentials.json` (if any) is untouched (the team bundle never references it)
**And** no personal data appears in the target

**Given** a share bundle inspected as JSON
**When** the test greps it for forbidden content
**Then** there are zero occurrences of `.credentials.json` content
**And** zero occurrences of `personal_*` filenames
**And** zero absolute paths under the source machine's home directory in `settings.json` permission rules (only relative or network paths)

**Given** the `--include-credentials` rejection test
**When** invoked
**Then** the command exits 2 with the documented `SHARE_INVALID_SOURCE` error; no bundle is written; assertion verifies the absence of any output bundle file

**Given** a fixture with an MCP server defining a network path (e.g., `\\\\internal\\toolserver`)
**When** `share` runs
**Then** the MCP entry is preserved verbatim in the bundle (PRD Journey 4 requirement)

**Given** a fixture with an MCP server defining an absolute local path (e.g., `C:\\agents\\local-tool.js`)
**When** `share` runs
**Then** the MCP entry's path field is stripped (or the entire entry removed per the `strip-personal` rule); a warning is recorded in `summary.warnings` naming the entry and reason

**Given** a `share --dry-run` integration test
**When** it runs
**Then** no bundle file is written; byte-for-byte filesystem snapshot before vs. after shows zero changes (NFR12)

**Given** the integration tests
**When** CI runs
**Then** they execute on all three OS runners (Windows, macOS, Linux) — the `strip-personal` profile must behave identically across platforms

## Epic 5: Distribution, Shell Completion & Release Polish

`cmemmov` is globally installable via `npm install -g cmemmov` and downloadable as a pre-built single-file binary for Windows x64, macOS arm64, macOS x64, and Linux x64. Shell completion works in bash, zsh, fish, and PowerShell. The release pipeline is fully automated (tag → CI on 3 OSes → npm publish → Node SEA binaries → GitHub Release upload). Documentation deliverables — `README.md`, `docs/bundle-format.md`, `docs/path-remapping.md`, `docs/slug-algorithm.md`, `docs/contributing.md` — are complete. Operational concerns covered here: macOS Gatekeeper workaround documentation, active-Claude-Code-process EBUSY-friendly errors. Per the PRD: "(final epic)."

### Story 5.1: Shell Completion Command

As a Claude Code user,
I want `cmemmov completion <shell>` to emit a tab-completion script for bash, zsh, fish, or PowerShell that I can source from my shell init,
So that I can tab-complete commands, subcommands, and flags — reducing typing and surfacing options I might not have known about.

**Acceptance Criteria:**

**Given** `cmemmov completion bash`
**When** invoked
**Then** stdout contains a valid bash completion script that supports tab-completion of all six commands (`export`, `import`, `fix-paths`, `share`, `rollback`, `completion`) and the global flags (`--silent`, `--json`, `--dry-run`, `--help`, `--version`)

**Given** `cmemmov completion zsh`
**When** invoked
**Then** stdout contains a valid zsh completion script with the same coverage

**Given** `cmemmov completion fish`
**When** invoked
**Then** stdout contains a valid fish completion script

**Given** `cmemmov completion powershell`
**When** invoked
**Then** stdout contains a valid PowerShell tab-completion script (using `Register-ArgumentCompleter`)

**Given** `cmemmov completion` with no shell argument on a POSIX host (`process.platform !== 'win32'`)
**When** invoked
**Then** the command detects the running shell by reading `process.env.SHELL` and matching its basename (`bash`, `zsh`, `fish`); on a successful match, the corresponding completion script is emitted
**And** if `process.env.SHELL` is unset or its basename does not match a supported shell, it exits 2 with `CmemmovError({ code: 'INTERNAL', hint: 'specify shell: cmemmov completion <bash|zsh|fish|powershell>' })`

**Given** `cmemmov completion` with no shell argument on Windows (`process.platform === 'win32'`)
**When** invoked
**Then** auto-detection is NOT attempted — detecting the parent shell from a Node child process on Windows is unreliable (`$env:PSModulePath` / `$Host.Name` are not exposed, and walking the parent process requires platform-specific APIs that are out of scope for v1)
**And** the command exits 2 with `CmemmovError({ code: 'INTERNAL', hint: 'on Windows, specify the shell explicitly: cmemmov completion powershell' })`
**And** this Windows-explicit-required behavior is documented in `cmemmov completion --help` output and in the `README.md` install-instructions block

**Given** `cmemmov completion bogus-shell`
**When** invoked
**Then** exits 2 with a clear error: "unsupported shell: bogus-shell. Supported: bash, zsh, fish, powershell"

**Given** a sourced completion script in its target shell
**When** I type `cmemmov <TAB>`
**Then** all six commands are suggested
**And** typing `cmemmov export --<TAB>` suggests `export`'s flags including the global flags

**Given** smoke tests for completion in CI
**When** they run
**Then** at least one positive test per shell (where the shell binary is available on the runner) verifies the script parses without syntax error and offers completions for `cmemmov export --help`

**Given** `cmemmov completion bash --json`
**When** invoked
**Then** the final stdout JSON object includes `command: 'completion'`, `shell: 'bash'`, and `script: <the script as a string>` — supporting non-interactive consumption

**Given** `cmemmov completion --help`
**When** invoked
**Then** usage shows all four supported shells with examples (`eval "$(cmemmov completion bash)"` for POSIX shells; `cmemmov completion powershell | Out-String | Invoke-Expression` for PowerShell)

### Story 5.2: Node SEA Binary Builds for Four Platforms

As a cmemmov maintainer,
I want `npm run build:binary` (per-platform on each matching CI runner) to produce single-file binaries for Windows x64, macOS arm64, macOS x64, and Linux x64 using Node SEA,
So that NFR17 is satisfied and users without Node.js installed can run `cmemmov` directly from a downloaded binary.

**Acceptance Criteria:**

**Given** `dist/cmemmov.js` produced by tsup
**When** I run `npm run build:binary` on a Windows runner
**Then** `dist/binaries/cmemmov-windows-x64.exe` is produced via Node SEA (single-executable application) embedding `dist/cmemmov.js` and the SEA blob with package.json metadata

**Given** `dist/cmemmov.js` and a macOS arm64 runner
**When** I run `npm run build:binary`
**Then** `dist/binaries/cmemmov-macos-arm64` is produced
**And** the binary is ad-hoc codesigned via `codesign --sign - --force` (so Gatekeeper doesn't reject first-run on the user's machine after they remove the quarantine attribute)

**Given** the same on a macOS x64 runner
**When** invoked
**Then** `dist/binaries/cmemmov-macos-x64` is produced and ad-hoc codesigned

**Given** a Linux x64 runner
**When** I run `npm run build:binary`
**Then** `dist/binaries/cmemmov-linux-x64` is produced (no signing required)

**Given** any built binary
**When** I run `<binary> --version` on the matching OS without Node.js installed
**Then** the version string is printed (proves the bundle is self-contained)

**Given** any built binary
**When** I run `<binary> --help`
**Then** standard help output is shown — confirming the SEA package boots correctly

**Given** a built binary
**When** I check its size
**Then** it is ≤ ~100MB (Node SEA inflates by the Node runtime; this is the expected ballpark)

**Given** the macOS binaries
**When** verified with `codesign -dv <binary>`
**Then** an ad-hoc signature is reported; the binary is documented as requiring `xattr -d com.apple.quarantine ./cmemmov` on first run for v0.x (proper Apple Developer ID signing tracked as a v1.0 milestone per Architecture Important Gap #2)

**Given** `npm run build:binary` invoked on a non-matching platform (e.g., trying to build win-x64 on Linux)
**When** run
**Then** it exits with a clear error explaining Node SEA does not support cross-compilation; CI handles the multi-platform matrix by building each target on its native runner

**Given** the binary build output
**When** the smoke test step runs in CI
**Then** the binary on the matching runner is invoked with `--version` and `--help`; mismatched or non-zero output fails the build

### Story 5.3: Tag-Triggered Release Pipeline

As a cmemmov maintainer,
I want `git push --tags` after `npm version <patch|minor|major>` to fully automate a release: full CI matrix → `npm publish` → 4 Node SEA binary builds → upload to GitHub Release,
So that releases are friction-free, consistent, and never miss a step (CI gate, binary build, signing, upload).

**Acceptance Criteria:**

**Given** `.github/workflows/release.yml`
**When** a tag matching `v*` is pushed to the repo
**Then** the workflow triggers automatically; manual workflow runs are also supported (`workflow_dispatch`) for testing

**Given** the workflow triggers on a tag
**When** it starts
**Then** the first job is the full CI matrix (lint + typecheck + test on `windows-latest` × `macos-latest` × `ubuntu-latest` × Node 22) — no subsequent step runs until this passes

**Given** CI matrix passes
**When** subsequent jobs run
**Then** they include: (a) `npm publish` from a Linux runner with `--provenance` enabled (or equivalent attestation), (b) parallel binary builds on Windows/macOS/Linux runners producing the four binaries from Story 5.2, (c) all four binaries uploaded as assets attached to the GitHub Release matching the tag

**Given** any step in the release workflow fails
**When** the failure occurs
**Then** the workflow fails with the failed step clearly identified in logs; downstream steps are skipped; the GitHub Release is NOT created if any binary failed to build (avoid partial-asset releases)

**Given** the same tag pushed twice
**When** the workflow triggers a second time
**Then** `npm publish` fails (npm rejects re-publishing the same version); the maintainer must bump the version — workflow is idempotent in that sense

**Given** binaries built in the workflow
**When** the smoke test step runs (per Story 5.2)
**Then** each binary is invoked with `--version` on its native runner; mismatched or non-zero output fails the workflow

**Given** a 0.x release
**When** published to npm
**Then** the package is published with the `next` dist-tag (so users on `npm install -g cmemmov` get only the v1.x stable line once it exists); a 1.x release uses the `latest` dist-tag

**Given** the workflow uses an `NPM_TOKEN` secret
**When** the publish step runs
**Then** the token is provided via the `NODE_AUTH_TOKEN` env var; the token is never echoed, logged, or printed; minimum-scope token (publish-only, no admin) is documented as required

**Given** the release notes for a tag
**When** the workflow runs
**Then** it uses release notes the maintainer wrote manually before tagging (no auto-generated changelog per Architecture); the workflow does NOT overwrite or replace existing release notes

### Story 5.4: Documentation Deliverables

As a Claude Code user evaluating or installing cmemmov,
I want a clear README and supporting docs in `docs/` that explain what cmemmov does, how to install it, how to use each command, the bundle format, and the path-remapping internals — including the macOS Gatekeeper workaround for binary users and the close-Claude-Code-first guidance,
So that I can adopt cmemmov without reverse-engineering its behavior, and so contributors have what they need to extend it.

**Acceptance Criteria:**

**Given** `README.md` at the repo root
**When** I open it
**Then** it includes: (a) a project tagline + 1-paragraph overview of what cmemmov solves, (b) install instructions for `npm install -g cmemmov` and for downloading pre-built binaries from GitHub Releases (covering all four platforms), (c) basic usage examples for all six commands (`export`, `import`, `fix-paths`, `share`, `rollback`, `completion`), (d) the macOS Gatekeeper workaround (`xattr -d com.apple.quarantine ./cmemmov`) clearly called out for binary users, (e) close-Claude-Code-first guidance, (f) a "Known Limitations" section, (g) link to `docs/`, (h) MIT license badge, (i) npm version + CI status badges

**Given** `docs/bundle-format.md`
**When** I open it
**Then** it documents the `.cmemmov` JSON schema authoritatively: top-level fields (`version`, `integrity`, `profile`, `source.platform`, `source.homedir`, `metadata`), per-project entries (`slug`, `originalPath`, `cwd`), category contents, sanitization markers, gzip detection
**And** it stays consistent with `core/bundle-schema.ts` (Zod schema) — divergence is caught by code review and ideally a CI doc-sync check

**Given** `docs/path-remapping.md`
**When** I open it
**Then** it explains the path engine end to end: same-OS resolution, cross-OS conversion via `suggestRemap`, the role of `findMatchingDir`, the lossy-decode caveat, the priority of session `cwd` as authoritative source over slug reversal — with worked examples covering each user journey

**Given** `docs/slug-algorithm.md`
**When** I open it
**Then** it documents Claude Code's slug encoding algorithm (`path.replace(/[:\\/]/g, '-')`), names the lossy case (path contained a `-` in a folder name), and explains cmemmov's fallback strategy (session `cwd` first, slug decode as fallback, user confirmation for ambiguous cases)

**Given** `docs/contributing.md`
**When** I open it
**Then** it covers: dev environment setup (Node v22, `npm install`), the npm scripts (`dev`, `test`, `test:watch`, `lint`, `typecheck`, `build`, `check`), branching strategy, PR conventions, how to run tests on each OS, how to add a new ESLint rule (with reference to the architectural invariants), and the layered dependency rule (`ui → commands → services → core`)

**Given** README's "Known Limitations" section
**When** I read it
**Then** it names three documented limitations, each with explicit user-facing remediation:
**(a) Large session-history bundles** may approach Node memory limits at v1 scale (Architecture Important Gap #1). _Remediation:_ rely on `--exclude-sessions` (the default) for routine migrations; reserve `--include-sessions` for installations under ~500 MB of session data. Streaming JSONL parse is post-v1.
**(b) macOS binaries use ad-hoc signing in v0.x** — Gatekeeper will quarantine on first run (Important Gap #2). _Remediation:_ `xattr -d com.apple.quarantine ./cmemmov` before first run; proper Apple Developer ID signing is a v1.0 milestone.
**(c) Close Claude Code before running cmemmov** — both reads (session JSONL) and writes (any `~/.claude/` file held open) can fail with `EBUSY` / `EPERM` (Important Gap #3). _Remediation:_ quit Claude Code (CLI sessions, IDE extension, and desktop app) before invoking any `cmemmov` command that writes; `claude-reader` (Story 1.7) detects the busy-file case and surfaces this guidance as a structured error with `code: 'INTERNAL'` and `hint: 'close Claude Code and retry'` so the failure mode is obvious at the prompt rather than cryptic.

**Given** the docs reference specific source modules
**When** I open the docs after a refactor that renames a module
**Then** out-of-date references are caught either by a CI doc link-check (if implemented) or by code review; this is best-effort and not a hard NFR

**Given** README install instructions
**When** a user follows them on a fresh Win/Mac/Linux machine
**Then** `cmemmov --help` works after install (verified manually as part of pre-release smoke testing per the test plan)

**Given** the docs/ directory
**When** the npm package is built
**Then** `docs/` is NOT included in the published npm tarball (per `package.json#files` whitelist); docs live in the repo only — keeps the npm package small
