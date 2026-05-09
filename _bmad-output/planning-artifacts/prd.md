---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-12-complete
releaseMode: phased
inputDocuments:
  - initial-prompt.md
  - _bmad-output/planning-artifacts/product-brief-ClaudeMemoryMover.md
  - _bmad-output/planning-artifacts/product-brief-ClaudeMemoryMover-distillate.md
  - claude-memory-move-research.md
  - _bmad-output/planning-artifacts/research/technical-claude-code-migration-research-2026-05-08.md
workflowType: prd
classification:
  projectType: cli_tool
  domain: general
  complexity: medium
  projectContext: greenfield
briefCount: 2
researchCount: 2
brainstormingCount: 0
projectDocsCount: 0
---

# Product Requirements Document - ClaudeMemoryMover

**Author:** Developer
**Date:** 2026-05-08

## Executive Summary

Claude Code accumulates irreplaceable context over time — project memories, workflow rules, MCP configurations, permission settings, and CLAUDE.md files that shape how the AI assistant behaves for a specific developer. All of it lives in `~/.claude/` with no built-in export, backup, or migration path. When developers get new hardware, switch operating systems, or want to replicate their setup across machines, they face a fragile manual copy that almost always fails silently: project associations break because Claude Code encodes absolute paths into directory names, and a renamed drive letter or username is enough to orphan months of accumulated context.

`cmemmov` (ClaudeMemoryMover) is a Node.js CLI that treats Claude Code migration as a first-class problem. It exports the full `~/.claude/` artifact surface into a single human-readable JSON bundle, then imports it on the target machine with automatic path detection and remapping — across operating systems, drive letters, usernames, and directory structures. The complete workflow requires no cloud accounts, no external services, and no manual file editing.

### What Makes This Special

Path remapping is the core feature, not an afterthought. Claude Code encodes project paths into directory names using a deterministic slug algorithm (`path.replace(/[:\\/]/g, '-')`). No existing migration tool understands this encoding — they either skip project associations entirely or leave broken slugs for the user to fix manually. `cmemmov` reads the original path from session metadata, presents a guided remapping flow for each project, auto-suggests matches when the directory exists at a new location, and re-derives the correct slug — applying the remap consistently across project directories, session `cwd` fields, permission rules, and global state.

The export bundle is intentionally inspectable: plain JSON, readable in any text editor, safe to commit to a dotfiles repository. A `--dry-run` flag previews exactly what import will change before writing anything. Credentials are excluded by default; a `--include-credentials` opt-in with a prominent warning handles the rare case where they're needed. Every interactive workflow has a `--silent` mode equivalent for scripting and automation.

A secondary `share` command produces a sanitized team bundle — stripping personal data and machine-specific paths while preserving CLAUDE.md rules, MCP server definitions, custom commands, and shared permission patterns. New team members can bootstrap a consistent Claude Code baseline in one command.

## Project Classification

- **Project Type:** CLI Tool — interactive menu + silent/scriptable mode, npm-distributed, terminal-first
- **Domain:** Developer Tooling — no regulated-industry requirements; cross-platform correctness and data-loss prevention are the primary concerns
- **Complexity:** Medium — the core logic (path slug encoding, selective merge, cross-OS remapping) is non-trivial; silent data loss would be a critical failure
- **Project Context:** Greenfield — no existing codebase; full design freedom

## Success Criteria

### User Success

- A user completing any supported migration scenario (same-OS new machine, cross-OS, username change) never needs to manually edit the export JSON bundle — the interactive remapping flow handles all path translation
- Every import that completes without an error leaves the target Claude Code installation in a valid, usable state — no corrupted slugs, broken MEMORY.md indexes, or orphaned project directories
- The `--dry-run` preview is accurate: every change it reports is exactly what the live import applies, and it reports every change the live import makes

### Business Success

- 100+ GitHub stars within 6 months of public release
- Package published as `cmemmov` on npm and installable globally on day one of release
- Personal utility: used by the author on every subsequent machine setup — the tool eats its own dog food

### Technical Success

- No data loss bugs ship in v1.0: auto-backup of the target `~/.claude/` state happens automatically before any import writes — no user action required; the backup location is reported at the start of every import so the user always knows where their rollback point is
- All three target platforms (Windows, macOS, Linux) are explicitly tested against the full export/import/fix-paths/share workflow — not just "should work in theory"
- Cross-OS migrations (Windows↔macOS, Windows↔Linux, macOS↔Linux) complete without manual file editing for all supported artifact categories

