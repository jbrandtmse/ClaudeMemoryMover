---
status: "complete"
created: "2026-05-08"
updated: "2026-05-08"
inputs:
  - initial-prompt.md
  - claude-memory-move-research.md
  - _bmad-output/planning-artifacts/research/technical-claude-code-migration-research-2026-05-08.md
---

# Product Brief: ClaudeMemoryMover (`cmemmov`)

## Executive Summary

Claude Code is one of the most powerful AI development environments available — but everything it knows about you is trapped on a single machine. Your custom memories, workflow rules, permission settings, MCP server configurations, and months of project context all live in a hidden local directory with no built-in way to move them. When a developer gets a new laptop, switches operating systems, or wants to work across multiple machines, they face an all-or-nothing manual copy that almost always breaks — because Claude Code encodes project paths into directory names that silently stop matching the moment a repository lives in a different location.

`cmemmov` (ClaudeMemoryMover) solves this with a purpose-built CLI that treats Claude Code migration as a first-class problem. It exports your Claude Code data — memories, settings, rules, teams, MCP config, and more — into a single portable file, then intelligently imports it on the target machine, automatically detecting and remapping paths that have changed between machines or operating systems. The whole workflow works without any cloud account, any external service, or any technical knowledge beyond running a command.

## The Problem

A developer who has been using Claude Code for six months has accumulated something genuinely valuable: a personalized AI that knows their preferences, their projects, their permission boundaries, and their workflow. This context lives in `~/.claude/` — a directory that Claude Code populates automatically but never teaches users to protect or move.

The problem surfaces acutely in three scenarios:

- **New machine setup**: Getting a new laptop means starting from scratch, or attempting a fragile manual copy that breaks project associations because path-encoded directory names like `C--git-myproject` don't survive a drive letter or username change.
- **Cross-OS migration**: Moving from Windows to macOS (or vice versa) means every project slug is wrong by definition — there is no manual fix that doesn't require inspecting dozens of directories.
- **Multi-machine workflows**: Working across a home desktop and a work laptop means maintaining two diverging Claude Code configurations with no way to keep them in sync.

The only existing tool (`@tawandotorg/claude-sync`) takes a continuous-sync approach requiring setup of cloud object storage (S3, Cloudflare R2, or GCS), has no path remapping capability, and offers no selective export — it's all-or-nothing and still broken for cross-OS use. Most users simply leave their Claude Code context behind when they change machines.

## The Solution

`cmemmov` is a Node.js CLI installable in seconds (`npm install -g cmemmov`) that handles the full migration lifecycle:

**Export**: An interactive multi-select menu walks the user through what to export — global memories, project-specific memories, global and project settings, CLAUDE.md rules, MCP server configurations, custom commands, teams, plugins, and optionally session history. Credentials (`.credentials.json`) are excluded by default and require an explicit `--include-credentials` opt-in. The bundle includes a format version fingerprint so the importer can warn when the export and target machines are running significantly different Claude Code versions. A single JSON bundle file is produced, human-readable and inspectable in any text editor — making it a natural fit for dotfiles repositories alongside `.gitconfig`, `.zshrc`, and other developer configuration.

**Transfer**: The file goes wherever the user takes it — USB drive, email, AirDrop, cloud storage, dotfiles repo commit, doesn't matter. No accounts required.

**Import**: On the target machine, cmemmov automatically backs up the current `~/.claude/` state before touching anything, then reads the bundle, validates format version compatibility, detects OS and path differences, and presents a remapping interface: "This project was at `C:\git\myapp` — where is it now?" It auto-suggests paths when it can find matches, handles Windows ↔ Unix path conversion, and applies changes across memories, settings, and session metadata consistently. A `--dry-run` flag previews exactly what will change without writing anything. Users choose merge (combine with existing data) or overwrite (replace it) per category.

**Share**: A `cmemmov share` command strips personal data (credentials, personal memories, machine-specific paths) and produces a sanitized bundle containing only team-relevant configuration — CLAUDE.md rules, MCP server definitions, custom commands, and shared permission patterns. Teams can commit this bundle to their repository so new members can bootstrap a consistent Claude Code setup in one command.

