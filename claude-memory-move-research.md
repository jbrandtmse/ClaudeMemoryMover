<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# I'm getting a new laptop.  How do I move my claude code memories from one machine to another.   Is there any way to share memories between the machines?

You can move Claude Code’s project memories by copying its local data directory to the new laptop, but there is no built‑in, cloud‑style sync of auto memory between machines today.[^1_1][^1_2]

## Where Claude Code stores “memory”

Claude Code keeps project auto‑memory in a per‑project folder under your home directory, not in the cloud.[^1_1]
Each project gets a directory like:

```
- `~/.claude/projects/<project>/memory/` – contains `MEMORY.md` plus topic files; `<project>` is derived from the project’s path or git repo.[^1_1]
```

- Auto memory is explicitly described as “machine‑local” and “files are not shared across machines or cloud environments.”[^1_1]

The general Claude Code state (sessions, history, agents, rules, etc.) also lives under `~/.claude`, and the tool is designed as “local‑first” with no built‑in option to cloud‑save/sync CLI sessions across devices.[^1_3][^1_2]

## One‑time migration to a new laptop

The simplest way to bring your Claude Code memories over is to copy the `~/.claude` directory (or at least the relevant subfolders) from old to new machine.

1. **Locate the state folder on the old machine**
Claude Code stores its state under a hidden `.claude` folder in your home directory, including:
    - `projects/` – session files and auto memory per project.
    - `history.jsonl` – command history.
    - `agents/`, `skills/`, `plugins/`, `rules/`, `settings.json`, `CLAUDE.md`.[^1_3][^1_1]
2. **Copy the directory to the new machine**
    - Install Claude Code on the new laptop and run it once so it creates its own `~/.claude`.
    - Quit any running Claude/terminal sessions on both machines to avoid lockfile issues (general best practice, also mentioned as a concern when people try to sync this folder).[^1_2]
    - Copy `~/.claude` from the old machine to the new one (via `rsync`, `scp`, external drive, etc.), merging carefully so you do not overwrite any new sessions you may already have created on the new box. A similar “copy session files without clobbering new ones” pattern is recommended in migration guides.[^1_4][^1_3]
3. **Mind absolute paths for project memories**
Project memory directories under `~/.claude/projects/` are named from the project’s absolute path, e.g. `/Users/you/dev/my-app` → `~/.claude/projects/-Users-you-dev-my-app/memory/`.[^1_3][^1_1]
If the repo lives under a *different* path on the new laptop, Claude Code will treat it as a different project and won’t automatically reuse the old memory, because the path‑derived key no longer matches.[^1_3][^1_1]
If you want memories to line up seamlessly, keep the same directory layout (e.g., clone repos to the same paths) across machines.[^1_3][^1_1]

## Ongoing sharing/sync between machines

There is no official, built‑in cross‑device memory sync for Claude Code: auto memory is machine‑local by design and not automatically shared across machines or cloud environments.[^1_2][^1_1]
That said, you have a few workable patterns:

### 1. Sync `~/.claude` with a dedicated tool

An open‑source CLI called **Claude Sync** is built specifically to synchronize `~/.claude` across devices using encrypted cloud storage.[^1_3]

- It encrypts the contents of `~/.claude` with age and syncs to S3/R2/GCS, then lets you `claude-sync pull` at the start of a session and `claude-sync push` at the end.[^1_3]
- It explicitly syncs `projects/`, `history.jsonl`, `agents/`, `skills/`, `plugins/`, `rules/`, `settings.json`, and `CLAUDE.md`, i.e., everything Claude Code stores locally.[^1_3]
- Limitation: there is still **no path‑remapping logic**, so sessions remain keyed by absolute path; differing repo locations across machines will still fragment project histories even though the files are present.[^1_3]

This is safer than ad‑hoc Dropbox/OneDrive syncing, which some users report can corrupt lockfiles or local databases when the folder is live‑synced while in use.[^1_2]

### 2. Point auto memory at a shared directory

Claude Code lets you change where auto memory is stored via the `autoMemoryDirectory` setting in `~/.claude/settings.json` (user‑level, not project‑level).[^1_5][^1_1]

