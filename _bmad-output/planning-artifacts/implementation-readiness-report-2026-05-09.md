---
project: ClaudeMemoryMover
date: 2026-05-09
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
status: complete
filesAssessed:
  prd: _bmad-output/planning-artifacts/prd.md
  architecture: _bmad-output/planning-artifacts/architecture.md
  epics: _bmad-output/planning-artifacts/epics.md
  ux: null
  stories: null
supportingDocs:
  - _bmad-output/planning-artifacts/product-brief-ClaudeMemoryMover.md
  - _bmad-output/planning-artifacts/product-brief-ClaudeMemoryMover-distillate.md
  - _bmad-output/planning-artifacts/research/technical-claude-code-migration-research-2026-05-08.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-05-09
**Project:** ClaudeMemoryMover

## Step 1: Document Discovery

### Inventory

| Artifact | Path | Size | Last Modified |
| --- | --- | --- | --- |
| PRD | `_bmad-output/planning-artifacts/prd.md` | 30.5 KB | 2026-05-08 |
| Architecture | `_bmad-output/planning-artifacts/architecture.md` | 49.1 KB | 2026-05-08 |
| Epics & Stories | `_bmad-output/planning-artifacts/epics.md` | 96.4 KB | 2026-05-09 |
| UX Design | _not found_ | — | — |
| Story Files | _none found_ | — | — |
| Product Brief | `_bmad-output/planning-artifacts/product-brief-ClaudeMemoryMover.md` | 9.7 KB | 2026-05-08 |
| Brief Distillate | `_bmad-output/planning-artifacts/product-brief-ClaudeMemoryMover-distillate.md` | 13 KB | 2026-05-08 |
| Tech Research | `_bmad-output/planning-artifacts/research/technical-claude-code-migration-research-2026-05-08.md` | 22.3 KB | 2026-05-08 |

### Issues / Open Items

- No duplicate (whole vs. sharded) format conflicts.
- UX design artifact not present — pending confirmation that UX is N/A for this CLI tool.
- No per-story files (`stories/*.md`) — pending confirmation that stories are consolidated within `epics.md`.

## Step 2: PRD Analysis

### Functional Requirements (Total: 36)

**Export (FR1–FR7):**

- **FR1:** Interactive selection of artifact categories (global memories, project memories, global settings, project settings, CLAUDE.md, MCP config, custom commands, teams, plugins, session history).
- **FR2:** Interactive selection of individual projects, independent of category selection.
- **FR3:** Bulk "all projects + all categories" export without per-item selection.
- **FR4:** Session history excluded by default; explicit opt-in.
- **FR5:** Credentials excluded by default; explicit opt-in with security acknowledgment.
- **FR6:** Single portable `.cmemmov` JSON bundle file produced as the artifact.
- **FR7:** User-specified output file path and name.

**Import & Path Remapping (FR8–FR16):**

- **FR8:** Import a `.cmemmov` bundle on any supported target machine.
- **FR9:** Auto-detect cross-OS source/target mismatch and initiate guided remap.
- **FR10:** Per-project review/confirm/override of path remap suggestions.
- **FR11:** Auto-suggest target paths via name-based directory search on current machine.
- **FR12:** Skip individual projects; surfaced in post-import summary with re-association guidance.
- **FR13:** Per-category merge-vs-overwrite choice.
- **FR14:** `--dry-run` preview of all changes without writing.
- **FR15:** Remap absolute paths in `settings.json` permission rules during import.
- **FR16:** Remap absolute paths in `.claude.json` global state fields during import.

**Backup & Rollback (FR17–FR19):**

- **FR17:** Auto-create timestamped backup of target `~/.claude/` before any import write.
- **FR18:** Report backup location to user before import begins.
- **FR19:** Single-command restore of most recent pre-import backup.

**Path Repair (FR20–FR23):**

- **FR20:** Re-associate existing project slugs with new repo locations without full export/import.
- **FR21:** Scan `~/.claude/projects/`, display each slug with decoded original path, indicate disk existence.
- **FR22:** Auto-suggest new paths for missing projects via name-based directory search.
- **FR23:** Per-suggestion confirm/override/skip during path repair; backup before any rename.

**Team Sharing (FR24–FR26):**

- **FR24:** Produce sanitized team bundle that strips personal data (credentials, personal memories, machine-specific paths, user-identifying fields).
- **FR25:** Sanitized bundle retains team artifacts (CLAUDE.md, MCP server defs, custom commands, shared permission patterns).
- **FR26:** Import a team bundle to bootstrap a consistent baseline on a new machine.

**Bundle Format & Compatibility (FR27–FR30):**

- **FR27:** Export bundle records original absolute path for every included project, independent of slug.
- **FR28:** Export bundle includes a Claude Code version fingerprint derived from installed Claude Code.
- **FR29:** Import warns on significant version mismatch; never blocks.
- **FR30:** Bundle is human-readable JSON, inspectable/editable in any text editor.

**CLI Interface & Scripting (FR31–FR36):**

- **FR31:** Non-interactive (`--silent`) execution for any command via CLI flags only.
- **FR32:** `--json` machine-parseable result emitted to stdout on completion.
- **FR33:** Errors to stderr with file path, attempted operation, and suggested fix.
- **FR34:** Standardized exit codes — `0` success, `1` partial success (items skipped), `2` fatal error (nothing written).
- **FR35:** `cmemmov completion` generates shell completion for bash, zsh, fish, PowerShell.
- **FR36:** Incremental progress emitted to stderr during long-running operations.

### Non-Functional Requirements (Total: 19)

**Performance (NFR1–NFR4):**

- **NFR1:** First output within 500 ms on any supported platform.
- **NFR2:** Typical export/import (â‰¤20 projects, no session history) completes within 10 s.
- **NFR3:** Export/import including session history completes within 60 s for â‰¤500 MB session data.
- **NFR4:** `--dry-run` runs in the same time as the equivalent live operation.

**Security (NFR5–NFR9):**

- **NFR5:** `.credentials.json` never written to bundle unless `--include-credentials` is passed — enforced in code.
- **NFR6:** `share` command never includes credentials under any circumstance.
- **NFR7:** Zero network calls at runtime (no telemetry/version-check/analytics) unless explicit opt-in command.
- **NFR8:** Bundle contains nothing beyond what the user explicitly selected.
- **NFR9:** `--include-credentials` prints a warning and embeds a warning field in the bundle.

**Reliability (NFR10–NFR14):**

- **NFR10:** Fatal error during import leaves target `~/.claude/` in pre-import state — no partial-write inconsistency.
- **NFR11:** Auto-backup is a complete restorable copy, not a partial/incremental snapshot.
- **NFR12:** `--dry-run` is byte-for-byte lossless on the filesystem.
- **NFR13:** Atomic write patterns (write to temp + rename) where filesystem allows.
- **NFR14:** Any unhandled error produces non-zero exit code and human-readable stderr message — no silent failures.