**Path fix utility**: A standalone `cmemmov fix-paths` command handles the common case where a developer clones their repos to new locations after the fact and wants to re-associate existing Claude Code data with the new paths — useful even without a full migration.

A `--silent` mode with CLI flags mirrors every interactive workflow for scripting and automation.

## What Makes This Different

**No cloud dependency.** Every competing approach requires setting up object storage or a Claude.ai subscription. cmemmov treats the migration as what it is: a one-time file transfer. The export bundle is self-contained.

**Path remapping is the core feature, not an afterthought.** cmemmov understands how Claude Code encodes paths into directory names and makes fixing them a first-class part of the import flow — the only tool that does this.

**Comprehensive coverage.** Rather than syncing a subset of `~/.claude/`, cmemmov surfaces every meaningful artifact category: memories, settings, rules, MCP config, teams, plugins, commands, and history. Users choose what they want.

**Human-readable exports.** The JSON bundle format is intentionally inspectable. Users can read, edit, or version-control their exported Claude Code configuration — treating it like infrastructure-as-code. Committing a bundle to a dotfiles repository gives developers point-in-time backups and a portable Claude Code config that travels with the rest of their environment.

**Team-shareable from day one.** The `share` command produces a sanitized bundle for team onboarding — a feature no other tool offers. New team members get a consistent Claude Code baseline (shared rules, MCP config, custom commands) in one command instead of piecing it together from a README.

**Cross-OS first.** Windows-to-macOS and macOS-to-Linux migrations are tested and explicitly handled, including drive letter conversion, path separator normalization, and home directory remapping.

## Who This Serves

**Primary**: Software developers who use Claude Code daily across more than one machine, or who periodically get new hardware. They are comfortable in the terminal, value not losing their AI context, and will install an npm package without hesitation.

**Secondary**: Claude Code power users — AI engineers, technical writers, and researchers — who have invested heavily in custom memories and CLAUDE.md configurations they want to protect and replicate.

Both groups share a common aha moment: the first time they realize their carefully built Claude Code context doesn't survive a fresh install — and wish something like cmemmov had existed before they lost it.

## Success Criteria

- **Personal utility**: Solves the author's own migration needs completely; used on every new machine setup going forward.
- **Community traction**: 100+ GitHub stars within 6 months of release, indicating genuine discovery and value by other Claude Code users.
- **Zero-issue migrations**: The path remapping logic handles all common migration scenarios (Windows↔macOS, same-OS new machine, username changes) without manual file editing.
- **Distribution reach**: Available via `npm install -g cmemmov` and as pre-built binaries on GitHub Releases for users without Node.js in their PATH.

## Scope

**In for v1:**
All Claude Code artifact categories: project and global memories, global and project-level settings, CLAUDE.md files (global and per-project), MCP server configurations, custom commands, teams, plugins, and session history (optional, due to size). Interactive and silent modes. Import merge and overwrite options. Path remapping for same-OS and cross-OS migrations. `fix-paths` utility. `share` command for sanitized team bundles. Credentials excluded by default with `--include-credentials` opt-in. Format version compatibility check with warnings. `--dry-run` import preview. Auto-backup of target state before any import. Windows, macOS, and Linux support. npm package + GitHub Releases binaries.

**Out for v1:**
Continuous/scheduled sync between machines, encryption of the export bundle, GUI/TUI interface, cloud storage integration, direct machine-to-machine transfer over network.

## Vision

If successful, cmemmov becomes the default answer to "how do I move my Claude Code setup to a new machine" — referenced in documentation, Reddit threads, and Claude Code community resources. The `share` command lays the groundwork for a community ecosystem of curated configuration bundles: teams publishing their Claude Code standards, open-source projects shipping a `.cmemmov` alongside their README, developers sharing opinionated memory and command setups. The path remapping and format-versioned bundle structure could evolve into a full backup/restore utility, giving users named snapshots they can roll back to — a safety net before major Claude Code upgrades or experimental configuration changes.
