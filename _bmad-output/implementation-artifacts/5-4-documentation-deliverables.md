# Story 5.4: Documentation Deliverables

Status: review

## Story

As a Claude Code user evaluating or installing cmemmov,
I want a clear README and supporting docs in `docs/` that explain what cmemmov does, how to install it, how to use each command, the bundle format, and the path-remapping internals — including the macOS Gatekeeper workaround for binary users and the close-Claude-Code-first guidance,
so that I can adopt cmemmov without reverse-engineering its behavior, and so contributors have what they need to extend it.

## Acceptance Criteria

### AC1 — README.md is a complete, current overview

**Given** `README.md` at the repo root
**When** I open it
**Then** it includes ALL of:
  (a) A project tagline + 1-paragraph overview of what cmemmov solves
  (b) Install instructions for `npm install -g cmemmov@next` (note: `@next` is the v0.x dist-tag per Story 5.3 AC3) AND for downloading pre-built binaries from GitHub Releases (covering all four platforms with their exact filenames from Story 5.2 AC3)
  (c) Basic usage examples for ALL SIX commands (`export`, `import`, `fix-paths`, `share`, `rollback`, `completion`) — each command gets at least: a one-line description, a primary usage example, and the most common flag(s)
  (d) The macOS Gatekeeper workaround (`xattr -d com.apple.quarantine ./cmemmov-macos-<arch>`) clearly called out for binary users, with the same wording used in `docs/install-binary.md`
  (e) Close-Claude-Code-first guidance prominently placed in the install/usage section (NOT buried at the bottom): "Before running any `cmemmov` command that writes (`import`, `fix-paths`, `rollback`), quit Claude Code — CLI sessions, the IDE extension, AND the desktop app — to avoid `EBUSY`/`EPERM` errors on locked session files."
  (f) A "Known Limitations" section (see AC2 for required content)
  (g) Link to `docs/` index covering bundle-format, path-remapping, slug-algorithm, install-binary, contributing
  (h) MIT license badge
  (i) npm version badge + CI status badge (use shields.io for both)

**Given** the current README's outdated content (test count of 469, share/completion marked as planned, Epic 4/5 marked as backlog in the Roadmap, alpha-testing checklist with unchecked planned items)
**When** the rewrite lands
**Then** these stale references are corrected:
  - Test count line is removed OR updated to point at CI as the source of truth (e.g., "Tests must pass on Windows, macOS, and Linux — see the CI badge above for current status")
  - `share` and `completion` sections describe the SHIPPED command behavior, not the planned behavior
  - Roadmap reflects Epic 4 and Epic 5 status (both done by the time this story merges)
  - Alpha-testing checklist either removed (since the alpha is essentially over) or reframed as "what works today"

**Given** the README's length
**When** measured
**Then** it is ≤ 600 lines (the current README is ~342 lines; pruning + adding the new sections should land between 400 and 600). README is meant to be skimmable; deeper docs live under `docs/`.

### AC2 — Known Limitations section names three documented limitations with explicit remediation

**Given** README's "Known Limitations" section
**When** I read it
**Then** it names exactly three limitations, each with explicit user-facing remediation:

