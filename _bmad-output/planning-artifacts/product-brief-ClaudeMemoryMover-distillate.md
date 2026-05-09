---
title: "Product Brief Distillate: ClaudeMemoryMover"
type: llm-distillate
source: "product-brief-ClaudeMemoryMover.md"
created: "2026-05-08"
purpose: "Token-efficient context for downstream PRD creation"
---

# Product Brief Distillate: ClaudeMemoryMover (`cmemmov`)

## Core Identity

- **Name**: ClaudeMemoryMover, CLI name `cmemmov`
- **Runtime**: Node.js (chosen because all Claude Code users already have Node installed)
- **Distribution**: `npm install -g cmemmov` + pre-built binaries on GitHub Releases (for users without Node in PATH)
- **License**: Open source (no monetization)
- **Author motivation**: Personal need + resume/portfolio piece (cross-platform Node.js, CLI UX, file parsing, systems-level programming)
- **Success metric**: Personal daily use + 100+ GitHub stars within 6 months

---

## Problem Space

- Claude Code stores all data locally in `~/.claude/` — explicitly "machine-local by design" per Anthropic docs
- No built-in export, sync, or migration tooling
- Project directories are named by encoding the absolute path (`C:\git\myapp` → `C--git-myapp`) — silently breaks when paths differ between machines
- Three pain scenarios: new machine setup, cross-OS migration, multi-machine workflow divergence
- Users currently: lose context, attempt fragile manual `rsync`/copy, or set up cloud sync infrastructure

---

## Technical Ground Truth (Verified on Windows 11, Claude Code v2.1.133)

### Directory Layout

```
~/.claude/                    ← base dir (os.homedir() + '.claude')
  projects/<slug>/            ← per-project data
    <UUID>.jsonl              ← session conversation files
    <UUID>/tool-results/      ← overflow for large tool outputs
    memory/
      MEMORY.md               ← index with frontmatter + markdown links
      <topic>.md              ← individual topic memory files
  backups/                    ← timestamped backups of ~/.claude.json
  cache/                      ← prompt/response caches (skip on export)
  debug/                      ← debug logs (skip)
  file-history/               ← file edit history
  ide/                        ← IDE extension state (VS Code, JetBrains)
  paste-cache/                ← clipboard buffers (skip)
  plans/                      ← plan mode session data
  plugins/
    marketplaces/             ← plugin registry clones
    blocklist.json
    known_marketplaces.json
  session-env/                ← env snapshots (skip)
  sessions/                   ← additional session metadata
  shell-snapshots/            ← shell state (skip)
  statsig/                    ← A/B testing IDs (skip)
  tasks/                      ← task queue (.lock, .highwatermark files)
  teams/
    <name>/
      config.json
      inboxes/<agent>.json
  telemetry/                  ← telemetry (skip)
  todos/                      ← per-agent TODO JSON files
  usage-data/                 ← usage stats (skip)
  .credentials.json           ← OAuth/API token (~471 bytes) — SENSITIVE
  .last-cleanup               ← cleanup watermark
  history.jsonl               ← global command history (was 231KB on test machine)
  mcp-needs-auth-cache.json   ← MCP auth state cache
  settings.json               ← user-editable: permissions, env vars, model
  stats-cache.json            ← cached stats (skip)

~/.claude.json                ← SEPARATE global state file at home root (NOT inside .claude/)
                                 Backed up to ~/.claude/backups/.claude.json.backup.<timestamp>
```

### Project Slug Algorithm (Verified)