**Compatibility (NFR15–NFR19):**

- **NFR15:** Runs on Node.js v22 LTS and above (v18 EOL April 2025).
- **NFR16:** Explicitly tested on Windows 11, macOS 14 (Sonoma), and Ubuntu 22.04 LTS — CI must cover all three.
- **NFR17:** Pre-built binaries published for Windows x64, macOS arm64, macOS x64, Linux x64 at every release.
- **NFR18:** Path handling uses Node.js `path` and `os` built-ins exclusively — no hardcoded separators.
- **NFR19:** Respects `CLAUDE_CONFIG_DIR` environment variable, matching Claude Code's own resolution behavior.

### Additional Requirements & Constraints

**Domain Constraints (from "Domain-Specific Requirements"):**

- **DC1 (Cross-platform correctness):** All path operations use `os.homedir()` and Node.js `path` APIs — silent slug/path miscoding orphans memories and is worse than an explicit error.
- **DC2 (Data integrity — atomic writes):** Reinforces NFR13; no in-place modification.
- **DC3 (Data integrity — partial-write recovery):** Reinforces NFR10; pre-import backup must remain intact and restorable on failure.
- **DC4 (Data integrity — `--dry-run` purity):** Reinforces NFR12.
- **DC5 (npm package security — no `postinstall`/lifecycle scripts):** No arbitrary-code lifecycle scripts in published package.
- **DC6 (npm package security — minimal deps):** Prefer Node.js built-ins; minimize production dependency footprint.
- **DC7 (npm package security — pinned deps):** All production dependencies pinned to exact versions in `package-lock.json`.
- **DC8 (npm package security — no runtime network):** Reinforces NFR7.

**CLI / UX Implementation Constraints:**

- **CC1:** Purely flag-driven — no persistent config file. (Explicit anti-requirement.)
- **CC2:** `--silent` is all-or-nothing per invocation; missing required decision in silent mode â†’ exit `2` with `--json` error naming the missing flag.
- **CC3:** In `--json` mode, progress writes to stderr as unstructured lines; the final JSON object goes to stdout.
- **CC4:** Global flags on all commands: `--silent`, `--json`, `--dry-run` (where applicable), `--help`.
- **CC5:** Path resolution reads `cwd` from session JSONL as authoritative; slug character reversal is never used as the source of truth (memory-only projects fall back to user confirmation of decoded slug).

**Distribution / Release Constraints:**

- **DR1:** Package published as `cmemmov` on npm and globally installable on day one of release.
- **DR2:** Pre-built binaries for Windows x64, macOS arm64/x64, Linux x64 at v1.0 (reinforces NFR17).
- **DR3:** Feature-complete v1 — release criterion is correctness/completeness, not a calendar date.

### PRD Completeness Assessment

- **Strengths:** Requirements are uniformly numbered and self-contained, NFRs are testable (concrete thresholds and platform lists), four end-to-end user journeys explicitly enumerate the capabilities they exercise, and edge cases (memory-only projects, version mismatch, drive-letter remap, network paths) are addressed in-line.
- **Watch-items for traceability validation:**
  - Several **domain constraints** (DC1–DC8) and **CLI constraints** (CC1–CC5) are not numbered as FR/NFR but are first-class implementation requirements; epics/stories must cover them or they will be silently dropped.
  - The PRD lists six commands (`export`, `import`, `fix-paths`, `share`, `rollback`, `completion`) — every command must have explicit epic/story coverage.
  - "Nice-to-haves" (colored output, progress display) are non-blocking but should still be noted in epics if scoped in.
  - The "Growth (Post-MVP)" section (snapshots, encryption, self-update, diff) is **out of scope** for v1 and should NOT appear in epics.

## Step 3: Epic Coverage Validation

The epics document publishes its own FR Coverage Map at `epics.md` lines 191–232. I cross-checked each claimed mapping against the acceptance criteria of the corresponding stories.

### FR Coverage Matrix