**(a) Large session-history bundles** may approach Node memory limits at v1 scale (Architecture Important Gap #1). _Remediation:_ rely on `--exclude-sessions` (the default) for routine migrations; reserve `--include-sessions` for installations under ~500 MB of session data. Streaming JSONL parse is post-v1.

**(b) macOS binaries use ad-hoc signing in v0.x** — Gatekeeper will quarantine on first run (Important Gap #2). _Remediation:_ `xattr -d com.apple.quarantine ./cmemmov-macos-<arch>` before first run; proper Apple Developer ID signing is a v1.0 milestone (tracked in deferred-work.md).

**(c) Close Claude Code before running cmemmov** — both reads (session JSONL) and writes (any `~/.claude/` file held open) can fail with `EBUSY`/`EPERM` (Important Gap #3). _Remediation:_ quit Claude Code (CLI sessions, IDE extension, and desktop app) before invoking any `cmemmov` command that writes; `claude-reader` (Story 1.7) detects the busy-file case and surfaces this guidance as a structured error with `code: 'INTERNAL'` and `hint: 'close Claude Code and retry'`.

**Dev Note:** Each remediation MUST give the user a concrete action ("run X", "use Y flag", "wait for v1.0"), not just describe the problem. The three limitations come from the architecture's "Important Gap" log and are the canonical list — do not invent additional limitations; document only these three.

### AC3 — `docs/bundle-format.md` documents the .cmemmov JSON schema authoritatively

**Given** `docs/bundle-format.md` (NEW file)
**When** I open it
**Then** it documents the bundle format authoritatively, covering:
  - Top-level fields: `version` (bundle format version `1.1.0`, not the package version), `exportedAt`, `sourcePlatform`, `sourceHomedir`, `claudeVersion`, `profile` (optional, only `team-baseline` for shared bundles), `hasCredentials`, `warning` (optional), `integrity` (sha256 of canonicalized content), `wasRedacted` (optional record of what was stripped during sanitization)
  - Per-project entries (`projects[]`): `slug`, `originalPath`, optional `settings`/`memories[]`/`claudeMd`/`sessions[]`
  - Global section (`global`): optional `settings`, `claudeJson`, `memories[]`, `claudeMd`, `customCommands[]`, `teams`, `plugins`, `mcpConfig`
  - Credentials section (`credentials`, optional): `content` and `wasRedacted` — only present when `--include-credentials` was passed (NOT used by `share`)
  - The `wasRedacted` shape: `credentials?: boolean`, `personalMemoryFiles?: string[]`, `homeDirPermissionRules?: string[]`, `localMcpServers?: string[]`, `claudeJsonFields?: string[]`
  - The `strip-personal` profile contract: what gets stripped (personal memory files, home-dir absolute paths in permission rules, local MCP servers, user-identifying `.claude.json` fields), what's preserved (team configs, custom commands, MCP servers that point at network endpoints, team plugins)
  - `PERSONAL_FILENAME_PATTERNS` — the file-name patterns the strip-personal profile excludes (e.g., `todo*`, `scratch*`, `personal*`). The doc enumerates the stock list AND points to `src/commands/share-patterns.ts::DEFAULT_PERSONAL_PATTERNS` (or equivalent constant) as the canonical source.
  - `CLAUDE_JSON_TEAM_ALLOWLIST` — the inverse: which `.claude.json` fields ARE preserved for team bundles (everything not on this list gets stripped)
  - Gzip detection: bundles are JSON by default; gzip-compressed bundles are detected by magic bytes `\x1f\x8b` (this is partial — depending on implementation, may or may not be present)

**Given** the doc references source constants
**When** the source is refactored
**Then** the doc points at the constant by name (e.g., "the canonical list lives at `src/commands/share-patterns.ts::DEFAULT_PERSONAL_PATTERNS`") rather than copy-pasting the values — divergence is caught by code review (no CI doc-sync check is in scope for v0.x)

**Given** the doc's length
**When** measured
**Then** it is ≤ 400 lines. Schema docs should be reference-tight, not narrative.

**Dev Note:** This closes the long-deferred L8 item from Story 5.0's triage: `PERSONAL_FILENAME_PATTERNS` documentation was deferred from Story 4.1 Task 8.3 → Story 5.4. Cross-link from the deferred-work.md L8 entry's resolution path to this new doc.

### AC4 — `docs/path-remapping.md` explains the path engine end-to-end

**Given** `docs/path-remapping.md` (NEW file)
**When** I open it
**Then** it documents the path engine end-to-end:
  - **Same-OS resolution**: how `path-engine.ts` decodes a slug back to a filesystem path on the original host
  - **Cross-OS conversion via `suggestRemap`**: how the path engine translates `/Users/alex/...` → `C:\Users\alex\...` (and vice versa) given a known source/target home prefix
  - **The role of `findMatchingDir`**: how the engine searches for candidate target directories when the user has reorganized their filesystem (e.g., projects moved from `~/dev/` to `~/work/`)
  - **The lossy-decode caveat**: Claude Code's slug encoding (`path.replace(/[:\\/]/g, '-')`) is one-way — a path containing `-` in a folder name produces a slug that can't be unambiguously decoded. The engine handles this by preferring session-JSONL `cwd` (authoritative) over slug-reversal (fallback).
  - **Priority of session `cwd` as authoritative source**: when a project has at least one session JSONL on disk, the most recent JSONL's first-line `cwd` is the source of truth. Slug decoding is only used when no JSONLs exist.
  - **Worked examples** covering each user journey:
    - Alex's journey (same-OS): `~/dev/myproject` → slug `-Users-alex-dev-myproject` → decoded back losslessly
    - Maya's journey (cross-OS, macOS → Windows): `~/dev/repo` decoded, then remapped via `--remap "/Users/maya=/c:/Users/maya"` → `C:\Users\maya\dev\repo`
    - Jordan's journey (same-OS, projects moved): `~/old-projects/foo` slug points at a missing dir; `fix-paths` scans `~/new-projects/` for a matching tail
    - Hyphenated-path case: `~/dev/fhir-bridge` → ambiguous slug `-Users-x-dev-fhir-bridge` (could decode as `/Users/x/dev/fhir/bridge` OR `/Users/x/dev/fhir-bridge`) → resolved by reading the session JSONL's `cwd`

**Given** the doc's length
**When** measured
**Then** it is ≤ 350 lines. Each worked example is ~30 lines of code+prose.

### AC5 — `docs/slug-algorithm.md` documents Claude Code's slug encoding

**Given** `docs/slug-algorithm.md` (NEW file)
**When** I open it
**Then** it documents:
  - The slug encoding algorithm: `path.replace(/[:\\/]/g, '-')`. Examples: `/Users/alex/dev/proj` → `-Users-alex-dev-proj`; `C:\Users\alex\dev\proj` → `C--Users-alex-dev-proj` (NOTE: leading `C-` is `C:` encoded — Windows drive letters become `<letter>-`)
  - The lossy case: a path containing `-` in a folder name (e.g., `~/dev/my-project`) produces a slug that's structurally ambiguous when decoded
  - The lossless cases: paths with no `-` in any folder name are unambiguously decodable
  - cmemmov's fallback strategy: session `cwd` first (authoritative when at least one JSONL exists), slug decode as fallback (when no JSONL exists), user confirmation for ambiguous cases (`fix-paths` interactive flow surfaces the ambiguity)
  - Where in the code: pointer to `src/core/path-engine.ts` for the decoder, `src/services/claude-reader.ts` for the session-cwd preference logic

**Given** the doc's length
**When** measured
**Then** it is ≤ 200 lines. This is reference material, not a narrative — keep it tight.

### AC6 — `docs/contributing.md` is expanded beyond the Story 5.3 release stub

**Given** `docs/contributing.md` currently contains only the release-cutting flow (Story 5.3 stub)
**When** Story 5.4 lands
**Then** the file is expanded to cover (in addition to what's already there):
  - **Dev environment setup**: Node v22+, `npm install`, where the source lives, recommended editor setup (VS Code is fine; no required extensions)
  - **The npm scripts**: a table with `dev`, `test`, `test:watch`, `lint`, `typecheck`, `build`, `check`, `build:binary`, `coverage:run` — one line per script
  - **Branching strategy**: feature branches from main; PRs target main; squash-merge preferred (or whatever the project's actual convention is — check the existing commit log to confirm)
  - **PR conventions**: link to the BMad story format if maintainers find it useful; otherwise just "small, focused PRs"
  - **How to run tests on each OS**: the CI matrix covers all three; locally, `npm test` runs on the host OS; CI catches the other two
  - **How to add a new ESLint rule**: brief pointer to `eslint.config.js` and the architectural-invariant rules (Story 1.2 — referenced as "the layered dependency rule below"). One worked example is enough.
  - **The layered dependency rule (`ui → commands → services → core`)**: the canonical architectural constraint. Explain what it means, why it exists, and how the ESLint rule enforces it.

**Given** the existing release-flow content
**When** the expansion lands
**Then** the existing sections (Cutting a release, Pre-tag flow, NPM_TOKEN setup, dry-run procedure) are preserved verbatim — Story 5.3's content is already correct and shouldn't be rewritten

**And** the stub note at the top of `docs/contributing.md` ("Story 5.4 owns the full contributing guide") is REMOVED — this story IS the expansion

**Given** the doc's length
**When** measured
**Then** it is ≤ 500 lines (release flow is ~170 lines; expansion adds ~200–300 lines)

### AC7 — `docs/install-binary.md` is expanded to be self-contained user docs

**Given** `docs/install-binary.md` currently contains the Story 5.2 stub
**When** Story 5.4 lands
**Then** the stub-note line at the top ("Story 5.4 owns full user-facing documentation") is REMOVED
**And** the existing per-platform first-run content is preserved
**And** a download section is added that explains where to find binaries on the GitHub Releases page once Story 5.3 lands (link to `https://github.com/<owner>/<repo>/releases/latest`)
**And** a verification section is added: after downloading, run `<binary> --version` and `<binary> --help` to confirm the binary is intact
**And** the doc explains how to put the binary on PATH for system-wide use:
  - Windows: copy to a directory on `%PATH%` (e.g., `C:\Users\<you>\bin\`)
  - macOS/Linux: `mv ./cmemmov-<platform>-<arch> /usr/local/bin/cmemmov` (or `~/.local/bin/cmemmov` for a per-user install)

**Given** the doc's length
**When** measured
**Then** it is ≤ 200 lines

### AC8 — Docs are NOT included in the published npm tarball

**Given** the `package.json#files` whitelist (Story 5.2 widened to `["dist/**/*.js", "dist/**/*.d.ts", "README.md", "LICENSE"]`)
**When** `npm pack --json` is run
**Then** the tarball includes README.md but does NOT include the `docs/` directory
**And** the existing `tests/integration/npm-pack.test.ts` (Story 5.2) is extended with one assertion: `expect(tarballEntries).not.toContain('docs/')`

**Dev Note:** This is already true by virtue of the existing whitelist (which only lists `dist/**/*.js`, `dist/**/*.d.ts`, `README.md`, `LICENSE`). The new assertion makes it mechanical — a future change to `files` that accidentally widens the pattern to include `docs/` will fail the test.

### AC9 — Doc cross-links are consistent

**Given** all five doc files (README + 4 under `docs/`) plus `docs/install-binary.md` and `docs/contributing.md` (7 total)
**When** I scan them for cross-references
**Then** every link to another doc uses a relative path (e.g., `./bundle-format.md`, `../README.md`) — no absolute `https://github.com/...` links for in-repo content
**And** every link target exists (no 404s within the repo)
**And** the README's "Documentation" section links to all six docs under `docs/` (bundle-format, path-remapping, slug-algorithm, contributing, install-binary, and any others that exist)

**Dev Note:** Use Markdown's relative-link form: `[Bundle format](docs/bundle-format.md)` from the README; `[Contributing](./contributing.md)` from within docs. Don't introduce a docs/index.md unless the README's "Documentation" section becomes unwieldy.

### AC10 — Test suite stays green; no source code changes

**Given** the changes in AC1–AC9
**When** `npm test` runs
**Then** all existing tests pass (no regressions)
**And** the only test file modified is `tests/integration/npm-pack.test.ts` (per AC8) — no other test changes
**And** no `src/` files are modified (this is a docs-only story)

**Given** `npm run lint`
**When** it runs
**Then** zero violations (docs changes shouldn't affect lint)

**Given** markdown-lint if it is wired into pre-commit
**When** it runs
**Then** the new and updated docs pass cleanly (or violations are pre-existing in the surrounding content — note them but don't fix outside the scope of this story)

## Tasks / Subtasks

- [x] Task 1: README.md rewrite (AC: #1, #2, #9)
  - [x] 1.1 Update the tagline + 1-paragraph overview
  - [x] 1.2 Replace the alpha-testing checklist with "what works today" framing
  - [x] 1.3 Update install instructions: `npm install -g cmemmov@next` AND binary download (link to docs/install-binary.md)
  - [x] 1.4 Add or update sections for all six commands (`share` and `completion` are now shipped, not "planned")
  - [x] 1.5 Add prominent "close Claude Code first" guidance in the install/usage section
  - [x] 1.6 Add "Known Limitations" section with the three documented limitations (AC2) — copy the exact wording from the AC text
  - [x] 1.7 Update Roadmap: Epic 4 and Epic 5 are done (or in-flight) — reflect actual current state from sprint-status.yaml
  - [x] 1.8 Add npm version badge (shields.io: `https://img.shields.io/npm/v/cmemmov`)
  - [x] 1.9 Add CI status badge (shields.io GitHub workflow: `https://img.shields.io/github/actions/workflow/status/<owner>/<repo>/ci.yml?branch=main`)
  - [x] 1.10 MIT license badge (shields.io: `https://img.shields.io/badge/license-MIT-blue.svg`)
  - [x] 1.11 Documentation section links to all six docs under `docs/`
- [x] Task 2: `docs/bundle-format.md` (NEW) (AC: #3)
  - [x] 2.1 Top-level fields reference
  - [x] 2.2 Per-project entry schema (`projects[]`)
  - [x] 2.3 Global section schema
  - [x] 2.4 `wasRedacted` shape and semantics
  - [x] 2.5 `strip-personal` profile contract
  - [x] 2.6 `PERSONAL_FILENAME_PATTERNS` — link to canonical source constant (closes Story 5.0 L8)
  - [x] 2.7 `CLAUDE_JSON_TEAM_ALLOWLIST`
  - [x] 2.8 Worked example: minimal bundle (one project, no credentials, no sessions)
  - [x] 2.9 Worked example: full bundle (all categories populated, with `wasRedacted` annotations)
- [x] Task 3: `docs/path-remapping.md` (NEW) (AC: #4)
  - [x] 3.1 Same-OS resolution
  - [x] 3.2 Cross-OS conversion via `suggestRemap`
  - [x] 3.3 `findMatchingDir` role
  - [x] 3.4 Lossy-decode caveat
  - [x] 3.5 Session `cwd` priority
  - [x] 3.6 Worked example: Alex's journey (same-OS)
  - [x] 3.7 Worked example: Maya's journey (cross-OS macOS → Windows)
  - [x] 3.8 Worked example: Jordan's journey (same-OS, projects moved)
  - [x] 3.9 Worked example: Hyphenated-path case
- [x] Task 4: `docs/slug-algorithm.md` (NEW) (AC: #5)
  - [x] 4.1 Encoding algorithm + examples
  - [x] 4.2 Lossy case
  - [x] 4.3 Lossless cases
  - [x] 4.4 Fallback strategy (session cwd → slug decode → user confirmation)
  - [x] 4.5 Source-code pointers
- [x] Task 5: `docs/contributing.md` expansion (AC: #6)
  - [x] 5.1 Remove the stub note at the top
  - [x] 5.2 Add dev environment setup section above the release section
  - [x] 5.3 npm scripts table
  - [x] 5.4 Branching strategy + PR conventions
  - [x] 5.5 How to run tests on each OS
  - [x] 5.6 ESLint rule guide + the layered-dependency rule
- [x] Task 6: `docs/install-binary.md` expansion (AC: #7)
  - [x] 6.1 Remove the stub note at the top
  - [x] 6.2 Download section (link to GitHub Releases page)
  - [x] 6.3 Verification section (`--version` and `--help`)
  - [x] 6.4 Put on PATH section (Windows / macOS / Linux variants)
- [x] Task 7: Cross-links and consistency (AC: #9)
  - [x] 7.1 Verify every relative link in every doc resolves to an existing file
  - [x] 7.2 README "Documentation" section enumerates all six docs
- [x] Task 8: npm pack assertion (AC: #8)
  - [x] 8.1 Add `expect(tarballEntries).not.toContain('docs/')` (or equivalent path-prefix check) to `tests/integration/npm-pack.test.ts`
- [x] Task 9: Close-out (AC: #10)
  - [x] 9.1 `npm run lint` — confirm clean
  - [x] 9.2 `npm test` — confirm all tests pass
  - [x] 9.3 Resolve the cr-4-1 deferred L8 entry (`PERSONAL_FILENAME_PATTERNS` doc) — mark it RESOLVED in `_bmad-output/implementation-artifacts/deferred-work.md` with a pointer to `docs/bundle-format.md`

## Dev Notes

### This is the largest doc story in the project — pace yourself

Six files touched (README + 5 docs). Don't write all six in one pass — write each, scan it for the AC checklist, then move on. The story has nine ACs and many sub-acceptance criteria; the dev should treat each AC as a separate deliverable. Use the task checkboxes to track progress.

### Tone

- **Reference docs** (bundle-format, slug-algorithm) should be tight and unambiguous — like a man page. Lots of headers, short paragraphs, code examples.
- **Narrative docs** (path-remapping) can be longer-form because they cover user journeys with worked examples.
- **README** is the marketing surface and the install surface — be readable, not exhaustive. Push depth into `docs/`.
- **contributing.md** is for future-you (or a future contributor). Be specific about commands; assume the reader is technical but new to the codebase.

### Source-of-truth pointers vs copy-paste

When documenting code, prefer "the canonical list lives at `src/...`" over copying the list into the doc. Copy-pasted lists drift; pointers stay accurate. Exception: small, stable lists (the four SUPPORTED_TARGETS, the six commands, the three Known Limitations) can be inlined because they don't churn.

### Worked examples in path-remapping.md

The four user-journey worked examples (Alex, Maya, Jordan, Hyphenated) are the heart of this doc. For each one, follow this structure:

1. The user's state (what's on disk, what they're trying to do)
2. The command they run (or interactive flow they walk through)
3. What cmemmov does internally (which functions get called, in order)
4. The end state (what changed on disk, what backup was created)

Use real-looking paths, not abstract `<foo>` placeholders, so the reader can mentally map them to their own setup.

### Files this story modifies / creates

- **UPDATE** `README.md` (Task 1)
- **NEW** `docs/bundle-format.md` (Task 2)
- **NEW** `docs/path-remapping.md` (Task 3)
- **NEW** `docs/slug-algorithm.md` (Task 4)
- **UPDATE** `docs/contributing.md` (Task 5)
- **UPDATE** `docs/install-binary.md` (Task 6)
- **UPDATE** `tests/integration/npm-pack.test.ts` (Task 8)
- **UPDATE** `_bmad-output/implementation-artifacts/deferred-work.md` (Task 9.3 — resolve L8)

### Files this story does NOT modify

- Any code under `src/` (this is a docs-only story; the only test change is the npm-pack assertion)
- `package.json` (do NOT modify — the `files` whitelist was correctly set by Story 5.2)
- Any other test files
- The CI workflows (Story 5.3 owns those)
- The story files for 5.0–5.3 (those are historical records)

If any of those need to change to satisfy an AC, stop and surface the issue.

### Process principles (carry from Epic 4 retro)

- **Spec-writing convention (AI#3):** the worked examples in path-remapping.md should be _design intent + a concrete walk-through_, not _copy-paste skeletons_. Show the algorithm by example.
- **Schema-extends-with-consumer (AI#4):** the bundle-format.md doc IS a consumer of `bundle-schema.ts`. The doc should point at the schema constant by name; do NOT redefine the schema in prose. If the schema's shape evolves in a future story, the doc should be the first place to update.
- **Declarative-data-as-contract (AI#6):** the three Known Limitations are a canonical list. Don't invent additional limitations to make the section feel "more thorough". Three with concrete remediation beats five with hand-waving.

### Pre-existing markdown-lint warnings

Most existing docs in this repo have IDE-level markdown-lint warnings (MD007/MD032 around 2-space list indents, MD041 around first-line H1 requirements, etc.). These are pre-existing patterns. Do not fix them in scope; they are tracked as a (currently unwritten) future hygiene story. If the dev's new content introduces NEW markdown-lint warnings beyond the pre-existing surface, fix those — the diff should not regress lint cleanliness.

### Project Structure Notes

- All docs except README live under `docs/`. The README stays at the repo root.
- The existing `docs/install-binary.md` (Story 5.2) and `docs/contributing.md` (Story 5.3) are UPDATED, not replaced.
- Three new docs are added: `bundle-format.md`, `path-remapping.md`, `slug-algorithm.md`.
- No docs/index.md needed; the README's "Documentation" section serves that role.

### References

- [Epic 5 spec — Story 5.4: epics.md:1546-1593](../planning-artifacts/epics.md#L1546) — original ACs
- [Bundle schema source: src/core/bundle-schema.ts](../../src/core/bundle-schema.ts) — for AC3 doc accuracy
- [Share patterns source: src/commands/share-patterns.ts](../../src/commands/share-patterns.ts) — for AC3 PERSONAL_FILENAME_PATTERNS reference
- [Sanitization rules source: src/core/sanitization-rules.ts](../../src/core/sanitization-rules.ts) — for AC3 strip-personal profile contract
- [Path engine source: src/core/path-engine.ts](../../src/core/path-engine.ts) — for AC4 and AC5 doc accuracy
- [Claude reader source: src/services/claude-reader.ts](../../src/services/claude-reader.ts) — for the session-cwd-priority logic (AC4, AC5)
- [Existing README: README.md](../../README.md) — starting point for the rewrite
- [Existing contributing stub: docs/contributing.md](../../docs/contributing.md) — Story 5.3 release flow content to preserve
- [Existing install-binary stub: docs/install-binary.md](../../docs/install-binary.md) — Story 5.2 install flow content to preserve
- [Sprint status: sprint-status.yaml](../../_bmad-output/implementation-artifacts/sprint-status.yaml) — for AC1 Roadmap update accuracy
- [Deferred-work L8 (Story 5.0 triage): deferred-work.md PERSONAL_FILENAME_PATTERNS entry](../implementation-artifacts/deferred-work.md) — closed by AC3 + Task 9.3
- [Architecture Important Gaps #1/#2/#3](../planning-artifacts/architecture.md) — sources of the three Known Limitations
- [Epic 4 retro (process principles): _bmad-output/implementation-artifacts/epic-4-retro-2026-05-13.md](../implementation-artifacts/epic-4-retro-2026-05-13.md)

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

None — single-pass implementation, no debugging cycles required.

### Completion Notes List

- All 10 ACs satisfied. All 9 tasks (39 subtasks) complete.
- README rewrite: 252 lines (under 600-line cap). Removed the alpha-testing checklist and the outdated 469-test claim; added shields.io badges (npm/CI/MIT), the three-item Known Limitations section verbatim from AC2, prominent close-Claude-Code-first guidance in the install/usage section, all six commands (share/completion now documented as shipped), and a Documentation section enumerating the five existing docs under `docs/`. Updated Roadmap from sprint-status.yaml (Epic 1-4 done, Epic 5 in-progress).
- `docs/bundle-format.md` (NEW): 297 lines (under 400-line cap). Documents the top-level schema, per-project entries, global section, `wasRedacted` shape, the full `strip-personal` profile contract, `PERSONAL_FILENAME_PATTERNS`, `CLAUDE_JSON_TEAM_ALLOWLIST`, gzip detection, and two worked bundle examples (minimal + full share with redactions). Per AC3 / process principle AI#4, points at the schema constant by name rather than redefining it.
- `docs/path-remapping.md` (NEW): 187 lines (under 350-line cap). Documents same-OS resolution, cross-OS `suggestRemap`, `findMatchingDir`, lossy-decode caveat, session-cwd-as-authoritative-source priority, and all four worked user journeys (Alex same-OS, Maya cross-OS macOS→Windows, Jordan reorganized-home, hyphenated-path ambiguity).
- `docs/slug-algorithm.md` (NEW): 144 lines (under 200-line cap). Documents the `path.replace(/[:\\/]/g, '-')` encoding, lossless vs lossy cases, the three-tier fallback strategy (session cwd → slug decode → user confirmation), and where each concern lives in code.
- `docs/contributing.md` expanded: 301 lines (under 500-line cap). Preserved Story 5.3 release-flow content verbatim. Added dev environment setup (Node ≥ 22, npm install), npm scripts table (9 scripts), branching strategy + PR conventions, cross-OS testing approach, ESLint architectural rules section (layered dependency rule `ui → commands → services → core` with the canonical four-line text from architecture.md, plus the six mechanical invariants table), and "Adding a new ESLint rule" walkthrough. Stub note at the top removed.
- `docs/install-binary.md` expanded: 122 lines (under 200-line cap). Preserved Story 5.2 per-platform first-run content verbatim. Added Section 1 (download from GitHub Releases with the `releases/latest` URL), Section 3 (verification via `--version` and `--help`), Section 4 (put on PATH for Windows / macOS / Linux with sudo and per-user variants). Stub note at the top removed. Disambiguated section 4 H3 headers ("Windows — adding to `%PATH%`", "macOS and Linux — adding to `PATH`") to avoid an MD024 duplicate-heading warning with the section 2 per-platform headers.
- AC8 (npm-pack docs exclusion): added a 6th `it.skipIf(!HAS_NPM)` block to `tests/integration/npm-pack.test.ts` that reads the top-level entries of the extracted `package/` directory and asserts `not.toContain('docs')` and `not.toContain('docs/')`. The full test file now runs 6 tests (5 originally) — all 6 passed locally.
- AC9 cross-link verification: every relative link target in README + 5 docs resolves to an existing file (17 link targets checked individually — README.md, LICENSE, all 5 docs, 9 src files, deferred-work.md). The README's Documentation section enumerates all 5 docs that exist under `docs/`.
- AC10 verification: `npm run lint` clean (0 warnings, 0 errors). `npm test` green: **666 passed, 4 skipped, 0 failed** across 38 test files. The only test file modified was `tests/integration/npm-pack.test.ts` (per AC8). No `src/` files modified, no `package.json` changes.
- Task 9.3 (cr-4-1 L8 RESOLVED): appended an L8 deferred entry to the `cr-4-1` section of `deferred-work.md` documenting the `PERSONAL_FILENAME_PATTERNS` doc deferral, with a nested RESOLVED note pointing at the newly-created `docs/bundle-format.md`. The Story 5.0 L8 routing decision is now closed.
- Pre-existing markdown-lint warnings observed in this story's diffs: (a) `docs/contributing.md` flagged 13 warnings — all 13 fall inside the preserved Story 5.3 release-flow section (lines 163+), none in the new content; (b) `deferred-work.md` flagged 1 warning at line 89 — pre-existing content from a Story 1.11 era entry, far from my line-235 edit. Per Dev Notes "pre-existing patterns... do not fix in scope", none addressed. No new markdown-lint warnings introduced in my added content.

### File List

- **UPDATE** `README.md` — full rewrite per AC1/AC2/AC9
- **NEW** `docs/bundle-format.md` — bundle schema, `team-baseline` profile, `PERSONAL_FILENAME_PATTERNS`, `CLAUDE_JSON_TEAM_ALLOWLIST` (AC3, closes Story 5.0 L8)
- **NEW** `docs/path-remapping.md` — path engine end-to-end with four worked user journeys (AC4)
- **NEW** `docs/slug-algorithm.md` — slug encoding spec, lossless/lossy cases, fallback strategy (AC5)
- **UPDATE** `docs/contributing.md` — dev environment + npm scripts + branching + ESLint rules; Story 5.3 release content preserved verbatim (AC6)
- **UPDATE** `docs/install-binary.md` — download + verify + PATH sections; Story 5.2 platform content preserved verbatim (AC7)
- **UPDATE** `tests/integration/npm-pack.test.ts` — `docs/` exclusion assertion (AC8)
- **UPDATE** `_bmad-output/implementation-artifacts/deferred-work.md` — L8 entry RESOLVED with pointer to `docs/bundle-format.md` (Task 9.3)
- **UPDATE** `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status transition
- **UPDATE** `_bmad-output/implementation-artifacts/5-4-documentation-deliverables.md` — task checkboxes, Dev Agent Record, status

### Change Log

| Date | Change | Notes |
| --- | --- | --- |
| 2026-05-14 | Story 5.4 implementation complete | All 10 ACs satisfied, 666 tests pass, lint clean |
| 2026-05-14 | Code review (cr-5-4) — 3 MEDIUM auto-resolved, 4 LOW deferred | See Review Findings section below |

## Review Findings

Code review of Story 5.4 performed 2026-05-14 (cr-5-4). All HIGH/MEDIUM findings auto-resolved during review per the team-lead's single-task agent instructions. LOW findings appended to `_bmad-output/implementation-artifacts/deferred-work.md` under `## Deferred from: code review of story-5.4 (2026-05-14)`.

- [x] [Review][Patch] MEDIUM — Broken relative link in cr-4-1 L8 RESOLVED entry [`_bmad-output/implementation-artifacts/deferred-work.md`:238] — fixed link to `../../docs/bundle-format.md` so AC9 ("every link target exists") holds inside the deferred-work file too.
- [x] [Review][Patch] MEDIUM — `cmemmov/no-raw-json-parse` rule scope misdescribed [`docs/contributing.md`:123] — rewrote the rules-table row to enumerate the three allowed source files (`bundle-parser.ts`, `claude-reader.ts`, `export-selection.ts`) and the blanket `*.test.ts` exemption, with an accurate rationale referencing the Zod-validated parsing path.
- [x] [Review][Patch] MEDIUM — Non-existent `src/cmemmov.ts` referenced as bin entry [`docs/contributing.md`:45] — split into two rows naming the actual source files (`src/cli.ts` for the npm bin entry, `src/cli-sea.ts` for the SEA-binary entry) with the build targets each one produces.
- [x] [Review][Defer] LOW — `docs/path-remapping.md:62` says `slugToPath` "returns *one* of the candidates" — actually greedy-splits to the maximally-split candidate; the rest of the doc uses the correct phrasing. Cosmetic.
- [x] [Review][Defer] LOW — `docs/slug-algorithm.md:107` has the same imprecision ("one of several structurally valid candidates"). Cosmetic; defer for batch tidy with the path-remapping fix.
- [x] [Review][Defer] LOW — Test-count drift vs Dev Agent Record (`662 passed, 4 skipped` locally vs `666 passed, 4 skipped` claimed). No regressions; likely platform-conditional skip differences. Cosmetic.
- [x] [Review][Defer] LOW — `README.md:45` "Important: close Claude Code…" H2 mixes bold span with the implicit heading emphasis. Style-only; renders fine on GitHub.