### Measurable Outcomes

- Zero user-filed issues reporting "had to edit the JSON to fix my migration"
- Zero user-filed issues reporting "import failed and I lost my Claude Code data"
- Pre-built binaries published on GitHub Releases for Windows x64, macOS arm64, macOS x64, and Linux x64 at v1.0

## Product Scope & Roadmap

### Strategy

Feature-complete v1 — all functionality ships together when ready, with no artificial time constraint. The release criterion is correctness and completeness, not a calendar date. This is appropriate for a solo developer tool where a partial release would undermine trust and the "zero manual edits" success criterion. Single developer (author); Node.js, npm ecosystem; no external services or infrastructure. Distribution via npm publish + GitHub Releases binary uploads.

### MVP — Minimum Viable Product

All four user journeys (Alex, Maya, Jordan, Taylor) are supported at v1.

**Must-Have Capabilities:**

- `cmemmov export` — interactive multi-select by category and project; produces `.cmemmov` JSON bundle; session history and credentials opt-in only
- `cmemmov import <file>` — guided path remapping per project, merge/overwrite per category, `--dry-run`, auto-backup before any write; path resolution reads `cwd` from session JSONL to handle ambiguous slug cases
- `cmemmov rollback` — restores most recent pre-import backup in one command
- `cmemmov fix-paths` — slug decode + directory scan + auto-suggestion + bulk remap with backup
- `cmemmov share` — sanitized team bundle; strips personal data and machine-specific paths
- `--silent` mode — 100% feature parity with interactive mode via CLI flags
- `--json` output — machine-parseable result object on stdout; errors to stderr; exit codes 0/1/2
- Cross-OS support — Windows, macOS, Linux explicitly tested; cross-OS path conversion (Windows↔Unix) in import and fix-paths
- Credentials — excluded by default; `--include-credentials` opt-in with prominent warning
- Format version check — bundle includes Claude Code version fingerprint; import warns on mismatch, never blocks
- `cmemmov completion` — shell completion scripts for bash, zsh, fish, and PowerShell (final epic)