| FR | PRD Topic | Claimed Epic | Verified Story (with AC) | Status |
| --- | --- | --- | --- | --- |
| FR1 | Interactive category multi-select on export | Epic 1 | Story 1.10 (10-category multi-select) | ✓ Covered |
| FR2 | Per-project selection on export | Epic 1 | Story 1.10 (per-project multi-select) | ✓ Covered |
| FR3 | Export-everything shortcut | Epic 1 | Story 1.10 (`--all-projects`) | ✓ Covered |
| FR4 | Sessions opt-in | Epic 1 | Story 1.10 (`--include-sessions`) | ✓ Covered |
| FR5 | Credentials opt-in | Epic 1 | Story 1.10 (`--include-credentials`) + Story 1.4 (sanitization profile) | ✓ Covered |
| FR6 | Single `.cmemmov` JSON bundle artifact | Epic 1 | Story 1.10 + Story 1.6 (serializer) | ✓ Covered |
| FR7 | `--output <path>` for export | Epic 1 | Story 1.10 | ✓ Covered |
| FR8 | Import a `.cmemmov` bundle | Epic 1 | Story 1.11 | ✓ Covered |
| FR9 | Auto-detect cross-OS, initiate remap | Epic 2 | Story 2.2 | ✓ Covered |
| FR10 | Per-project review/confirm/override | Epic 1 | Story 1.11 (same-OS) + Story 2.2 (cross-OS) | ✓ Covered |
| FR11 | Auto-suggest matching dirs | Epic 1 + Epic 2 | Story 1.3 (`findMatchingDir`) + Story 2.1 (`suggestRemap`) + Stories 1.11/2.2 (consumers) | ✓ Covered |
| FR12 | Skip projects, post-import summary | Epic 1 | Story 1.11 + Story 2.2 (carry-over) | ✓ Covered |
| FR13 | Per-category merge/overwrite | Epic 1 | Story 1.11 (`--mode`) + Story 1.7 (writer) | ✓ Covered |
| FR14 | `--dry-run` preview | Epic 1 | Story 1.11 + Story 1.5 (WriteGate dry-run) | ✓ Covered |
| FR15 | Remap permission paths in `settings.json` | Epic 2 | Story 2.3 | ✓ Covered |
| FR16 | Remap paths in `.claude.json` | Epic 2 | Story 2.3 | ✓ Covered |
| FR17 | Auto-timestamped pre-write backup | Epic 1 | Story 1.5 (`backup-service`) + Story 1.11 | ✓ Covered |
| FR18 | Backup location reported up front | Epic 1 | Story 1.11 | ✓ Covered |
| FR19 | `cmemmov rollback` single-command restore | Epic 1 | Story 1.12 | ✓ Covered |
| FR20 | `fix-paths` re-associate without round-trip | Epic 3 | Story 3.3 | ✓ Covered |
| FR21 | Scan + decode + indicate disk presence | Epic 3 | Story 3.1 | ✓ Covered |
| FR22 | Auto-suggest replacement paths | Epic 3 | Story 3.2 | ✓ Covered |
| FR23 | Confirm/override/skip + backup before rename | Epic 3 | Stories 3.2 + 3.3 | ✓ Covered |
| FR24 | Sanitized team bundle strips personal data | Epic 4 | Stories 4.1 + 4.2 | ✓ Covered |
| FR25 | Team bundle preserves CLAUDE.md/MCP/cmds/perms | Epic 4 | Story 4.1 (declarative profile) + Story 4.2 | ✓ Covered |
| FR26 | Team bundle imports via standard import flow | Epic 4 | Story 4.3 (round-trip integration test) | ✓ Covered |
| FR27 | Bundle records `originalPath` per project | Epic 1 | Story 1.10 | ✓ Covered |
| FR28 | Bundle includes Claude Code version fingerprint | Epic 1 | Story 1.10 | ✓ Covered |
| FR29 | Warn (don't block) on version mismatch | Epic 1 | Story 1.6 (parser) + Story 1.11 | ✓ Covered |
| FR30 | Bundle is human-readable JSON | Epic 1 | Story 1.6 + Story 1.10 | ✓ Covered |
| FR31 | Silent mode (CLI flags, no prompts) | Epic 1 | Story 1.8 (prompts wrapper) + Story 1.10 + Story 1.9 | ✓ Covered |
| FR32 | `--json` machine-parseable output | Epic 1 | Story 1.8 + Story 1.9 + Story 1.10 | ✓ Covered |
| FR33 | Structured errors (file + operation + hint) | Epic 1 | Story 1.4 (`CmemmovError`) + Story 1.8 + Story 1.9 | ✓ Covered |
| FR34 | Standard exit codes 0/1/2 | Epic 1 | Story 1.9 + Story 1.11 | ✓ Covered |
| FR35 | Shell completion (bash/zsh/fish/pwsh) | Epic 5 | Story 5.1 | ✓ Covered |
| FR36 | Progress to stderr during long ops | Epic 1 | Story 1.10 (and inherits via Story 1.8) | ✓ Covered |

### NFR Coverage Matrix (cross-checked separately — epics did not publish an NFR map)

| NFR | Topic | Verified Story (with AC) | Status |
| --- | --- | --- | --- |
| NFR1 | Startup <500 ms | _none_ | ❌ **MISSING — no story has an acceptance criterion that asserts/measures cold-start time** |
| NFR2 | Export/import ≤10 s for 20 projects no sessions | _none_ | ❌ **MISSING — no story enforces the 10 s budget** |
| NFR3 | Export/import w/ sessions ≤60 s for 500 MB | _none_ | ❌ **MISSING — no story enforces the 60 s budget** |
| NFR4 | `--dry-run` runs in same time as live | _none_ | ⚠️ **MISSING — implicit (gate just records ops) but no AC asserts wall-clock parity** |
| NFR5 | Credentials never written unless flag (enforced in code) | Story 1.10 + Story 4.2 (refuses `--include-credentials`) | ✓ Covered |
| NFR6 | `share` never includes credentials | Stories 4.1 + 4.2 + 4.3 | ✓ Covered |
| NFR7 | Zero network calls at runtime | _none mechanically_ | ❌ **MISSING — relies on architectural intent (3 prod deps); no test asserts no socket is opened** |
| NFR8 | Bundle contains only explicit selections | Story 1.10 (diff assertion) | ✓ Covered |
| NFR9 | `--include-credentials` warning + bundle warning field | Story 1.10 | ✓ Covered |
| NFR10 | Fatal error leaves pre-import state | Stories 1.5 + 1.11 + 2.4 + 3.3 | ✓ Covered |
| NFR11 | Backup is a complete restorable copy | Stories 1.5 + 1.11 + 1.12 + 3.3 | ✓ Covered |
| NFR12 | `--dry-run` byte-for-byte lossless | Stories 1.5 + 1.11 + 1.12 + 2.3 + 2.4 + 3.4 + 4.2 + 4.3 | ✓ Covered |
| NFR13 | Atomic write patterns | Story 1.5 | ✓ Covered |
| NFR14 | Any unhandled error → non-zero exit + stderr | Stories 1.8 + 1.9 | ✓ Covered |
| NFR15 | Node v22+ | Story 1.1 (`engines.node`) | ✓ Covered |
| NFR16 | 3-OS test matrix | Stories 1.13 + 2.4 + 3.4 + 4.3 | ✓ Covered |
| NFR17 | Pre-built binaries (win-x64, mac-arm64, mac-x64, linux-x64) | Stories 5.2 + 5.3 | ✓ Covered |
| NFR18 | `path` / `os` built-ins exclusively | Story 1.2 (`no-hardcoded-separator` ESLint rule) + Story 1.7 | ✓ Covered |
| NFR19 | Respect `CLAUDE_CONFIG_DIR` | Story 1.7 | ✓ Covered |

### Domain & CLI Constraint Coverage (DC / CC / DR — supplementary check)

| Constraint | Topic | Verified Story | Status |
| --- | --- | --- | --- |
| DC1 | Path operations use `os.homedir()` / `path` | Stories 1.2 + 1.7 (ESLint rules) | ✓ Covered |
| DC2 | Atomic writes (no in-place modification) | Story 1.5 | ✓ Covered |
| DC3 | Pre-import backup intact on failure | Stories 1.5 + 1.11 + 3.3 | ✓ Covered |
| DC4 | `--dry-run` filesystem purity | Stories 1.5 + 1.11 + 2.4 + 3.4 | ✓ Covered |
| DC5 | No `postinstall` lifecycle scripts | Story 1.1 (explicit AC) | ✓ Covered |
| DC6 | Minimal production dependency footprint | Story 1.1 (3 prod deps + `zod`) | ✓ Covered |
| DC7 | Production deps pinned to exact versions | Story 1.1 (explicit AC) | ✓ Covered |
| DC8 | No runtime network | _same as NFR7_ | ❌ **MISSING — not mechanically verified** |
| CC1 | No persistent config file | _none (implicit)_ | ⚠️ **No negative test asserts a config file is never written/read** |
| CC2 | `--silent` all-or-nothing → exit 2 + JSON error | Stories 1.8 + 1.10 | ✓ Covered |
| CC3 | `--json` progress to stderr, single object to stdout | Story 1.8 | ✓ Covered |
| CC4 | Global flags on all commands | Story 1.9 (`--help` lists them) | ✓ Covered |
| CC5 | Path resolution: session `cwd` is authoritative; slug reversal as fallback | Story 1.10 (export reads `cwd`) + Story 3.1 (`source: 'sessionCwd' \| 'slugDecode'`) | ✓ Covered |
| DR1 | Published as `cmemmov` on npm | Story 5.3 | ✓ Covered |
| DR2 | Pre-built binaries for 4 targets | Story 5.2 | ✓ Covered |
| DR3 | Feature-complete v1 (governance) | n/a — release criteria, not a story | n/a |

### Command Surface Coverage

| Command | Story | Status |
| --- | --- | --- |
| `cmemmov export` | Story 1.10 | ✓ Covered |
| `cmemmov import` | Story 1.11 (same-OS) + Stories 2.2 / 2.3 (cross-OS extensions) | ✓ Covered |
| `cmemmov fix-paths` | Stories 3.1 + 3.2 + 3.3 | ✓ Covered |
| `cmemmov share` | Story 4.2 | ✓ Covered |
| `cmemmov rollback` | Story 1.12 | ✓ Covered |
| `cmemmov completion` | Story 5.1 | ✓ Covered |

### Missing Requirements

#### Critical Missing Coverage

- **NFR1 (startup <500 ms):** No story has an acceptance criterion that measures cold-start time. The PRD states "first output within 500 ms on any supported platform" — without a smoke test or benchmark this NFR is untestable in CI.
  - **Impact:** A regression that drags startup into the multi-second range (e.g., importing a heavy dependency at top level) would not be caught.
  - **Recommendation:** Add an acceptance criterion to **Story 1.9 (CLI Shell)** asserting `time cmemmov --help` completes in <500 ms on each CI runner, or add a dedicated benchmark step in **Story 1.13 (CI Matrix)**.

- **NFR7 / DC8 (zero network calls at runtime):** No story mechanically asserts that `cmemmov` opens no network sockets during any operation. This is a key security and trust property of the tool.
  - **Impact:** A future dependency or refactor could introduce a phone-home / version-check / telemetry path silently.
  - **Recommendation:** Add an acceptance criterion to **Story 1.13 (CI Matrix)** or **Story 1.9 (CLI Shell)** that runs each command under a network-blocking shim (e.g., monkey-patched `node:net` / `node:https` that throws on `connect`/`request`) and asserts no socket attempt is made.

#### High-Priority Missing Coverage

- **NFR2 / NFR3 (performance budgets — 10 s / 60 s):** No story enforces these wall-clock budgets.
  - **Impact:** Performance regressions on large bundles ship silently.
  - **Recommendation:** Add a perf-budget integration test (gated, can be opt-in) to **Story 1.13** or to the integration test files for Stories 1.10 / 1.11. Even a generous-margin test (e.g., 2× budget on CI hardware) catches regressions where the budget is blown by an order of magnitude.

#### Medium / Soft Gaps

- **NFR4 (`--dry-run` time parity):** Implicit — the WriteGate just records ops, so live and dry-run share the read-side cost. Worth one explicit AC in **Story 1.5** to lock the contract.
- **CC1 (no persistent config file):** No negative test. Easy to add: an integration test asserting that running any command does not create files outside `~/.claude/backups/cmemmov/` and the export-output path.
- **NFR18 mechanical enforcement breadth:** Story 1.2 covers `no-hardcoded-separator`, but the PRD says "no hardcoded separators or platform-specific string patterns in source code". A targeted lint rule for `os.platform() === 'win32'` outside `path-engine.ts` would tighten this.

### Coverage Statistics

- **Total PRD FRs:** 36
- **FRs covered in epics & stories:** 36
- **FR coverage percentage:** **100%** (claimed in `epics.md` and verified against story acceptance criteria)
- **Total PRD NFRs:** 19
- **NFRs verified by acceptance criteria:** 14 fully + 1 partial (NFR4) ≈ 76%
- **NFRs missing mechanical verification:** **5** (NFR1, NFR2, NFR3, NFR4 partial, NFR7)
- **Domain Constraints (DC1–DC8):** 7 of 8 verified (DC8 missing — same as NFR7)
- **CLI Constraints (CC1–CC5):** 4 of 5 explicitly verified (CC1 implicit only)
- **Distribution Constraints (DR1–DR3):** All addressed (DR3 is governance)
- **Six-command surface:** All 6 commands have explicit story coverage
- **Out-of-scope leakage:** None — Growth section (snapshots, encryption, self-update, diff) does not appear in epics

### Verdict on FR coverage

**PASS** — the FR mapping in `epics.md` is accurate and every FR is anchored in at least one story acceptance criterion. The gaps are exclusively in NFR/DC/CC verification, not in functional requirement coverage. Recommend addressing the **NFR1** and **NFR7/DC8** gaps before implementation kicks off, since both are simple AC additions to existing stories (1.9 and/or 1.13) and both protect properties that are easy to silently break.

## Step 4: UX Alignment Assessment

### UX Document Status

**Not Found** — no `ux*.md` or `ux*/` artifact exists in `_bmad-output/planning-artifacts/`.

### Is UX Implied?

The PRD classifies the project as **CLI Tool — terminal-first** (`prd.md` §"Project Classification"). All user-facing interaction patterns are specified in two structured PRD sections:

- **PRD §"CLI Tool Specific Requirements"** — command structure, output formats (human-readable vs. `--json`), exit codes (0/1/2), `--silent` scripting parity, error message conventions, progress feedback rules.
- **PRD §"User Journeys"** (Alex, Maya, Jordan, Taylor) — four end-to-end conversational walk-throughs, each annotated with the capabilities it reveals.

The `epics.md` document explicitly addresses this at lines 187–189: _"N/A — `cmemmov` is a terminal-only CLI tool. No UX Design document exists in the planning artifacts. All interactive UX is specified in the PRD §'CLI Tool Specific Requirements' (output formats, exit codes, scripting support, error message conventions) and is enforced architecturally via `ui/output.ts` and `ui/prompts.ts`. Terminal interaction patterns (interactive menus, confirmations, auto-suggestion display) use `@clack/prompts`."_

**Verdict on UX implication:** UX is **NOT implied** in the typical web/mobile sense. There is no GUI surface, no responsive-layout requirement, no accessibility-of-color-contrast surface, no design-system requirement. Terminal UX is fully captured in the PRD and enforced architecturally.

### UX-equivalent Coverage in PRD ↔ Architecture ↔ Stories

The terminal-UX surface is covered as follows:

| Terminal UX Concern | PRD Source | Architecture Enforcement | Story |
| --- | --- | --- | --- |
| Output discipline (stdout vs. stderr, `--json` mode) | §"Output Formats" | All output through `ui/output.ts`; `console.*` banned elsewhere via ESLint | Stories 1.2 + 1.8 |
| Interactive prompts library | (implicit) | `@clack/prompts` selected via Architecture §"Starter Template Evaluation" | Story 1.8 (prompts wrapper) |
| Silent-mode parity (FR31) | §"Scripting Support" | `decision-schema` provides single source for prompt ↔ flag pairing | Stories 1.8 + 1.10 |
| Exit codes 0/1/2 (FR34) | §"Output Formats" | Single error type `CmemmovError` carries `exitCode`; only top-level catch in `cli.ts` | Stories 1.4 + 1.9 |
| Error messages (file + operation + hint) (FR33) | §"Implementation Considerations" | `CmemmovError` discriminated union | Stories 1.4 + 1.8 + 1.9 |
| Progress feedback (FR36) | §"Implementation Considerations" | `output.progress()` writes to stderr regardless of mode | Stories 1.8 + 1.10 |
| Ctrl+C handling | (implicit) | Prompts wrapper cancels gracefully | Story 1.8 |
| Auto-suggestion display | §"User Journeys" (Maya, Jordan) | `path-engine.suggestRemap` / `findMatchingDir` produce typed candidates | Stories 1.3 + 2.1 + 2.2 + 3.2 |
| Skip/override/confirm tri-option prompt | §"User Journeys" (Alex, Maya, Jordan) | Captured uniformly across same-OS, cross-OS, fix-paths | Stories 1.11 + 2.2 + 3.2 |

### Alignment Issues

**None** — the PRD's CLI-UX requirements, the Architecture's `ui/` layer design, and the stories' acceptance criteria are mutually consistent and reinforce each other:

- PRD requires `--json` output; Story 1.8 enforces "exactly one final stdout write per command, no interleaving with stderr"; Architecture bans `console.*` outside `ui/output.ts`.
- PRD requires `--silent` parity; Story 1.8's prompts wrapper exits with code 2 + structured error if a required flag is missing; `decision-schema` (Story 1.8) is the single source of truth.
- PRD requires structured errors with `code`/`file`/`operation`/`hint`; Architecture's `CmemmovError` (Story 1.4) is the only error type, and the `ErrorCode` union has exactly 12 codes covering all PRD-described failure modes.

### Warnings

- **None blocking.** The lack of a separate UX document is **explicitly acknowledged and justified** in `epics.md` and is internally consistent with the project type. A reader expecting a Figma/wireframe deliverable will find none, but they should — `cmemmov` has no GUI surface to design.

### Verdict on UX alignment

**PASS (UX = N/A)** — UX coverage is appropriate and proportional for a terminal-only CLI tool. The PRD substitutes structured "CLI Tool Specific Requirements" + four narrative user journeys for a traditional UX deliverable, and these are tightly mapped into the Architecture (`ui/output.ts` + `ui/prompts.ts` + `decision-schema`) and into specific story acceptance criteria. No alignment gap, no warning to escalate.

## Step 5: Epic Quality Review

### Epic User-Value Focus

| Epic | Title Form | User-Value Goal? | Verdict |
| --- | --- | --- | --- |
| Epic 1 | "Foundation & Same-OS Migration (Alex's Journey)" | Yes — opens with "A user can run `cmemmov export` on one same-OS machine and `cmemmov import` on another to migrate…" | ✓ PASS — title couples technical ("Foundation") with user outcome; goal is unambiguously user-facing |
| Epic 2 | "Cross-OS Migration & Path Intelligence (Maya's Journey)" | Yes — "A user can migrate their `~/.claude/` across operating systems…" | ✓ PASS |
| Epic 3 | "Path Repair Standalone Command (Jordan's Journey)" | Yes — "A user whose project associations are already broken can run `cmemmov fix-paths`…" | ✓ PASS |
| Epic 4 | "Team Sharing & Sanitization (Taylor's Journey)" | Yes — "A team lead can produce a sanitized, version-controllable team baseline bundle…" | ✓ PASS |
| Epic 5 | "Distribution, Shell Completion & Release Polish" | Mixed — distribution + completion are user-facing; release polish is governance | ⚠️ ACCEPTABLE — completion (FR35) and binary distribution (NFR17) are explicit PRD-named v1 deliverables, not "infrastructure plumbing"; no Epic-as-pure-tech-milestone violation |

**Note:** Each Epic's narrative goal opens with "A user / A team lead / A maintainer can…" — strong user-centric framing throughout.

### Epic Independence

| Epic | Depends On | Forward-References Future Epic? | Independent of N+1? |
| --- | --- | --- | --- |
| Epic 1 | (none) | No | ✓ stands alone — delivers same-OS export/import/rollback |
| Epic 2 | Epic 1 (path engine, import command, WriteGate, backup service) | No | ✓ adds cross-OS atop Epic 1 only |
| Epic 3 | Epic 1 (path engine, backup service, WriteGate, claude-locator) | No | ✓ standalone command consuming Epic 1 surface only |
| Epic 4 | Epic 1 (sanitization profile slot from Story 1.4, import command), Epic 2 (cross-OS remap consumed via standard import) | No | ✓ |
| Epic 5 | All prior epics (binary must include all functionality; completion must list all commands) | No | ✓ correctly placed at the end |

**No forward dependencies. No circular dependencies.** Epic ordering matches dependency direction.

### Story Quality — Sizing & BDD Format

I sampled stories across all epics. Highlights:

- **Story 1.1 (Repo Init):** 8 Given/When/Then blocks; each is independently testable; covers `package.json`, lint, typecheck, build, integrated `check`, file presence (`.nvmrc`, `LICENSE`, `.gitignore`). ✓
- **Story 1.3 (Path Engine same-OS):** 9 AC blocks; includes a creative architectural-discipline AC ("grep the codebase for `path.replace(/[:\\\\/]/g, '-')`") to enforce single-source-of-truth at lint time. 100% line + branch coverage requirement. ✓
- **Story 1.4 (Core Models):** Enumerates the exact 12 `ErrorCode` values. ✓
- **Story 1.5 (WriteGate/Backup):** Strongest invariant AC of the whole pack: "an interrupted process (SIGKILL between write and rename) leaves no partial file at `targetPath`." Cross-volume fallback is explicit. Concurrent-run collisions are addressed via PID + random suffix. ✓
- **Story 1.10 (Export):** 11 ACs; every FR consumed is cited inline; security-sensitive flows (`--include-credentials`) get dedicated ACs. ✓
- **Story 1.11 (Import same-OS):** 11 ACs; NFR10/11/12 cited inline; partial-failure path covered ("auto-backup remains intact"). Edge case: corrupted-checksum bundle exits BEFORE any backup write. ✓
- **Story 2.1 (Path Engine cross-OS):** Parameterized over 6 platform combinations; explicit `null`-return semantics for unrecognized prefixes (no silent guessing). ✓
- **Story 4.1 (Sanitization profile):** "Adding a new category to the system without updating this profile fails a unit test" — strong forcing function. ✓
- **Story 5.1 (Completion):** Per-shell positive tests; auto-detect + missing-shell error case; smoke test in CI. ✓

**BDD Format compliance:** All ACs use Given/When/Then structure. No vague "user can login"–style criteria observed.

### Within-Epic Story Dependencies

Within-epic dependency graph (must be linear or DAG, no forward references):

- **Epic 1:** 1.1 (repo) → 1.2 (lint rules) → 1.3 (path engine pure) → 1.4 (core models) → 1.5 (WriteGate uses error from 1.4) → 1.6 (parser uses 1.4 + 1.5) → 1.7 (reader/writer uses 1.5) → 1.8 (UI uses 1.4) → 1.9 (CLI uses 1.4 + 1.8) → 1.10 (export uses 1.3 + 1.4 + 1.5 + 1.6 + 1.7 + 1.8 + 1.9) → 1.11 (import same-OS uses 1.10 surface) → 1.12 (rollback uses 1.5 + 1.7 + 1.8 + 1.9) → 1.13 (CI). **Linear chain — no forward refs.** ✓
- **Epic 2:** 2.1 (path engine cross-OS) → 2.2 (cross-OS remap UI uses 2.1) → 2.3 (settings/.claude.json remap uses 2.2 decisions) → 2.4 (integration tests). ✓
- **Epic 3:** 3.1 (scan) → 3.2 (suggest + UI uses 3.1) → 3.3 (apply uses 3.2) → 3.4 (tests). ✓
- **Epic 4:** 4.1 (profile) → 4.2 (share uses 4.1) → 4.3 (round-trip tests). ✓
- **Epic 5:** 5.1 (completion) → 5.2 (binaries) → 5.3 (release pipeline ties 5.1/5.2 together) → 5.4 (docs). ✓

**No forward dependencies detected.**

### Greenfield-Specific Checks

| Check | Status | Notes |
| --- | --- | --- |
| Initial project setup story | ✓ Story 1.1 | Bespoke init (no starter — Architecture explicitly evaluated and rejected `oclif`/`gluegun`/Citty in favor of hand-built minimal stack to satisfy <500 ms startup + minimal-deps + Node SEA constraints) |
| Dev environment configuration | ✓ Story 1.1 | `.nvmrc`, `.editorconfig`, `tsconfig`, `eslint.config`, `vitest`, `tsup` all in 1.1 |
| CI/CD pipeline setup early | ⚠️ Story 1.13 (END of Epic 1) | Architecture-justified ("set up at the end so it can validate the full Epic 1 surface"). Acceptable but is a deviation from the textbook "CI early" greenfield pattern — see Minor Concerns below |
| Database tables created when needed | n/a | No database in scope |

### Starter Template Requirement

Architecture's "Starter Template Evaluation" explicitly evaluates `oclif`, `gluegun`, and Citty and rejects all three with reasons (startup-time inflation, dependency bloat, Node SEA single-bundle incompatibility). It then prescribes a "bespoke minimal stack" with documented Initialization Steps. Story 1.1 follows those steps exactly. ✓

### Compliance Checklist

| Check | Result |
| --- | --- |
| Epic delivers user value | ✓ all 5 epics |
| Epic can function independently of later epics | ✓ all 5 epics |
| Stories appropriately sized | ✓ no oversized stories observed; each story has ≤11 ACs |
| No forward dependencies | ✓ |
| Database tables created when needed | n/a |
| Clear acceptance criteria | ✓ all sampled stories use Given/When/Then |
| Traceability to FRs maintained | ✓ FR Coverage Map at `epics.md:191–232`; ACs cite FR numbers inline |

### Quality Findings

#### 🔴 Critical Violations

**None.**

#### 🟠 Major Issues

1. **Path-resolution-from-session-`cwd` ownership is ambiguous.**
   Both Story 1.10 (export shows "decoded original paths from session `cwd`") and Story 3.1 (fix-paths scan with `source: 'sessionCwd' | 'slugDecode'`) consume an authoritative path-from-`cwd` resolution. But neither story owns _implementing_ it as a reusable service. Story 1.7 (claude-reader) reads `sessionHistory` as a category but its ACs do not name the per-project authoritative-path extraction contract.
   - **Impact:** Risk of two divergent implementations (export vs. fix-paths), violating Architecture's "single source of truth" principle.
   - **Recommendation:** Add an explicit acceptance criterion to **Story 1.7 (Claude Code Surface)** specifying that `claude-reader` exposes `resolveOriginalPath(slug): { path, source: 'sessionCwd' | 'slugDecode' | null }` consumed by both export and fix-paths. OR factor it into the `path-engine` (Story 1.3) as `resolveAuthoritativePath(claudeDir, slug)`.

2. **Story 1.10 (Export) does not specify behavior for memory-only projects (no session JSONL).**
   The PRD's "Scoping Risks" section explicitly calls this out: "For memory-only projects with no sessions, fallback presents the decoded slug to the user for manual confirmation." Story 3.1 handles this case explicitly. Story 1.10 does not.
   - **Impact:** Export of a memory-only project would silently use slug decoding (potentially lossy) without surfacing the ambiguity to the user.
   - **Recommendation:** Add an AC to **Story 1.10**: "Given a project with no session JSONL files, when export displays the per-project list, then the decoded slug is shown with an indicator that the path is best-effort and the user is asked to confirm or correct it before inclusion in the bundle."

#### 🟡 Minor Concerns

1. **Stories 1.1–1.9 use `As a developer working on cmemmov, I want X, So that Y` framing.**
   These are technical-foundation stories where the "user" is the project itself. Strict BMAD scoring treats this as a soft violation of "deliver user value", but for a CLI tool with strict architectural invariants, foundation stories are accepted. The end-user value of Epic 1 is delivered by Stories 1.10–1.12. **No remediation needed**; flagged for transparency.

2. **Story 1.13 (CI Matrix) at the END of Epic 1 rather than early.**
   Greenfield best practice prefers CI early. The epic narrative justifies this ("CI is set up at the end so it can validate the full Epic 1 surface"). Acceptable trade-off — but consider a lightweight CI step seeded by Story 1.1 (just lint + typecheck on three OSes) to catch trivial regressions during foundation work, with Story 1.13 expanding it to include integration tests + coverage thresholds.

3. **Story 1.11 (Import same-OS) does not enumerate per-category behavior for all 10 categories.**
   The story uses `--mode merge|overwrite` abstractly and delegates per-category behavior to Story 1.7's `claude-writer`. Categories like `plugins`, `teams`, `customCommands`, `mcpConfig` don't have story-level ACs describing merge semantics for _each_ category.
   - **Recommendation:** Add a single integration-test AC to **Story 1.11** asserting that an end-to-end import with all 10 categories selected produces the expected on-disk shape for each — or add a per-category merge-semantics table to **Story 1.7** so ambiguity is resolved at the writer-service level.

4. **Story 4.1's personal-data-detection heuristic uses pattern globs (`personal*`, `private*`, `me_*`, `todo*`).**
   These patterns are subjective and may produce false positives (`todo.md` containing team conventions) or false negatives (a personal file named `notes.md`). The heuristic is also not configurable.
   - **Recommendation:** Add an AC to **Story 4.1** stating that the pattern list is a documented constant in `core/sanitization-rules.ts`, that an interactive `share` flow lists files that _will_ be stripped before producing the bundle (so the user can override), and that a `--include-personal-pattern <glob>` and `--exclude-personal-pattern <glob>` escape hatch exists for power users. (Or: explicitly accept the "false positives are safer than false negatives" trade-off in the AC and document it.)

5. **Story 5.1's PowerShell auto-detect heuristic (`$env:PSModulePath` / `$Host.Name`) is unreliable.**
   When `cmemmov` is launched as a Node process, `$Host` is not exposed; `PSModulePath` is set in any environment that has installed PowerShell modules, including non-PowerShell shells. `process.env.PSModulePath` plus `process.env.PSEdition` plus checking the parent process is closer, but still imperfect.
   - **Recommendation:** Update **Story 5.1**'s auto-detect AC to require detection by inspecting the parent process (e.g., on Windows, parsing `wmic process where ProcessId=<ppid>` or using `process.ppid` + `tasklist`). Or simpler: document that auto-detect supports only POSIX shells and require an explicit `cmemmov completion powershell` invocation on Windows. The latter is honest and matches the FR35 requirement.

6. **No story addresses runtime detection of an active Claude Code process** (Architecture Important Gap #3).
   Story 1.7's `claude-reader` surfaces `EBUSY`/`EPERM` cleanly during reads. But no story attempts proactive detection (e.g., process-list scan, lockfile, attempting to acquire an exclusive lock) before the import write phase. Story 5.4 documents the "close Claude Code first" guidance in the README.
   - **Recommendation:** Confirm that documentation-only mitigation is the intended v1 scope — and if so, add an explicit AC to **Story 5.4** that the README's "Known Limitations" section names this. (As-is, the README AC is generic.)

#### Documentation / Process

- The epics document is internally consistent: Requirements Inventory → FR Coverage Map → epic narratives → story ACs all reference the same FR/NFR numbering.
- Acceptance criteria are uniformly testable (BDD format with concrete fixtures or assertions).
- Architectural invariants enforced via the local ESLint plugin (Story 1.2) — a strong forcing function that prevents drift across epics.

### Verdict on Epic Quality

**PASS with 2 Major recommendations and 6 Minor concerns.**

- **0 Critical violations** — no technical-milestone epics, no forward dependencies, no oversized stories.
- **2 Major issues** are scope clarifications (path-resolution ownership; memory-only project handling) that require ≤1 AC each to resolve and should land before implementation begins.
- **6 Minor concerns** are quality-of-life refinements that can be addressed during the epics they affect, not as blockers.

Overall the epics document exhibits strong engineering discipline: every FR is mapped, every architectural invariant has a forcing function (lint rule, coverage threshold, or AC), and dependency direction is clean across all 5 epics.

## Summary and Recommendations

### Overall Readiness Status

Status: **READY** — with two pre-implementation clarifications recommended.

The PRD, Architecture, and epics/stories are coherent, traceable, and engineered to a high standard. All 36 functional requirements are anchored in specific story acceptance criteria. All five epics deliver user value and respect dependency direction. Architectural invariants are mechanically enforced via a local ESLint plugin and coverage thresholds. The two Major issues identified in Step 5 are scope clarifications (not design defects) and can each be resolved by adding ≤1 acceptance criterion to an existing story.

### Critical Issues Requiring Immediate Action

**None blocking.** No 🔴 Critical violations were found.

### Issues Recommended for Resolution Before Implementation

#### 🟠 Major (resolve before implementation kicks off)

1. **Path-resolution-from-session-`cwd` ownership unspecified.**
   Both Story 1.10 (export) and Story 3.1 (fix-paths) consume an authoritative `cwd`-based path resolver, but no story owns implementing it as a single service.
   **Action:** Add an AC to Story 1.7 specifying `claude-reader` exposes `resolveOriginalPath(slug): { path, source: 'sessionCwd' | 'slugDecode' | null }`.

2. **Memory-only project handling missing from Story 1.10 (Export).**
   The PRD's "Scoping Risks" requires user confirmation for projects without session JSONL; only fix-paths (Story 3.1) handles it. Export does not.
   **Action:** Add an AC to Story 1.10 specifying that memory-only projects show the decoded slug with a "best-effort" indicator and prompt for confirmation/correction before inclusion.

#### ⚠️ NFR Verification Gaps (resolve as part of Story 1.13 / 1.9 ACs)

1. **NFR1 (startup <500 ms) — not mechanically verified.** Add an AC to Story 1.9 or 1.13 measuring `cmemmov --help` cold-start time on each CI runner.
2. **NFR7 / DC8 (zero runtime network calls) — not mechanically verified.** Add an AC to Story 1.13 running each command under a network-blocking shim (monkey-patched `node:net`/`node:https` throwing on connect/request).
3. **NFR2 / NFR3 (10 s / 60 s performance budgets) — not mechanically verified.** Add a perf-budget integration test (generous 2× margin acceptable) to Stories 1.10 / 1.11.

#### 🟡 Minor (can be addressed in-flight)

1. CI seed in Story 1.1 (lightweight lint+typecheck on 3 OSes) before Story 1.13 expands to full integration coverage.
2. Story 1.11: per-category merge-semantics enumeration (single integration AC, or a table in Story 1.7).
3. Story 4.1: document the personal-data heuristic as a constant + provide interactive preview / `--include-pattern`/`--exclude-pattern` escape hatches.
4. Story 5.1: replace the unreliable PowerShell auto-detect heuristic with parent-process inspection or document that auto-detect is POSIX-only.
5. Story 5.4: explicitly require the README's "Known Limitations" to name the active-Claude-Code-process scenario.
6. CC1 (no persistent config file): add a negative integration test asserting no command writes outside `~/.claude/backups/cmemmov/` and the user-supplied output path.
7. NFR4 (`--dry-run` time parity): one explicit AC in Story 1.5 to lock the contract.

### Recommended Next Steps

1. **Update Story 1.7** with the `resolveOriginalPath` contract; **update Story 1.10** with the memory-only-project handling AC. (≤30 minutes of editing.)
2. **Update Story 1.13 (CI Matrix)** to include NFR1 (startup-time benchmark) and NFR7/DC8 (network-block shim) as acceptance criteria. Optionally add NFR2/NFR3 perf budgets as well.
3. **Optionally apply Minor concerns 1–7** (from the Minor section above) during the epic they affect, not as pre-implementation blockers.
4. **Proceed to story creation / implementation kickoff.** The architectural foundation in Epic 1 (Stories 1.1–1.9) can begin in parallel with the Major-issue clarifications above.

### Coverage Summary

| Dimension | Result |
| --- | --- |
| FR coverage | **36/36 (100%)** — verified against story ACs |
| NFR mechanical verification | **14 fully + 1 partial / 19 (≈76%)** — gaps in NFR1, NFR2, NFR3, NFR4, NFR7 |
| Domain Constraints (DC1–DC8) | **7/8 (DC8 = NFR7 missing)** |
| CLI Constraints (CC1–CC5) | **4/5 (CC1 implicit only)** |
| Six-command surface | **6/6 covered** |
| Epic structural integrity | **5/5 epics user-value-centered, independent, no forward deps** |
| Story BDD format | **Uniform Given/When/Then; testable; concrete fixtures** |
| Out-of-scope leakage | **None** — Growth section (snapshots/encryption/self-update/diff) absent from epics |
| Critical violations | **0** |
| Major issues | **2** (both ≤1 AC to resolve) |
| Minor concerns | **6** |

### Final Note

This assessment identified **2 Major** scope-clarification issues and **6 Minor** quality-of-life concerns across **3 categories** (FR/NFR traceability, story scope completeness, story craftsmanship). Address the 2 Major issues and the 3 NFR-verification gaps (items 3–5 above) before proceeding to implementation; the remaining Minor concerns can be addressed in-flight without blocking the start of work.

The artifacts demonstrate uncommonly strong engineering discipline for a solo developer tool: explicit architectural invariants, mechanical enforcement (ESLint plugin + coverage thresholds), tight FR↔story traceability, and clean dependency direction across epics. Implementation can proceed with high confidence once the recommended clarifications land.

---

**Assessor:** Implementation Readiness Skill (BMAD)
**Date:** 2026-05-09
**Project:** ClaudeMemoryMover (`cmemmov`)

---

## Remediation Addendum (2026-05-09)

All 12 issues identified above have been remediated by direct edits to `_bmad-output/planning-artifacts/epics.md`. Each fix is anchored in an existing story's acceptance criteria; no new stories were added.

### Major Issues Resolved

1. **Path-resolution-from-session-`cwd` ownership (was unspecified).**
   Added an AC to **Story 1.7** specifying `claude-reader.resolveOriginalPath(slug)` returns `{ path, source: 'sessionCwd' | 'slugDecode' | null }` as the single resolver consumed by both export (Story 1.10) and fix-paths (Story 3.1). Architectural enforcement: a `grep` for `cwd`-extraction logic outside `claude-reader.ts` must return zero matches.

2. **Memory-only project handling in Story 1.10 (Export).**
   Added two ACs to **Story 1.10**: (a) interactive labeling — `<decoded-path> (best-effort — no sessions)` for `source: 'slugDecode'` and `<slug-verbatim> (path unknown)` for `source: null`, with user confirmation/correction stored as the bundle's `originalPath`; (b) `--silent` mode without a corresponding `--project-path <slug>=<path>` flag exits 2 with `PATH_REMAP_AMBIGUOUS` — never silently accepts a best-effort decode as authoritative.

### NFR Verification Gaps Resolved

1. **NFR1 (startup <500 ms) — now mechanically verified.**
   Added an AC to **Story 1.13** for `npm run bench:startup` that runs `cmemmov --help` ten times on each of the three CI runners and asserts the median is <500 ms. Also added a complementary AC to **Story 1.9** asserting that the CLI shell's eagerly-imported module graph contains only `commander` + version constant + dispatch table (no `@clack/prompts`, `zod`, etc.) — supports the budget by construction.

2. **NFR7 / DC8 (zero runtime network calls) — now mechanically verified.**
   Added an AC to **Story 1.13** that runs every command under a network-blocking shim (`node:net`, `node:dgram`, `node:tls`, `node:https`, and `globalThis.fetch` patched to throw on `connect`/`request`/`socket`). Includes a self-test asserting the shim is active so a future regression that drops the shim doesn't silently pass.

3. **NFR2 / NFR3 (10 s / 60 s performance budgets) — now mechanically verified.**
   Added two ACs to **Story 1.13**: (a) a 20-project / no-sessions perf-budget test (NFR2 × 2 generous CI margin = <20 s); (b) a 500 MB session-history fixture test gated behind `CMEMMOV_RUN_LARGE_PERF=1` (NFR3 × 2 = <120 s) — runs nightly + on release tags rather than on every PR to keep standard CI fast.

### Minor Concerns Resolved

1. **CI seed in Story 1.1** — added an AC for `.github/workflows/ci-seed.yml` (lightweight 3-OS lint+typecheck) so toolchain drift is caught during foundation work (Stories 1.2–1.9) before Story 1.13 brings up the full integration matrix.

2. **Per-category merge semantics** — added an AC to **Story 1.7** containing an explicit table mapping each of the 10 categories to its `merge` and `overwrite` semantics, with an exhaustiveness check making it a build error to add a category without updating the table.

3. **Story 4.1 personal-pattern heuristic** — added an AC requiring `PERSONAL_FILENAME_PATTERNS` to be exposed as a named exported constant in `core/sanitization-rules.ts` and documented in `docs/bundle-format.md` with the "false positives are safer than false negatives" rationale.

4. **Story 4.2 interactive preview + override flags** — added two ACs: (a) interactive `share` shows a stripped-items preview block before the bundle is written, with `[Y]es / [N]o / [E]dit overrides` choices; (b) `--include-pattern` / `--exclude-pattern` flags compose with `PERSONAL_FILENAME_PATTERNS` and the effective set is logged at the start of the run. Override flags do NOT bypass the unconditional credentials-strip rule (NFR6 still enforced).

5. **Story 5.1 PowerShell auto-detect** — replaced the unreliable `$Host.Name` heuristic. POSIX behavior is now: read `process.env.SHELL`, match its basename. Windows behavior is: auto-detect is NOT attempted; the command exits 2 with a hint requiring `cmemmov completion powershell` explicitly. Documented in `--help` and README.

6. **Story 5.4 README "Known Limitations"** — tightened the existing AC into a structured three-limitation block where each limitation has explicit user-facing remediation: large-session memory ceiling (rely on `--exclude-sessions`), macOS Gatekeeper (`xattr -d com.apple.quarantine`), and active-Claude-Code-process (`EBUSY`/`EPERM` on both reads and writes — quit Claude Code first; `claude-reader` surfaces the structured error if encountered).

7. **CC1 (no persistent config file)** — added an AC to **Story 1.13** asserting that integration-test post-run state shows no file written outside the documented allowlist (`~/.claude/backups/cmemmov/`, user-supplied `--output`, `os.tmpdir()`, the existing `~/.claude/` surface).

### NFR4 Resolved

Added an AC to **Story 1.5** asserting that the dry-run `WriteGate`'s per-operation cost is O(1) record-only (zero I/O) — guaranteeing dry-run wall-clock time tracks live wall-clock time minus the I/O portion (NFR4 by construction). Enforced via unit test + an ESLint `no-restricted-imports` ban on `fs.*` write APIs inside the gate's dry-run branch.

### Status

**All 12 items closed.** `epics.md` is now ready for implementation kickoff. Recommend re-running this readiness skill (or a focused traceability spot-check) before story creation begins, to confirm the additions are internally consistent.
