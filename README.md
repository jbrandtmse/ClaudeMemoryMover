# cmemmov — ClaudeMemoryMover

> **🚧 Coming Soon** — This project is currently in the planning phase. See the [Product Brief](_bmad-output/planning-artifacts/product-brief-ClaudeMemoryMover.md) for the full vision and scope.

A CLI utility for migrating your [Claude Code](https://claude.ai/code) memories, settings, and configuration between machines — with intelligent cross-OS path remapping and no cloud dependency required.

---

## The Problem

Claude Code stores everything locally. Your custom memories, workflow rules, MCP server configs, CLAUDE.md files, and months of project context all live in `~/.claude/` with no built-in way to move them. Getting a new laptop, switching operating systems, or working across multiple machines means starting from scratch — or attempting a fragile manual copy that silently breaks because Claude Code encodes project paths into directory names.

## What's Coming

- **Interactive export** — multi-select menu to choose exactly what to export (memories, settings, CLAUDE.md rules, MCP config, teams, plugins, and more)
- **Intelligent import** — automatically detects path differences between machines and walks you through remapping them; handles Windows ↔ macOS ↔ Linux migrations
- **`cmemmov share`** — strip personal data and produce a sanitized bundle for team onboarding or dotfiles repos
- **`cmemmov fix-paths`** — re-associate existing Claude Code data with repos you've cloned to new locations
- **Silent/CLI mode** — full feature parity via flags for scripting and automation
- **No cloud required** — export to a single portable JSON file, transfer however you like

## Installation (Coming Soon)

```sh
npm install -g cmemmov
```

Pre-built binaries for Windows, macOS, and Linux will be available on [GitHub Releases](../../releases).

## Usage (Coming Soon)

```sh
# Export your Claude Code data
cmemmov export

# Import on a new machine (with dry-run preview)
cmemmov import --dry-run backup.cmemmov
cmemmov import backup.cmemmov

# Fix paths after cloning repos to new locations
cmemmov fix-paths

# Create a sanitized team config bundle
cmemmov share
```

## Documentation

- [Product Brief](_bmad-output/planning-artifacts/product-brief-ClaudeMemoryMover.md) — vision, scope, and differentiators
- [Technical Research](_bmad-output/planning-artifacts/research/technical-claude-code-migration-research-2026-05-08.md) — Claude Code data structure reference, competitive landscape, archive format analysis

## Contributing

Not yet accepting contributions — the project is pre-implementation. Watch this repo or star it to follow progress.

## License

MIT
