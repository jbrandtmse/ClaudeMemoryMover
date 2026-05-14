# cmemmov — ClaudeMemoryMover

A CLI utility for migrating your [Claude Code](https://claude.ai/code) memories, settings, and configuration between machines — with intelligent cross-OS path remapping and no cloud dependency required.

> **Alpha / Early Adopter Build** — Core export, import, and path-repair workflows are complete and tested. Executables are not yet distributed; see [Building from Source](#building-from-source) below.

---

## The Problem

Claude Code stores everything locally. Your custom memories, workflow rules, MCP server configs, CLAUDE.md files, and months of project context all live in `~/.claude/` with no built-in way to move them. Getting a new laptop, switching operating systems, or working across multiple machines means starting from scratch — or attempting a fragile manual copy that silently breaks because Claude Code encodes absolute project paths into directory names.

`cmemmov` solves this by understanding Claude Code's internal structure, translating paths during migration, and giving you full control over what moves and what stays.

---

## Prerequisites

| Requirement | Version |
| --- | --- |
| Node.js | ≥ 22.0.0 |
| npm | comes with Node.js |
| Git | any recent version |

Download Node.js 22+ from [nodejs.org](https://nodejs.org/).

---

## Download a binary (no Node.js required)

Pre-built single-file binaries for Windows x64, macOS arm64, macOS x64, and
Linux x64 are produced by CI for every release. See
[`docs/install-binary.md`](docs/install-binary.md) for download, macOS
Gatekeeper handling, and per-platform first-run notes.

> Until Story 5.3 wires the GitHub Releases upload step, build a local
> binary with `npm run build && npm run build:binary` — it lands at
> `dist/binaries/cmemmov-<platform>-<arch>(.exe)?`.

## Building from Source

```sh
# 1. Clone the repository
git clone https://github.com/joshuabrandt/ClaudeMemoryMover.git
cd ClaudeMemoryMover

# 2. Install dependencies
npm install

# 3. Build the distributable
npm run build
# Output: dist/cmemmov.js
```

### Running after building

#### Option A — invoke directly (no install)

```sh
node dist/cmemmov.js --help
node dist/cmemmov.js export
node dist/cmemmov.js import my-backup.cmemmov
```

#### Option B — link globally (use `cmemmov` anywhere)

```sh
npm link
cmemmov --help
```

To unlink later: `npm unlink -g cmemmov`

### Development mode (watch + rebuild on save)

```sh
npm run dev
```

### Verifying the build

```sh
npm run check        # lint + typecheck + all tests
npm run test         # tests only
npm run typecheck    # TypeScript checks only
```

All 469 tests must pass on a clean build.

---

## Commands

### Global Flags

These flags apply to every command:

| Flag | Description |
| --- | --- |
| `--silent` | Suppress interactive prompts; all decisions must be provided via flags |
| `--json` | Emit machine-readable JSON to stdout instead of human-readable output |
| `--dry-run` | Simulate all writes without touching the filesystem |
| `-V, --version` | Print the version and exit |
| `--help` | Print help for the current command |

---

### `export` — Back up your Claude Code environment

Exports your Claude Code data to a portable `.cmemmov` bundle file.

```sh
cmemmov export [options]
```

Running without options launches an interactive menu to select categories and projects.

| Flag | Description |
| --- | --- |
| `--categories <list>` | Comma-separated category list (e.g. `memories,settings,claudeMd`) or `all`. Accepts camelCase or kebab-case names. Skips the interactive category picker. |
| `--output <path>` | Output file path. Default: `claude-export-YYYY-MM-DD.cmemmov` in the current directory. |
| `--all-projects` | Include all projects without prompting. |
| `--projects <list>` | Comma-separated project slugs to include, or `all`. |
| `--project-path <slug=path>` | Provide the original filesystem path for a memory-only project (one whose directory no longer exists). Repeatable. |
| `--include-credentials` | Include credential data in the bundle (a warning is emitted). Omitted by default. |
| `--include-sessions` | Include session history in the bundle. Omitted by default. |

```sh
# Interactive: pick categories and projects via menus
cmemmov export

# Scripted: export everything to a specific file
cmemmov export --categories all --all-projects --output ~/backups/claude.cmemmov

# Dry-run preview (no file written)
cmemmov export --dry-run --categories memories,claudeMd --all-projects
```

---

### `import` — Restore a bundle onto this machine

Imports a `.cmemmov` bundle, merging or overwriting your current Claude Code data.

```sh
cmemmov import <bundle> [options]
```

`<bundle>` is the path to a `.cmemmov` file produced by `export`.

| Flag | Default | Description |
| --- | --- | --- |
| `--mode <spec>` | `merge` | Write strategy: `merge` (additive), `overwrite` (replace all), or `overwrite=<category>`. |
| `--remap <source=target>` | — | Translate a path prefix during import. Repeatable. See [Cross-OS Migration](#cross-os-migration). |
| `--no-integrity-check` | — | Skip bundle checksum verification. |

```sh
# Basic import with merge (safe default)
cmemmov import backup.cmemmov

# Preview what would change without writing
cmemmov import --dry-run backup.cmemmov

# Cross-OS: Mac → Windows
cmemmov import backup.cmemmov --remap "/Users/alex=/C:/Users/alex"

# Overwrite memories category only, skip other categories
cmemmov import backup.cmemmov --mode overwrite=memories

# Scripted (no prompts)
cmemmov import --silent --mode merge backup.cmemmov
```

---

### `fix-paths` — Re-associate projects with new locations

Scans your Claude Code project data for projects whose directories have moved or been deleted, then interactively or automatically remaps them to their new locations.

This is the right tool when you've cloned repos to different paths, reorganized your home directory, or switched machines without doing a full import.

```sh
cmemmov fix-paths [options]
```

Running without options launches an interactive flow: you'll be shown each broken project and prompted for its new path (with an auto-suggested location when one can be found).

| Flag | Description |
| --- | --- |
| `--remap <source=target>` | Remap projects by path prefix (repeatable). |

Each `--remap` spec has the form `source-prefix=target-prefix`. All projects whose original path starts with the source prefix are automatically remapped to the target prefix. Combine with `--silent` to suppress all interactive prompts.

```sh
# Interactive: review and fix broken project paths one by one
cmemmov fix-paths

# Scripted: remap all projects from old home to new home
cmemmov fix-paths --remap "/home/jordan=/home/jordan2" --silent

# Preview what would be renamed (no writes)
cmemmov fix-paths --dry-run

# JSON output for scripting
cmemmov fix-paths --json --remap "/old/root=/new/root" --silent
```

#### What it does under the hood

1. Reads `~/.claude/projects/` and decodes each directory's slug back to the original path.
2. Reports which projects exist on disk (`FOUND`) and which are missing (`MISSING`).
3. For missing projects, suggests new locations based on `--remap` prefixes or finds candidate directories automatically.
4. Renames the project slug-directory and patches the `.claude.json` `lastSessionCwd` field.
5. Creates a timestamped backup before any write.

---

### `rollback` — Undo the last import or fix-paths

Restores your Claude Code data from the most recent pre-operation backup.

```sh
cmemmov rollback [options]
```

| Flag | Description |
| --- | --- |
| `--backup <path>` | Restore from a specific backup directory. |

If `--backup` is omitted, the most recent backup created by `import` or `fix-paths` is used.

```sh
# Undo the last import or fix-paths
cmemmov rollback

# Restore from a specific backup
cmemmov rollback --backup ~/.claude/backups/cmemmov-backup-2026-05-09T14-32-00
```

---

### `share` — Export a sanitized team bundle

*(Planned — Epic 4)* Produces a bundle with personal data stripped, suitable for sharing with teammates or checking into a dotfiles repo. Running this command currently returns a "not yet implemented" message.

```sh
cmemmov share
```

---

### `completion` — Shell tab completion

*(Planned — Epic 5)* Generates shell completion scripts for bash, zsh, fish, and PowerShell.

```sh
cmemmov completion
```

---

## Cross-OS Migration

When moving from macOS/Linux to Windows (or vice versa), home directory paths change structure. Use `--remap` on `import` or `fix-paths` to translate them automatically:

```sh
# macOS → Windows
cmemmov import backup.cmemmov --remap "/Users/alex=/C:/Users/alex"

# Linux → macOS
cmemmov import backup.cmemmov --remap "/home/alex=/Users/alex"

# Multiple remaps (repeatable flag)
cmemmov import backup.cmemmov \
  --remap "/old/projects=/new/projects" \
  --remap "/old/work=/new/work"
```

`cmemmov` will also detect path mismatches automatically during interactive import and offer guided remapping prompts without any flags.

---

## Bundle Format

Bundles are self-contained `.cmemmov` files (JSON with a checksum). They are:

- **Portable** — transfer via USB, cloud storage, email, or any file transfer method.
- **Human-readable** — plain JSON; you can inspect or edit them with any text editor.
- **Integrity-checked** — import verifies the checksum before writing anything.
- **Credential-free by default** — credentials are excluded unless you pass `--include-credentials`.

---

## Alpha Testing Checklist

If you're an early adopter, these are the workflows that are complete and ready for testing:

- [x] `export` — interactive and scripted, all categories, project selection
- [x] `import` — merge and overwrite modes, cross-OS remap, integrity check
- [x] `fix-paths` — interactive remap, scripted prefix remap, dry-run
- [x] `rollback` — restore from latest or specific backup
- [ ] `share` — planned (Epic 4)
- [ ] shell completion — planned (Epic 5)
- [ ] pre-built binaries — planned (Epic 5)

Please report bugs and feedback at [GitHub Issues](../../issues).

---

## Roadmap

| Epic | Title | Status |
| --- | --- | --- |
| Epic 1 | Foundation & Same-OS Migration | Complete |
| Epic 2 | Cross-OS Migration & Path Intelligence | Complete |
| Epic 3 | `fix-paths` — Path Repair Standalone Command | Complete |
| Epic 4 | Team Sharing & Sanitization (`share` command) | Backlog |
| Epic 5 | Distribution, Shell Completion & Release Polish | Backlog |

### Epic 4 — Team Sharing & Sanitization

- Strip personal data (usernames, local paths, credentials) before sharing
- `cmemmov share` command producing a portable team bundle
- Round-trip integration tests for share → import workflows

### Epic 5 — Distribution & Release Polish

- Shell completion for bash, zsh, fish, and PowerShell
- Single-executable binaries for Windows (x64), macOS (arm64, x64), and Linux (x64) via Node.js SEA
- Tag-triggered release pipeline (GitHub Actions)
- Full documentation site

---

## Documentation

- [Product Brief](_bmad-output/planning-artifacts/product-brief-ClaudeMemoryMover.md) — vision, scope, and differentiators
- [Technical Research](_bmad-output/planning-artifacts/research/technical-claude-code-migration-research-2026-05-08.md) — Claude Code data structure reference

## License

MIT