- Algorithm: replace all `:`, `\`, `/` with `-`
- `C:\git\ClaudeMemoryMover` → `C--git-ClaudeMemoryMover`
- `/home/user/project` → `-home-user-project`
- **Lossy**: folder names containing `-` become ambiguous on reverse decode — always read original path from session `cwd` field or store it in export metadata, do not rely solely on slug reversal
- Reverse decode heuristic: if slug starts with single letter + `--` → Windows path; if starts with `-` → Unix path

### settings.json Actual Schema

```json
{
  "env": { "KEY": "value" },
  "permissions": { "allow": ["Bash(...)", "Read(...)", "mcp__..."] },
  "model": "sonnet",
  "autoDreamEnabled": true,
  "skipDangerousModePermissionPrompt": true
}
```
- Permissions contain hardcoded absolute paths (e.g. `Read(//c/myagent/**)`) — need remapping on import
- `CLAUDE_CONFIG_DIR` env var overrides the base directory

### Session JSONL Schema

Each line is one of:
- `{"type": "queue-operation", "operation": "enqueue"|"dequeue", "timestamp": "...", "sessionId": "..."}`
- `{"type": "user"|"assistant", "message": {"role": "...", "content": "..."}, "uuid": "...", "parentUuid": "...", "timestamp": "...", "cwd": "C:\\git\\...", "sessionId": "...", "version": "2.1.133", "entrypoint": "claude-vscode", "gitBranch": "HEAD", "isSidechain": false}`

- `cwd` field embeds absolute path — must be remapped if sessions are included in export
- `version` field useful for format version compatibility check

### .claude.json Global State (Key Fields)

Fields worth migrating: `projects` (contains absolute paths), `mcpServers`, `skillUsage`
Fields to skip: `oauthAccount`, `userID`, `anonymousId`, `installMethod`, all `cached*` fields, `statsig*`, feature flag fields, notification state
Fields needing path remap: `projects`, `mcpServers`, `githubRepoPaths`

### Path Resolution per Platform

| Platform | Base Dir | Resolution |
|----------|----------|------------|
| Windows | `%USERPROFILE%\.claude\` | `os.homedir()` → `C:\Users\<user>` |
| macOS | `~/.claude/` | `os.homedir()` → `/Users/<user>` |
| Linux | `~/.claude/` | `os.homedir()` → `/home/<user>` |

- NOT `%APPDATA%` on Windows
- `CLAUDE_CONFIG_DIR` env var overrides on all platforms
- `os.homedir()` is correct; avoid `process.env.HOME` (unreliable on Windows)

---

## Export Categories & Migration Sensitivity

| Category | Files | Path-Sensitive | Default Include |
|----------|-------|----------------|----------------|
| Global memories | `projects/<global-slug>/memory/**` | No (content) | Yes |
| Project memories | `projects/<slug>/memory/**` | Yes (slug = path) | Yes |
| Global settings | `settings.json` | Yes (permissions contain paths) | Yes |
| Project settings | `<project>/.claude/settings.json` | Yes | Yes |
| Global CLAUDE.md | `~/.claude/CLAUDE.md` if exists | No | Yes |
| Project CLAUDE.md | `<project>/.claude/CLAUDE.md` | No | Yes |
| MCP config | `settings.json` mcpServers section | Yes (server paths) | Yes |
| Custom commands | `~/.claude/commands/` if exists | No | Yes |
| Teams | `teams/**` | No | Yes |
| Plugins | `plugins/` | No | Yes |
| Session history | `projects/<slug>/*.jsonl` | Yes (cwd in records) | Optional/off |
| Global state subset | `.claude.json` selected fields | Yes | Yes |
| Credentials | `.credentials.json` | No | **Off** (opt-in only) |

---

## Credential Handling Decision

- `.credentials.json` excluded from export by default
- Must use explicit `--include-credentials` flag to include
- Display a prominent warning when this flag is used
- Rationale: security — credentials should not end up in transfer files or dotfiles repos accidentally

---

## Format Version Compatibility

- Export bundle includes Claude Code version fingerprint (from session JSONL `version` field or detected from binary)
- Import warns if source and target versions differ significantly
- Goal: prevent silent corruption when Claude Code changes its internal format between major versions
- V1 behavior: warn, don't block — user can override

---

## Export Bundle Format

- **Format**: JSON (`.cmemmov` extension or `.cmemmov.gz` when sessions included)
- **Rationale over ZIP/tar.gz**: all data is text, random access needed for selective import, no binary deps, human-readable, natural metadata embedding
- **Optional gzip**: `zlib.gzipSync()` / `zlib.gunzipSync()` — no extra npm deps

```json
{
  "version": "1.0",
  "format": "cmemmov",
  "claudeVersion": "2.1.133",
  "exportedAt": "2026-05-08T23:00:00Z",
  "exportedFrom": {
    "os": "win32",
    "homedir": "C:\\Users\\Josh",
    "claudeDir": "C:\\Users\\Josh\\.claude"
  },
  "categories": {
    "globalSettings": { ... },
    "globalMemory": { "MEMORY.md": "...", "topic.md": "..." },
    "projects": [
      {
        "slug": "C--git-ClaudeMemoryMover",
        "originalPath": "C:\\git\\ClaudeMemoryMover",
        "displayName": "ClaudeMemoryMover",
        "memory": { "MEMORY.md": "...", "topic.md": "..." },
        "settings": { ... },
        "claudeMd": "..."
      }
    ],
    "teams": { ... },
    "mcpServers": [ ... ],
    "plugins": { ... }
  }
}
```

---

## Commands / Modes

| Command | Description |
|---------|-------------|
| `cmemmov export` | Interactive multi-select export |
| `cmemmov import <file>` | Interactive import with path remapping |
| `cmemmov import --dry-run <file>` | Preview changes without writing |
| `cmemmov share` | Sanitized team bundle (strips personal data) |
| `cmemmov fix-paths` | Re-associate existing Claude Code data with new repo locations |
| All commands + `--silent` / CLI flags | Non-interactive mode for scripting |

---

## Path Remapping Logic

- On import: detect `exportedFrom.os !== process.platform` → trigger cross-OS remapping flow
- For each project in bundle: show original path, ask for new path, auto-suggest if matching folder found
- Windows → Unix: strip drive letter, convert `\` to `/`, prepend `os.homedir()`
- Unix → Windows: detect `/home/<user>` prefix, replace with `C:\Users\<user>\`
- Apply remap to: project slug (re-derive), session `cwd` fields, permission rules in `settings.json`, `.claude.json` project entries
- `fix-paths`: standalone utility for post-clone path correction without a full export/import cycle

---

## Share Command Details

- Strips: `.credentials.json`, personal memory files, machine-specific paths, user-identifying data
- Keeps: CLAUDE.md files, MCP server definitions, custom commands, shared permission patterns, team configs
- Use case: team onboarding, open-source project baseline configs, "my dotfiles for Claude Code"
- Output: sanitized `.cmemmov` bundle safe to commit to a repo

---

## Competitive Intelligence

| Tool | Approach | Killer Limitation |
|------|----------|-------------------|
| `@tawandotorg/claude-sync` (npm) | Encrypt + push to S3/R2/GCS, pull on other device | Requires cloud storage; no path remapping; no selective export; broken cross-OS |
| `jahwag/ClaudeSync` (Python) | Sync local files TO Claude.ai projects | One-way, requires Claude Pro; not cross-machine migration |
| `bob6664569/claude-sync` | Unknown | Unknown/unmaintained |
| `azzuwayed/ClaudeSync` | Unknown | Unknown/unmaintained |
| `cshum/claude-sync` | Unknown | Unknown/unmaintained |

**Gap cmemmov fills**: One-time migration with path remapping, no cloud dependency, cross-OS, selective categories, team sharing — nobody does all of these.

---

## Rejected / Deferred Ideas

- **Continuous/scheduled sync**: Deferred to post-v1. Risk of lockfile corruption if `.claude/` is live-synced. Out of scope for one-time migration use case.
- **Encryption of export bundle**: Deferred. Rationale: credentials excluded by default; encryption adds complexity and key management burden for the primary use case. Users who want encryption can use OS-level tools.
- **GUI/TUI interface**: Out of v1. Terminal-only to keep scope tight and avoid framework dependencies.
- **Direct machine-to-machine network transfer**: Out of v1. File transfer is a solved problem; cmemmov provides the file, not the transport.
- **Cloud storage integration**: Out of v1. Defeats the "no cloud dependency" differentiator.
- **MCP Memory Server integration**: Separate product category (persistent cross-machine memory via MCP). Not this tool's scope.

---

## Requirements Hints (Captured During Discovery)

- Interactive menu must support multiselect by category AND individual project selection within categories
- "Silent mode" = all interactive decisions replaced by CLI flags; must be 100% feature-equivalent to interactive mode
- Import merge: combine new memories with existing (don't duplicate); overwrite: replace existing content
- Path remapping UI: show original path, offer auto-suggestion, allow manual entry, allow "skip this project"
- `fix-paths` must handle: different drive letter, different username, different base directory, cross-OS
- Cross-platform: all three OSes must be supported and tested (not just "should work")
- Binaries via GitHub Releases: target at minimum Windows (x64), macOS (arm64 + x64), Linux (x64)
- Node.js version: target LTS (v18+) to match Claude Code's own Node requirement

---

## Open Questions for PRD

- What is the exact minimum Node.js version Claude Code requires? (Determines cmemmov's minimum supported version)
- Should `cmemmov fix-paths` be interactive-only or also support silent mode with `--old-path` / `--new-path` flags?
- For the `share` command: should the output be a named profile (e.g. `--profile team-backend`) or always a single generic bundle?
- Should cmemmov self-update (e.g. `cmemmov update`) or rely entirely on npm/binary releases?
- How should merge conflicts in MEMORY.md be handled — append new entries, deduplicate by heading, or prompt user?
