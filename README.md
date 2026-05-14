# cmemmov — ClaudeMemoryMover

[![npm version](https://img.shields.io/npm/v/cmemmov.svg)](https://www.npmjs.com/package/cmemmov)
[![CI](https://img.shields.io/github/actions/workflow/status/jbrandtmse/ClaudeMemoryMover/ci.yml?branch=main)](https://github.com/jbrandtmse/ClaudeMemoryMover/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A CLI utility for migrating your [Claude Code](https://claude.ai/code) memories, settings, and configuration between machines — with intelligent cross-OS path remapping, a sanitized team-sharing mode, and no cloud dependency required.

---

## The Problem

Claude Code stores everything locally. Your custom memories, workflow rules, MCP server configs, CLAUDE.md files, and months of project context all live in `~/.claude/` with no built-in way to move them. Getting a new laptop, switching operating systems, or working across multiple machines means starting from scratch — or attempting a fragile manual copy that silently breaks because Claude Code encodes absolute project paths into directory names.

`cmemmov` solves this by understanding Claude Code's internal structure, translating paths during migration, sanitizing personal data for team sharing, and giving you full control over what moves and what stays.

---

## Install

### Option A — npm (requires Node.js ≥ 22)

```sh
npm install -g cmemmov@next
cmemmov --version
```

> The `@next` dist-tag is used while cmemmov is on the 0.x line. Once 1.0 ships, the plain `npm install -g cmemmov` (`@latest`) will resolve to the same release. See [docs/contributing.md](docs/contributing.md#what-npm-publish-does) for the dist-tag policy.

### Option B — pre-built binary (no Node.js required)

Single-file binaries for Windows, macOS, and Linux are attached to every [GitHub Release](https://github.com/jbrandtmse/ClaudeMemoryMover/releases/latest):

| Platform | Arch  | Binary                         |
| -------- | ----- | ------------------------------ |
| Windows  | x64   | `cmemmov-windows-x64.exe`      |
| macOS    | arm64 | `cmemmov-macos-arm64`          |
| macOS    | x64   | `cmemmov-macos-x64`            |
| Linux    | x64   | `cmemmov-linux-x64`            |

Download, drop on `PATH`, run. See [docs/install-binary.md](docs/install-binary.md) for the full download, verification, and per-platform first-run instructions — including the macOS Gatekeeper workaround below.

---

## **Important: close Claude Code before running cmemmov**

> Before running any `cmemmov` command that writes (`import`, `fix-paths`, `rollback`), **quit Claude Code — CLI sessions, the IDE extension, AND the desktop app** — to avoid `EBUSY`/`EPERM` errors on locked session files. Reads (`export`, `share`) can also fail with the same errors when Claude Code holds a session JSONL open. cmemmov detects the busy-file case and surfaces a structured error with `code: 'INTERNAL'` and `hint: 'close Claude Code and retry'`.

### macOS Gatekeeper note (binary users)

The macOS binaries are ad-hoc signed (not Developer-ID notarized) for v0.x. The first time you run a downloaded macOS binary, remove the quarantine flag:

```sh
xattr -d com.apple.quarantine ./cmemmov-macos-arm64
./cmemmov-macos-arm64 --version
```

Apple Developer ID signing is tracked as a v1.0 milestone — see [Known Limitations](#known-limitations).

---

## Commands

`cmemmov` ships six commands. Every command supports the global flags below.

| Flag | Description |
| --- | --- |
| `--silent` | Suppress interactive prompts; all decisions must be provided via flags |
| `--json` | Emit machine-readable JSON to stdout instead of human-readable output |
| `--dry-run` | Simulate all writes without touching the filesystem |
| `-V, --version` | Print the version and exit |
| `--help` | Print help for the current command |

### `export` — Back up your Claude Code environment

Writes your Claude Code data to a portable `.cmemmov` bundle file. Credentials and session history are excluded by default.

```sh
cmemmov export
cmemmov export --categories all --all-projects --output ~/backups/claude.cmemmov
```

Common flags: `--categories <list>` (skip the picker), `--all-projects`, `--include-sessions`, `--include-credentials`.

### `import` — Restore a bundle onto this machine

Reads a `.cmemmov` bundle and merges (or overwrites) into `~/.claude/`. Creates a timestamped backup before writing.

```sh
cmemmov import backup.cmemmov
cmemmov import backup.cmemmov --remap "/Users/alex=/C:/Users/alex"   # macOS → Windows
```

Common flags: `--mode merge|overwrite|overwrite=<category>`, `--remap <source=target>` (repeatable), `--no-integrity-check`.

### `fix-paths` — Re-associate projects with new locations

Scans `~/.claude/projects/` for slug directories whose decoded paths no longer exist on disk, then interactively (or via `--remap`) points them at the new locations and patches `.claude.json`.

```sh
cmemmov fix-paths
cmemmov fix-paths --remap "/home/jordan=/home/jordan2" --silent
```

Common flags: `--remap <source=target>` (repeatable).

See [docs/path-remapping.md](docs/path-remapping.md) for how the path engine works and four worked user journeys.

### `share` — Export a sanitized team bundle

Produces a `.cmemmov` bundle with personal data stripped, suitable for sharing with teammates or checking into a dotfiles repo. Credentials, session history, personal memory files, home-directory permission rules, local MCP servers, and user-identifying `.claude.json` fields are all removed. Team configs, custom commands, network MCP servers, and team plugins are preserved.

```sh
cmemmov share
cmemmov share --categories teams,customCommands --output ./team-baseline.cmemmov
```

Common flags: `--categories <list>`, `--include-pattern <glob>` (repeatable; add to personal-filename patterns), `--exclude-pattern <glob>` (repeatable; remove from stock patterns).

See [docs/bundle-format.md](docs/bundle-format.md) for what `share` strips, what it preserves, and the `team-baseline` profile schema.

### `rollback` — Undo the last import or fix-paths

Restores `~/.claude/` from the most recent pre-operation backup. Pass `--backup <path>` to roll back to a specific backup directory instead of the most recent.

```sh
cmemmov rollback
cmemmov rollback --backup ~/.claude/backups/cmemmov-backup-2026-05-09T14-32-00
```

### `completion` — Shell tab completion

Generates a shell completion script for bash, zsh, fish, or PowerShell. On POSIX shells the shell is auto-detected from `$SHELL`; on Windows you must specify `powershell` explicitly.

```sh
# One-shot for current bash session:
eval "$(cmemmov completion bash)"

# Persistent install:
cmemmov completion bash >> ~/.bashrc
cmemmov completion zsh > "${fpath[1]}/_cmemmov"
cmemmov completion fish > ~/.config/fish/completions/cmemmov.fish

# PowerShell — append to your $PROFILE:
cmemmov completion powershell | Out-String | Invoke-Expression
```

---

## Cross-OS Migration

When moving between macOS, Linux, and Windows, the home-directory shape differs (`/Users/<u>` vs `/home/<u>` vs `C:\Users\<u>`). Pass `--remap` to translate paths during import or `fix-paths`:

```sh
cmemmov import backup.cmemmov --remap "/Users/alex=/C:/Users/alex"        # macOS → Windows
cmemmov import backup.cmemmov --remap "/home/alex=/Users/alex"            # Linux → macOS
cmemmov import backup.cmemmov \
  --remap "/old/projects=/new/projects" \
  --remap "/old/work=/new/work"
```

In interactive mode, `cmemmov` detects path mismatches automatically and offers guided remap prompts without flags. See [docs/path-remapping.md](docs/path-remapping.md) for the full engine reference.

---

## Known Limitations

Three documented limitations apply to the v0.x release line. Each has a concrete remediation:

**1. Large session-history bundles may approach Node memory limits at v1 scale.**
*Remediation:* rely on the default exclusion of session history for routine migrations; reserve `--include-sessions` for installations with under ~500 MB of session data. Streaming JSONL parse is post-v1.

**2. macOS binaries use ad-hoc signing in v0.x — Gatekeeper will quarantine on first run.**
*Remediation:* run `xattr -d com.apple.quarantine ./cmemmov-macos-<arch>` before first execution. Proper Apple Developer ID signing is a v1.0 milestone (tracked in [`deferred-work.md`](_bmad-output/implementation-artifacts/deferred-work.md)).

**3. Close Claude Code before running cmemmov.** Both reads (session JSONL) and writes (any `~/.claude/` file held open) can fail with `EBUSY`/`EPERM`.
*Remediation:* quit Claude Code (CLI sessions, IDE extension, and desktop app) before invoking any `cmemmov` command that writes. `claude-reader` detects the busy-file case and surfaces this guidance as a structured error with `code: 'INTERNAL'` and `hint: 'close Claude Code and retry'`.

---

## Bundle Format

Bundles are self-contained `.cmemmov` files (JSON with a SHA-256 integrity checksum). They are:

- **Portable** — transfer via USB, cloud storage, email, or any file transfer method
- **Human-readable** — plain JSON; you can inspect or edit them with any text editor
- **Integrity-checked** — import verifies the checksum before writing anything
- **Credential-free by default** — credentials are excluded unless you pass `--include-credentials`

For the full schema (top-level fields, per-project entries, the `team-baseline` profile, the `wasRedacted` record), see [docs/bundle-format.md](docs/bundle-format.md).

---

## What works today

- [x] `export` — interactive and scripted, all categories, project selection
- [x] `import` — merge and overwrite modes, cross-OS `--remap`, integrity check
- [x] `fix-paths` — interactive remap, scripted prefix remap, dry-run
- [x] `rollback` — restore from latest or specific backup
- [x] `share` — sanitized team bundles with the `strip-personal` profile
- [x] `completion` — bash, zsh, fish, PowerShell
- [x] Pre-built binaries for Windows x64, macOS arm64, macOS x64, Linux x64

Tests run on Windows, macOS, and Linux in CI — see the CI badge above for current status.

Please report bugs and feedback at [GitHub Issues](https://github.com/jbrandtmse/ClaudeMemoryMover/issues).

---

## Roadmap

| Epic | Title | Status |
| --- | --- | --- |
| Epic 1 | Foundation & Same-OS Migration | Done |
| Epic 2 | Cross-OS Migration & Path Intelligence | Done |
| Epic 3 | `fix-paths` — Path Repair Standalone Command | Done |
| Epic 4 | Team Sharing & Sanitization (`share` command) | Done |
| Epic 5 | Distribution, Shell Completion & Release Polish | In progress |

**Toward 1.0:** Apple Developer ID signing for macOS binaries, streaming session-history parse, and a small set of hardening items tracked in [`deferred-work.md`](_bmad-output/implementation-artifacts/deferred-work.md).

---

## Documentation

| Doc | What it covers |
| --- | --- |
| [docs/bundle-format.md](docs/bundle-format.md) | The `.cmemmov` JSON schema, the `team-baseline` profile, and the `strip-personal` contract |
| [docs/path-remapping.md](docs/path-remapping.md) | How the path engine resolves slugs and remaps paths across OSes — four worked examples |
| [docs/slug-algorithm.md](docs/slug-algorithm.md) | Claude Code's slug encoding (`path.replace(/[:\\/]/g, '-')`), lossless vs lossy cases, fallback strategy |
| [docs/install-binary.md](docs/install-binary.md) | Downloading, verifying, and installing the pre-built binaries on each platform |
| [docs/contributing.md](docs/contributing.md) | Dev environment setup, npm scripts, branching, ESLint architectural rules, and the release flow |

---

## Building from source

If you want to hack on cmemmov instead of installing it, see [docs/contributing.md](docs/contributing.md) for the full dev environment setup. The short version:

```sh
git clone https://github.com/jbrandtmse/ClaudeMemoryMover.git
cd ClaudeMemoryMover
npm install
npm run build
node dist/cmemmov.js --help
```

---

## License

MIT — see [LICENSE](LICENSE).