**Nice-to-Have (ship with v1 if time permits, won't block release):**

- Colored terminal output
- Incremental progress display for large exports

### Growth (Post-MVP)

- Named snapshots: `cmemmov snapshot save <name>` / `cmemmov snapshot restore <name>`
- Encryption of export bundle (opt-in, for public dotfiles repos)
- `cmemmov update` self-update command
- `cmemmov diff <file>` — compare bundle against current machine state

### Vision (Future)

- Community bundle registry
- Integration into Anthropic's official Claude Code migration documentation
- Continuous sync mode (lockfile-safe design)

### Scoping Risks

**Ambiguous slug decoding:** Path resolution reads `cwd` from session JSONL as the authoritative original path, never relying on slug character reversal. For memory-only projects with no sessions, fallback presents the decoded slug to the user for manual confirmation.

**Claude Code format changes:** Acceptable. The format version fingerprint enables detection; the inspectable JSON format makes updates fast. No timeline pressure.

## User Journeys

### Journey 1: Alex — New Laptop, Same OS

**Opening Scene:** Alex is a backend engineer who's been using Claude Code daily for eight months. He's built up a rich working environment: global memories about his coding preferences, project memories across a dozen repos, a CLAUDE.md with team conventions, several MCP server configs, and custom commands he uses every day. His new laptop arrives on a Friday afternoon. He's dreading what he knows is coming — the weekend of setup.

**Rising Action:** He searches "how do I move Claude Code to new laptop" and finds `cmemmov`. He runs `npm install -g cmemmov` on his old machine, then `cmemmov export`. An interactive menu walks him through categories: global memories ✓, project memories ✓, settings ✓, MCP config ✓, teams ✓, commands ✓. He deselects session history to keep the bundle small. The export takes three seconds and produces `claude-export-2026-05-09.cmemmov`. He drops it in his shared drive.

**Climax:** On the new laptop, he runs `cmemmov import claude-export-2026-05-09.cmemmov`. The tool reports: "Backing up current ~/.claude/ to ~/.claude/backups/pre-import-2026-05-09-143022/ — backup path saved." Then it walks him through each project: "This project was at `C:\git\my-app` — found matching directory at same path. ✓ Auto-confirmed." Twelve projects resolve automatically. One — an old repo he hasn't cloned yet — he marks "skip for now." Import completes in under a minute.

**Resolution:** Alex opens Claude Code on the new machine. His memories are there. His MCP servers connect. His custom commands work. He's back to full productivity before dinner. The skipped project he'll fix with `cmemmov fix-paths` once he clones it next week.

*Capabilities revealed: export interactive menu, selective category/project selection, import with auto-path matching, auto-backup before import, skip-project option.*

---

### Journey 2: Maya — Windows to macOS Cross-OS Migration

**Opening Scene:** Maya is an AI engineer who has spent six months building up a Claude Code setup on her Windows work machine — detailed global memories, project-specific context for five active repos, a finely tuned settings.json with custom permission rules pointing to `C:\agents\`. She just got a MacBook Pro for travel work and wants her full Claude Code environment on it.

**Rising Action:** She exports on Windows: `cmemmov export --output maya-config.cmemmov`. On the Mac, she runs `cmemmov import maya-config.cmemmov`. The tool detects the platform mismatch immediately: "Export source: win32. Current platform: darwin. Path remapping required." For each project it shows the original Windows path and asks for the macOS equivalent — auto-suggesting `/Users/maya/agents/` when it finds that directory exists. She confirms or corrects each suggestion. For permissions in settings.json containing `Read(C:\agents\**)`, the tool proposes `Read(/Users/maya/agents/**)` and she confirms.

**Climax:** One project has a drive letter she no longer uses (`D:\scratch\old-project`). She types "skip" — `cmemmov` notes it in a post-import summary: "1 project skipped — run `cmemmov fix-paths` to associate when ready." The import completes. The tool prints the backup path and a clean summary: 5 projects remapped, 1 skipped, 0 errors.

**Resolution:** Maya opens Claude Code on the Mac. Her global memories load. Her project memories are correctly associated with the newly cloned repos. The permission rules in settings.json are pointing to the right macOS paths. She didn't touch the JSON file once.

*Capabilities revealed: automatic cross-OS detection, per-project guided path remapping, auto-suggestion of matching directories, permission rule remapping in settings.json, skip-project with post-import summary, fix-paths integration.*

---

### Journey 3: Jordan — Repos Cloned to Wrong Paths

**Opening Scene:** Jordan set up a new machine last month using a simple rsync of `~/.claude/`. It mostly worked — but he cloned all his repos under `/home/jordan/work/` instead of his old `/home/jordan/dev/`. Now Claude Code doesn't recognize any of his projects: no memories load, no project settings apply. He has ten projects' worth of memory just sitting in dead slugs.

**Rising Action:** He runs `cmemmov fix-paths`. The tool scans `~/.claude/projects/` and lists every slug it finds alongside the decoded original path. For each one it checks whether that path exists on disk. Jordan sees: "-home-jordan-dev-api-gateway → /home/jordan/dev/api-gateway — NOT FOUND." For each missing project, the tool searches for a directory with the same name anywhere under the home directory and suggests `/home/jordan/work/api-gateway`. Jordan works through the list, confirming auto-suggestions or typing corrections, in about two minutes.

**Climax:** `cmemmov fix-paths` renames the project directories in `~/.claude/projects/`, updates the corresponding entries in `~/.claude.json`, and prints a confirmation: "10 projects remapped. Backup saved to ~/.claude/backups/pre-fixpaths-2026-05-09-091544/."

**Resolution:** Jordan opens Claude Code and navigates to any of his repos. Project memories load. Settings apply. Everything that was there before the rsync is now correctly wired up — without a full export/import cycle.

*Capabilities revealed: fix-paths standalone command, slug decode + directory scan, auto-suggestion of matching repo names, bulk remap with confirmation flow, backup before any write.*

---

### Journey 4: Taylor — Team Onboarding with `cmemmov share`

**Opening Scene:** Taylor leads a platform engineering team of eight. The team has invested in a shared Claude Code baseline: a CLAUDE.md with contribution standards, MCP server definitions for their internal tools, custom commands for their deploy workflow, and a curated set of permission rules. Every time a new engineer joins, Taylor spends 30 minutes walking them through setup. It's consistent enough to be boring, inconsistent enough to cause problems.

**Rising Action:** Taylor runs `cmemmov share --output team-baseline.cmemmov` on their own machine. The tool strips personal data — credentials, personal memory files, machine-specific paths, user-identifying fields — and produces a sanitized bundle containing only the team-relevant artifacts: CLAUDE.md, MCP server definitions, custom commands, and shared permission patterns. Taylor commits `team-baseline.cmemmov` to the team's onboarding repo.

**Climax:** A new hire, Priya, clones the onboarding repo and runs `cmemmov import team-baseline.cmemmov`. The import detects that MCP server paths reference `//internal/toolserver` — a network path that resolves the same way on everyone's machine — and imports without remapping. Priya's Claude Code has the team CLAUDE.md, the shared commands, and the right MCP config in under two minutes.

**Resolution:** Taylor no longer runs the setup walkthrough. The team baseline lives in version control, gets updated when MCP configs change, and new hires are self-serve from day one. When the team adopts a new internal tool, Taylor updates the bundle and commits — everyone can re-import the delta.

*Capabilities revealed: share command, personal data stripping, sanitized bundle output, network path handling, team baseline version control workflow.*

---

### Journey Requirements Summary

| Capability Area | Driven By |
| --- | --- |
| Interactive export menu (category + project selection) | Alex, Maya |
| Auto-backup before any write, reported to user | Alex, Maya, Jordan |
| Import with per-project path remapping UI | Alex, Maya |
| Cross-OS platform detection + path conversion | Maya |
| Permission rule remapping in settings.json | Maya |
| Skip-project option with post-import summary | Maya |
| fix-paths standalone command | Jordan, Alex (deferred) |
| Slug decode + directory auto-suggestion | Jordan |
| share command with personal data stripping | Taylor |
| Sanitized bundle safe for version control | Taylor |
| rollback command | All (recovery path) |

## Domain-Specific Requirements

### Cross-Platform Correctness

All path operations use `os.homedir()` and Node.js `path` module APIs exclusively — no hardcoded separators or platform assumptions. Incorrect path encoding or slug derivation silently orphans project memories; this failure mode is worse than an explicit error.

### Data Integrity

- All import and fix-paths writes must be atomic where possible — write to temp location, then rename; never in-place modification
- A failed mid-import write must not leave a partially applied state; the pre-import backup must remain intact and restorable
- `--dry-run` must leave the filesystem completely unchanged

### Credential Hygiene

- Credentials excluded from all export operations by default; no configuration option to change this default
- When `--include-credentials` is used, a prominent warning is displayed before export proceeds and a warning field is embedded in the bundle
- The `share` command never includes credentials under any circumstance, including when the source bundle was created with `--include-credentials`

### npm Package Security

- No `postinstall` or lifecycle scripts that execute arbitrary code
- Minimal production dependency footprint — prefer Node.js built-ins over npm packages
- All production dependencies pinned to exact versions in `package-lock.json`
- No network calls at runtime except when explicitly invoked by the user

## Innovation & Novel Patterns

### Detected Innovation Areas

**First-mover: Slug-aware Claude Code migration.** Every competing tool treats `~/.claude/projects/` as an opaque directory to be copied. `cmemmov` is the first tool to decode Claude Code's path-slug algorithm (`path.replace(/[:\\/]/g, '-')`) and use it as the basis for automated path remapping. This transforms a manual, error-prone step into a guided, deterministic flow — and makes cross-OS migration tractable for the first time.

**Novel combination: selective migration + path intelligence.** Existing developer configuration tools (dotfiles managers, shell config sync) handle static files. `cmemmov` handles files whose *names* encode machine-specific state. The innovation is treating the path slug as structured data to be decoded and re-encoded, not as a filename to be preserved or ignored.

### Market Context & Competitive Landscape

Research confirms no existing tool covers this gap: `@tawandotorg/claude-sync` (the closest competitor) does all-or-nothing cloud sync with no path remapping; it explicitly fails for cross-OS migrations. The migration pain point is documented in Reddit threads, GitHub issues, and community forums — but the solution space is empty. `cmemmov` enters a confirmed-demand, zero-competition niche.

### Validation Approach

The slug algorithm is deterministic and verified against a live Claude Code installation. Validation milestones:

1. Export + same-machine import round-trip produces identical Claude Code behavior (no data loss, no broken associations)
2. Cross-OS import (Windows bundle → macOS) correctly resolves all project associations without manual edits
3. fix-paths correctly re-associates projects after a directory move, confirmed by Claude Code recognizing the project

### Risk Mitigation

**Risk**: Claude Code changes its slug algorithm in a future release.
**Mitigation**: The format version fingerprint enables detection; the algorithm is simple enough that updates ship quickly. Auto-backup ensures users can always roll back.

**Risk**: Claude Code adds native export/import tooling, making `cmemmov` redundant.
**Mitigation**: This is a success condition, not a failure. Until then, `cmemmov` fills a confirmed gap.

## CLI Tool Specific Requirements

### Command Structure

```text
cmemmov export [options]
cmemmov import <file> [options]
cmemmov fix-paths [options]
cmemmov share [options]
cmemmov rollback [options]
cmemmov completion [shell]
```

| Command | Description |
| --- | --- |
| `export` | Interactive or silent export of `~/.claude/` artifacts to a `.cmemmov` bundle |
| `import <file>` | Interactive or silent import with path remapping; auto-backs up target before writing |
| `fix-paths` | Re-associates existing Claude Code project slugs with new repo locations |
| `share` | Produces a sanitized team bundle stripped of personal data |
| `rollback` | Restores the most recent pre-import backup in one command |
| `completion` | Outputs shell completion script for bash, zsh, fish, or PowerShell |

Global flags on all commands: `--silent`, `--json`, `--dry-run` (where applicable), `--help`.

### Output Formats

**Default (human-readable):** Structured terminal output with section headers, progress indicators, and a post-operation summary. Errors include the affected file path and a plain-English explanation.

**`--json` flag:** Single JSON object emitted to stdout on completion:

```json
{
  "success": true,
  "command": "import",
  "summary": {
    "projectsRemapped": 12,
    "projectsSkipped": 1,
    "categoriesImported": ["globalMemory", "globalSettings", "teams"],
    "backupPath": "C:\\Users\\Josh\\.claude\\backups\\pre-import-2026-05-09-143022"
  },
  "errors": [],
  "warnings": ["Claude Code version mismatch: export=2.1.100, current=2.1.133"]
}
```

Errors write to stderr regardless of output format. Exit codes: `0` = success, `1` = partial success (items skipped), `2` = fatal error (nothing written).

### Config Schema

Purely flag-driven — no persistent config file. All defaults are hardcoded and documented in `--help`. A config file adds hidden state that complicates scripting and debugging; CLI flags are explicit, reproducible, and scriptable.

### Scripting Support

`--silent` disables all interactive prompts. In silent mode, all selection decisions must be specified via flags; any required decision not supplied causes immediate exit with code `2` and a `--json`-formatted error naming the missing flag. Silent mode is all-or-nothing per invocation.

**Example silent export:**

```bash
cmemmov export \
  --silent \
  --output ~/exports/claude-$(date +%Y%m%d).cmemmov \
  --categories global-memory,project-memory,settings,mcp,teams \
  --projects all \
  --json
```

### Implementation Considerations

- **Error messages**: Every error must name the file being operated on, the operation attempted, and a suggested fix. Generic "something went wrong" messages are a bug.
- **Progress feedback**: Long operations print incremental progress to stderr. In `--json` mode, progress goes to stderr as unstructured lines; the final JSON object goes to stdout.

## Functional Requirements

### Export

- **FR1:** User can interactively select which artifact categories to include in an export (global memories, project memories, global settings, project settings, CLAUDE.md files, MCP configuration, custom commands, teams, plugins, session history)
- **FR2:** User can interactively select which individual projects to include in an export, independent of category selection
- **FR3:** User can export all projects and all categories without making individual selections
- **FR4:** Session history is excluded from exports by default; user can explicitly opt it in
- **FR5:** Credentials are excluded from exports by default; user can explicitly opt them in with acknowledgment of the security implications
- **FR6:** The system produces a single portable `.cmemmov` JSON bundle file as the export artifact
- **FR7:** User can specify the output file path and name for the export bundle

### Import & Path Remapping

- **FR8:** User can import a `.cmemmov` bundle file onto any supported target machine
- **FR9:** The system automatically detects when the export source OS and current OS differ and initiates a guided path remapping flow
- **FR10:** User can review, confirm, or override path remapping suggestions for each project individually during import
- **FR11:** The system auto-suggests new target paths by searching for directories matching the original project name on the current machine
- **FR12:** User can skip individual projects during import; skipped projects are listed in the post-import summary with instructions to re-associate later
- **FR13:** User can choose, per category, whether to merge imported data with existing Claude Code data or overwrite it
- **FR14:** User can preview all changes an import will make without writing anything to disk
- **FR15:** The system remaps absolute paths embedded in permission rules within settings.json files during import
- **FR16:** The system remaps absolute paths embedded in `.claude.json` global state fields during import

### Backup & Rollback

- **FR17:** The system automatically creates a timestamped backup of the target `~/.claude/` state before any import write
- **FR18:** The system reports the backup location to the user before import begins
- **FR19:** User can restore the most recent pre-import backup with a single command

### Path Repair

- **FR20:** User can re-associate existing Claude Code project slugs with new repository locations without performing a full export/import cycle
- **FR21:** The system scans `~/.claude/projects/`, displays each slug with its decoded original path, and indicates whether that path currently exists on disk
- **FR22:** The system auto-suggests new paths for missing projects by searching for matching directory names on the current machine
- **FR23:** User can confirm, override, or skip each path remapping suggestion during path repair; a backup is created before any directory is renamed

### Team Sharing

- **FR24:** User can produce a sanitized team bundle that strips personal data — credentials, personal memory files, machine-specific paths, and user-identifying fields
- **FR25:** The sanitized team bundle retains team-relevant artifacts: CLAUDE.md files, MCP server definitions, custom commands, and shared permission patterns
- **FR26:** User can import a team bundle to bootstrap a consistent Claude Code baseline on a new machine

### Bundle Format & Compatibility

- **FR27:** The export bundle records the original absolute path for every included project, independent of slug encoding
- **FR28:** The export bundle includes a Claude Code version fingerprint derived from installed Claude Code
- **FR29:** The system warns the user during import when the source and target Claude Code versions differ significantly; import is not blocked
- **FR30:** The export bundle is human-readable JSON inspectable and editable in any text editor

### CLI Interface & Scripting

- **FR31:** User can run any command in non-interactive mode using CLI flags, with no prompts
- **FR32:** User can request machine-parseable JSON output from any command; the result object is emitted to stdout on completion
- **FR33:** All commands report errors to stderr with the affected file path, the attempted operation, and a plain-English suggested fix
- **FR34:** All commands exit with a standardized code: `0` = success, `1` = partial success (items skipped), `2` = fatal error (nothing written)
- **FR35:** User can generate shell completion scripts for bash, zsh, fish, and PowerShell
- **FR36:** The system emits incremental progress to stderr during long-running operations so users can confirm the tool is active

## Non-Functional Requirements

### Performance

- **NFR1:** `cmemmov` starts and displays its first output within 500ms on any supported platform
- **NFR2:** Export and import of a typical Claude Code installation (up to 20 projects, no session history) completes within 10 seconds
- **NFR3:** Export and import including session history completes within 60 seconds for installations up to 500MB of session data
- **NFR4:** `--dry-run` completes in the same time as the equivalent live operation — it is a read-only preview, not a slower simulation

### Security

- **NFR5:** Credentials (`.credentials.json`) are never written to the export bundle unless `--include-credentials` is explicitly passed — enforced in code, not just documentation
- **NFR6:** The `share` command never includes credentials under any circumstance, regardless of flags passed
- **NFR7:** `cmemmov` makes zero network calls at runtime — no telemetry, no version checks, no analytics — unless a future opt-in update command is explicitly invoked by the user
- **NFR8:** The export bundle contains no data beyond what the user explicitly selected during the export flow
- **NFR9:** When `--include-credentials` is used, a warning is printed before export proceeds and a warning field is embedded in the bundle itself

### Reliability

- **NFR10:** A fatal error during import must leave the target machine's `~/.claude/` in its pre-import state — partial writes that produce an inconsistent state are not acceptable
- **NFR11:** The auto-backup created before any import or fix-paths operation must be a complete, restorable copy of `~/.claude/` — not a partial or incremental snapshot
- **NFR12:** `--dry-run` must be lossless — running it must leave the filesystem byte-for-byte identical to its state before the command ran
- **NFR13:** All file write operations use atomic patterns (write to temp, rename) where the target filesystem supports it, to prevent partial-write corruption on crash or interruption
- **NFR14:** Any unhandled error produces a non-zero exit code and a human-readable stderr message — no silent failures

### Compatibility

- **NFR15:** `cmemmov` runs on Node.js v22 LTS and above — v18 LTS reached EOL in April 2025; v22 has been in active LTS since October 2024 and provides materially better Node SEA support for the binary distribution path
- **NFR16:** `cmemmov` is explicitly tested on Windows 11, macOS 14 (Sonoma), and Ubuntu 22.04 LTS — CI must cover all three; "should work" is not acceptable
- **NFR17:** Pre-built binaries are published for Windows x64, macOS arm64, macOS x64, and Linux x64 at every release, for users without Node.js in their PATH
- **NFR18:** Path handling uses Node.js `path` and `os` built-ins exclusively — no hardcoded separators or platform-specific string patterns in source code
- **NFR19:** `cmemmov` respects the `CLAUDE_CONFIG_DIR` environment variable to locate the Claude Code directory, matching Claude Code's own resolution behavior