- You can set `autoMemoryDirectory` to an absolute path (the docs specifically recommend *not* relying on `~/` because it can fail silently).[^1_5][^1_1]
- If you point this to a folder *inside* a git repo or a synced directory, and then sync/commit that directory between machines, you effectively get shared auto‑memory files (`MEMORY.md` plus topic files) across machines, albeit in an unofficial way.[^1_5][^1_1]
- The same caveats apply about using identical absolute paths or adding symlinks so `autoMemoryDirectory` resolves identically everywhere.[^1_5]


### 3. Use project‑local `CLAUDE.md` as shared “instructions memory”

Separate from auto memory, Claude Code supports **project‑specific memory** via `CLAUDE.md` inside a `.claude` folder in your repo, which is meant to be checked into version control and shared with teammates.[^1_6]

- A project `.claude/CLAUDE.md` holds coding standards, project instructions, and other context; it lives alongside your code and naturally syncs via git between machines.[^1_6]
- The `/memory` command shows which `CLAUDE.md` and related rule files are active and can open them in your editor for editing.[^1_1]

In practice, a lot of people treat project auto memory as “nice to have” and rely on `.claude/CLAUDE.md` plus the repository itself (and Claude’s large context window) as the portable, source‑of‑truth memory across devices.[^1_6][^1_2][^1_1]

### 4. External MCP memory server (for global preferences)

For truly cross‑machine, long‑term preferences and behavioral patterns, you can run a **Memory MCP server** or similar knowledge‑graph MCP that Claude Code queries regardless of local chat history.[^1_7][^1_2]

- These MCP servers maintain a persistent memory database independent of the local `.claude` folder, and you can connect to the same server from multiple machines.[^1_7]
- Users specifically mention using such an MCP layer to keep preferences consistent “even if the local chat history is cleared” or when switching devices.[^1_2]

***

If you tell me your OSes (e.g., macOS → macOS, macOS → Linux, Windows → WSL) and whether you’re comfortable pointing `autoMemoryDirectory` into a repo, I can sketch a concrete set of commands (rsync/ssh/git + minimal config) tailored to your setup.
<span style="display:none">[^1_10][^1_11][^1_12][^1_13][^1_14][^1_15][^1_16][^1_8][^1_9]</span>

<div align="center">⁂</div>

[^1_1]: https://code.claude.com/docs/en/memory

[^1_2]: https://www.reddit.com/r/ClaudeAI/comments/1sed97e/claude_code_for_windows_sync_across_devices/

[^1_3]: https://dev.to/tawanorg/claude-sync-sync-your-claude-code-sessions-across-all-your-devices-simplified-49bl

[^1_4]: https://www.vincentschmalbach.com/migrate-claude-code-sessions-to-a-new-computer/

[^1_5]: https://www.reddit.com/r/ClaudeCode/comments/1s2o9c6/automemory_internals_across_every_claude_code/

[^1_6]: https://www.reddit.com/r/ClaudeAI/comments/1mb5xlc/can_claude_codes_global_memory_location_be/

[^1_7]: https://lobehub.com/nl/mcp/randall-gross-claude-memory-mcp

[^1_8]: https://www.perplexity.ai/hub/blog/the-ai-is-the-computer

[^1_9]: https://support.claude.com/en/articles/12123587-import-and-export-your-memory-from-claude

[^1_10]: https://www.reddit.com/r/ClaudeAI/comments/1m7ca55/anyone_else_using_claude_code_across_multiple_pcs/

[^1_11]: https://www.facebook.com/groups/claudeaicommunity/posts/1243552301145268/

[^1_12]: https://github.com/anthropics/claude-code/issues/25739

[^1_13]: https://www.zdnet.com/article/switch-to-claude-ai-import-memories-preferences/

[^1_14]: https://www.youtube.com/watch?v=Hz5V8NYEsLU

[^1_15]: https://www.tomsguide.com/ai/claude-just-unlocked-memory-that-syncs-with-chatgpt-heres-how-it-works

[^1_16]: https://github.com/anthropics/claude-code/issues/25947

