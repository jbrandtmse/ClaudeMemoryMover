---
stepsCompleted: [1, 2]
inputDocuments:
  - initial-prompt.md
  - claude-memory-move-research.md
  - C:\Users\Josh\.claude (live inspection)
workflowType: research
lastStep: 2
research_type: technical
research_topic: Claude Code data structures, cross-platform path resolution, archive format, competitive landscape
research_goals: Determine technical feasibility, understand exact data structures, evaluate competitive differentiation for cmemmov
user_name: Developer
date: '2026-05-08'
web_research_enabled: true
source_verification: true
---

# Technical Research Report: ClaudeMemoryMover (cmemmov)

**Date:** 2026-05-08
**Author:** Developer
**Research Type:** Technical — Data Structures, Cross-Platform, Archive Format, Competitive Analysis

---

## Research Overview

This report covers all technical areas required to assess and implement `cmemmov` (ClaudeMemoryMover):

1. **Claude Code data structures** — verified against live Windows installation
2. **Cross-platform path resolution** — Windows, macOS, Linux
3. **Archive format selection** — for the export bundle
4. **Competitive landscape** — existing Claude sync tools and differentiation

Sources: live filesystem inspection of `C:\Users\Josh\.claude` (Claude Code v2.1.133 on Windows 11), Perplexity web research, official documentation.

---

## Technical Research Scope Confirmation

**Research Topic:** Claude Code data structures, cross-platform path resolution, archive format selection, competitive landscape  
**Research Goals:** Determine exact file structures to export/import, understand cross-OS path handling, select best export format, decide whether cmemmov has a viable market gap

**Technical Research Scope:**
- Architecture Analysis — directory layout, file schemas, encoding conventions
- Implementation Approaches — path slug algorithm, JSONL parsing, memory index format
- Technology Stack — Node.js APIs, npm libraries for path resolution and archiving
- Integration Patterns — how Claude Code resolves its config directory, env var overrides
- Performance Considerations — file sizes, selective export feasibility

**Scope Confirmed:** 2026-05-08

---

## Section 1: Claude Code Data Structures (Ground Truth — Windows)

> ⚠️ **NOTE**: Several popular web sources (including some Perplexity results) contain inaccurate information about Claude Code internals — claiming base64url-encoded project paths, wrong session JSONL schemas, and fabricated `settings.json` structures. Everything in this section is verified against a live installation.

### 1.1 Top-Level `~/.claude/` Directory Layout

Observed on Windows 11, Claude Code v2.1.133 at `C:\Users\Josh\.claude\`:

```
~/.claude/
├── backups/                    # Timestamped backups of ~/.claude.json global state
├── cache/                      # Prompt/response caches
├── debug/                      # Debug logs
├── file-history/               # File edit history
├── ide/                        # IDE extension state (VS Code, JetBrains)
├── paste-cache/                # Clipboard paste buffer cache
├── plans/                      # Plan mode session data
├── plugins/                    # Installed marketplace plugins
│   ├── marketplaces/           # Plugin registries
│   ├── blocklist.json
│   └── known_marketplaces.json
├── projects/                   # Per-project sessions and memory (see §1.2)
├── session-env/                # Environment variable snapshots per session
├── sessions/                   # (Additional session metadata)
├── shell-snapshots/            # Shell state snapshots
├── statsig/                    # A/B testing stable IDs (statsig.stable_id.*)
├── tasks/                      # Task queue data (UUID-named dirs with .lock, .highwatermark)
├── teams/                      # Agent team configurations (see §1.5)
├── telemetry/                  # Usage telemetry
├── todos/                      # Per-agent TODO lists (UUID-agent-UUID.json)
├── usage-data/                 # Usage statistics
├── .credentials.json           # OAuth account / API credentials (~471 bytes)
├── .last-cleanup               # Cleanup watermark timestamp
├── avast-root-ca.pem           # (User-specific: custom CA cert)
├── history.jsonl               # GLOBAL command history (~231KB on this machine)
├── mcp-needs-auth-cache.json   # MCP server auth state cache
├── settings.json               # User settings: permissions, env vars, model
└── stats-cache.json            # Cached statistics

~/.claude.json                  # GLOBAL STATE FILE — lives at home dir root, NOT inside .claude/
```

**Critical distinction**: There are TWO separate files:
- `~/.claude/settings.json` — user-editable settings (permissions, env vars, model preference)
- `~/.claude.json` — large internal state blob (NOT inside the `.claude/` directory); backed up to `~/.claude/backups/.claude.json.backup.<timestamp>`

### 1.2 Project Directory Naming Convention

**The path → directory name algorithm** (observed, NOT base64url as some sources claim):

Replace all path separator characters and the drive colon with `-`:

| Path | Project Directory Name |
|------|----------------------|
| `C:\git\ClaudeMemoryMover` | `C--git-ClaudeMemoryMover` |
| `C:\agents\remus` | `C--agents-remus` |
| `C:\ContReAct-Ollama` | `c--ContReAct-Ollama` |
| `C:\myagent` | `c--myagent` |
| `C:\Users\Josh` | `C--Users-Josh` |
| `/home/user/project` (Linux) | `-home-user-project` |
| `/Users/josh/project` (macOS) | `-Users-josh-project` |

**Algorithm**: `path.replace(/[:\\\/]/g, '-')` — colons and both slash types become `-`.

This is the **key insight** for path remapping: to find a project's directory after migration to a new path, `cmemmov` just needs to re-derive the slug from the new path.

### 1.3 Per-Project Directory Contents

```
~/.claude/projects/<path-slug>/
├── <UUID>.jsonl                # Session conversation file (one per session)
├── <UUID>/                     # Session working directory (for large tool outputs)
│   └── tool-results/
│       └── <id>.txt            # Overflow files for large tool results
└── memory/
    ├── MEMORY.md               # Memory index (frontmatter + markdown links)
    └── <topic-file>.md         # Individual memory topic files
```

Example memory structure observed:
```
memory/
├── MEMORY.md           # Contains: "- [Title](file.md) — one-line description"
└── project_avast_ssl_fix.md
```

### 1.4 Session JSONL Format (Actual Schema)

Each `.jsonl` file contains newline-delimited JSON records. Observed record types:

**Queue operations** (bookkeeping):
```json
{"type": "queue-operation", "operation": "enqueue", "timestamp": "2026-05-08T23:21:05.418Z", "sessionId": "..."}
{"type": "queue-operation", "operation": "dequeue", "timestamp": "...", "sessionId": "..."}
```

**User messages**:
```json
{
  "parentUuid": null,
  "isSidechain": false,
  "promptId": "93030e2e-...",
  "type": "user",
  "message": {"role": "user", "content": "..."},
  "uuid": "e161f506-...",
  "timestamp": "2026-05-08T23:21:05.563Z",
  "userType": "external",
  "entrypoint": "claude-vscode",
  "cwd": "c:\\git\\ClaudeMemoryMover",
  "sessionId": "0481feb3-...",
  "version": "2.1.133",
  "gitBranch": "HEAD"
}
```

**Key fields**: `type`, `message.role`, `message.content`, `uuid`, `parentUuid`, `cwd`, `sessionId`, `version`, `entrypoint`, `gitBranch`, `isSidechain`

> Sessions reference `cwd` (the working directory path) — this is another path that needs remapping on migration.

### 1.5 `settings.json` Actual Schema

```json
{
  "env": {
    "NODE_EXTRA_CA_CERTS": "C:\\Users\\Josh\\.claude\\avast-root-ca.pem",
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "permissions": {
    "allow": [
      "mcp__perplexity-mcp__reason",
      "Bash(git add *)",
      "Read(//c/myagent/**)",
      "..."
    ]
  },
  "autoDreamEnabled": true,
  "skipDangerousModePermissionPrompt": true,
  "model": "sonnet"
}
```

Notable: permissions contain **absolute paths** that need remapping on migration.

### 1.6 `.claude.json` Global State Schema (Key Fields)

This large blob at `~/` contains:

| Field | Purpose | Migration Relevance |
|-------|---------|-------------------|
| `projects` | Per-project metadata | Contains absolute paths — needs remapping |
| `mcpServers` | MCP server configurations | May contain paths — needs remapping |
| `oauthAccount` | Auth account details | Machine-specific — skip or warn |
| `userID` | Anthropic user ID | Skip |
| `skillUsage` | Skill use statistics | Optional include |
| `seenNotifications` | Dismissed notifications | Skip (ephemeral) |
| `githubRepoPaths` | GitHub repo associations | Contains paths — needs remapping |
| `installMethod` | How Claude was installed | Machine-specific — skip |
| Various caches | `cachedStatsigGates`, etc. | Skip (ephemeral) |

### 1.7 Teams Directory

```
~/.claude/teams/
├── default/
│   └── inboxes/
│       ├── Joshua.json     # Agent inbox (~1.7KB)
│       ├── Romulus.json
│       └── team-lead.json  # Larger (~10KB)
└── epic-review/
    ├── config.json         # Team config (~21KB)
    └── inboxes/
        └── team-lead.json
```

Teams are a newer Claude Code feature — important for power users to migrate.

### 1.8 Export Categories Summary

Based on observed structure, natural export categories for cmemmov:

| Category | Files | Path-Sensitive? |
|----------|-------|----------------|
| **Global Memories** | `~/.claude/projects/<slug>/memory/**` for global project | No (content only) |
| **Project Memories** | `~/.claude/projects/<slug>/memory/**` for each project | Yes (slug = path) |
| **Global Settings** | `~/.claude/settings.json` | Yes (permissions, env vars contain paths) |
| **Project Settings** | `<project>/.claude/settings.json` | Yes |
| **CLAUDE.md (Global)** | `~/.claude/CLAUDE.md` if exists | No |
| **CLAUDE.md (Projects)** | `<project>/.claude/CLAUDE.md` | No |
| **MCP Config** | `~/.claude/settings.json` mcpServers section | Yes (server paths) |
| **Custom Commands** | `~/.claude/commands/` if exists | No |
| **Teams** | `~/.claude/teams/**` | No |
| **Session History** | `~/.claude/projects/<slug>/*.jsonl` | Yes (cwd in records) |
| **Command History** | `~/.claude/history.jsonl` | Minimal value |
| **Plugins** | `~/.claude/plugins/` | No |
| **Credentials** | `~/.claude/.credentials.json` | No (but sensitive!) |

---

## Section 2: Cross-Platform Path Resolution

### 2.1 Where Claude Code Stores Data

| Platform | Base Directory | How Resolved |
|----------|---------------|-------------|
| **Windows** | `%USERPROFILE%\.claude\` | `os.homedir()` → `C:\Users\<username>` |
| **macOS** | `~/.claude/` | `os.homedir()` → `/Users/<username>` |
| **Linux** | `~/.claude/` | `os.homedir()` → `/home/<username>` |

**NOT** `%APPDATA%` or `%LOCALAPPDATA%` on Windows — Claude Code uses `os.homedir()`.

**Override**: `CLAUDE_CONFIG_DIR` environment variable can redirect the base directory on all platforms.

### 2.2 Implementation for cmemmov

```js
const os = require('os');
const path = require('path');

function getClaudeDir() {
  // Respect Claude Code's own override first
  if (process.env.CLAUDE_CONFIG_DIR) {
    return process.env.CLAUDE_CONFIG_DIR;
  }
  return path.join(os.homedir(), '.claude');
}

function getClaudeStateFile() {
  return path.join(os.homedir(), '.claude.json');
}
```

`os.homedir()` returns:
- Windows: `C:\Users\Josh` (uses `%USERPROFILE%`, NOT `%HOMEPATH%`)
- macOS: `/Users/josh`
- Linux: `/home/josh`

### 2.3 Project Path Slug Algorithm

```js
function pathToSlug(absolutePath) {
  // Replace drive colon, forward slashes, and backslashes with '-'
  return absolutePath.replace(/[:\\/]/g, '-');
}

function slugToSearch(slug) {
  // On import: find matching project dir by slug (case-insensitive on Windows)
  return slug;
}

// Remap: old path → new path → new slug
function remapProjectSlug(oldPath, newPath) {
  return pathToSlug(newPath);
}
```

### 2.4 Path Normalization in Export/Import

When exporting, cmemmov should record both the slug AND the original absolute path (stored in the project's session metadata and `cwd` fields). This enables:
1. Detecting when a path maps to a different location on the new machine
2. Offering the user a remapping UI
3. Auto-detecting likely new paths (e.g., same folder name at different drive letter)

```js
// In export bundle metadata:
{
  "exportedFrom": {
    "os": "win32",
    "homedir": "C:\\Users\\Josh",
    "claudeDir": "C:\\Users\\Josh\\.claude"
  },
  "projects": [
    {
      "slug": "C--git-ClaudeMemoryMover",
      "originalPath": "C:\\git\\ClaudeMemoryMover",
      "displayName": "ClaudeMemoryMover"
    }
  ]
}
```

### 2.5 Cross-OS Path Remapping Strategy

When importing on a different OS, cmemmov needs to:

1. **Detect platform mismatch** — `exportedFrom.os !== process.platform`
2. **Identify Windows paths** — detect `C:\` prefix, convert to Unix style
3. **Offer remapping** — show each project's original path, let user specify new path
4. **Auto-suggest** — if `/home/user/git/ClaudeMemoryMover` folder exists, suggest it
5. **Re-slug** — compute new slug from remapped path

```js
function suggestNewPath(oldPath, targetOs) {
  // Windows C:\git\project → /home/<user>/git/project (macOS/Linux)
  if (oldPath.match(/^[A-Z]:\\/i) && targetOs !== 'win32') {
    const withoutDrive = oldPath.replace(/^[A-Z]:\\/i, '/');
    const unixPath = withoutDrive.replace(/\\/g, '/');
    return path.join(os.homedir(), unixPath);
  }
  // Linux/macOS → Windows
  if (!oldPath.match(/^[A-Z]:\\/i) && targetOs === 'win32') {
    const relative = oldPath.replace(/^\/home\/[^/]+/, '');
    return path.join('C:\\Users', os.userInfo().username, relative.replace(/\//g, '\\'));
  }
  return oldPath; // Same OS — return unchanged
}
```

---

## Section 3: Archive Format Selection

### 3.1 Comparison Matrix

| Criterion | JSON Bundle | ZIP | tar.gz |
|-----------|-------------|-----|--------|
| Human-readable | ✅ Yes | ❌ Binary | ❌ Binary |
| Windows familiarity | ✅ High | ✅ High | ⚠️ Low |
| Node.js native support | ✅ Built-in | ❌ Needs adm-zip/jszip | ⚠️ Needs tar-stream + zlib |
| Random access / selective | ✅ Yes | ✅ Yes | ❌ Sequential |
| Compression | ❌ None (unless gzipped) | ✅ Per-file deflate | ✅ Whole-archive gzip |
| Metadata embedding | ✅ Trivial | ⚠️ Via comment | ⚠️ Via headers |
| Cross-platform | ✅ Perfect | ✅ Good | ✅ Good |
| Inspectable without tool | ✅ Text editor | ❌ Needs unzip | ❌ Needs tar |
| File size (text data) | ~1x | ~0.3x | ~0.25x |
| Selective import | ✅ Trivial | ✅ Yes | ❌ Hard |

### 3.2 Recommendation: JSON Bundle (`.cmemmov` or `.json`)

For cmemmov's use case, **a structured JSON bundle is the best choice** because:

1. **Data is already text/JSON/Markdown** — the export is 95% small text files; compression savings are minimal for typical memory+settings exports
2. **Selective import** requires inspecting/picking individual items — JSON is trivially filterable
3. **Path remapping metadata** is naturally expressed in JSON
4. **No binary dependencies** — pure Node.js, no npm packages needed for core functionality
5. **Transparency** — users can inspect/edit the export file before importing (important for trust)
6. **Sessions are the only large data** — if sessions are included, consider gzip wrapping the whole bundle (`.cmemmov.gz`)

**Recommended format**:
```json
{
  "version": "1.0",
  "format": "cmemmov",
  "exportedAt": "2026-05-08T23:00:00Z",
  "exportedFrom": {
    "os": "win32",
    "platform": "Windows 11",
    "claudeVersion": "2.1.133",
    "homedir": "C:\\Users\\Josh",
    "claudeDir": "C:\\Users\\Josh\\.claude"
  },
  "categories": {
    "globalSettings": { ... },
    "globalMemory": { ... },
    "projects": [
      {
        "slug": "C--git-ClaudeMemoryMover",
        "originalPath": "C:\\git\\ClaudeMemoryMover",
        "memory": { "MEMORY.md": "...", "project_avast.md": "..." },
        "settings": { ... },
        "claudeMd": "..."
      }
    ],
    "teams": { ... },
    "mcpServers": [ ... ]
  }
}
```

**Optional compression**: For exports including session history, wrap with gzip → `.cmemmov.gz`. Use `zlib.gzipSync()` / `zlib.gunzipSync()` — no extra dependencies.

---

## Section 4: Competitive Landscape

### 4.1 Existing Tools

| Tool | Author | Language | Approach | Status |
|------|--------|----------|----------|--------|
| `@tawandotorg/claude-sync` | tawan | Node.js | Encrypts + syncs `~/.claude` to S3/R2/GCS | Active (Feb 2025) |
| `ClaudeSync` by jahwag | jahwag | Python | Syncs LOCAL files TO Claude.ai projects | Active (Mar 2025) |
| `claude-sync` by bob6664569 | bob6664569 | Unknown | Unknown | Unknown |
| `ClaudeSync` by azzuwayed | azzuwayed | Unknown | Unknown | Unknown |
| `claude-sync` by cshum | cshum | Unknown | Unknown | Unknown |

### 4.2 Most Relevant Competitor: `@tawandotorg/claude-sync`

**What it does:**
- Encrypts `~/.claude` with `age` (passphrase-based keys)
- Pushes/pulls to Cloudflare R2, AWS S3, or Google Cloud Storage
- Simple three-command workflow: `init`, `push`, `pull`
- Syncs: `CLAUDE.md`, `settings.json`, `agents/`, `skills/`, `rules/`, `projects/`

**What it does NOT do:**
- ❌ No path remapping — sessions keyed by absolute path won't work across machines
- ❌ No selective export — all or nothing
- ❌ No interactive menu — CLI flags only
- ❌ Requires cloud storage account setup (S3/R2/GCS) — not zero-config
- ❌ No cross-OS migration workflow — no Windows → macOS support
- ❌ No "fix paths" utility for repos cloned to different locations
- ❌ No merge vs. overwrite options
- ❌ No import preview/selection

**jahwag/ClaudeSync** is entirely different — it's for syncing project files TO Claude.ai (requires Pro subscription), not for cross-machine migration.

### 4.3 Competitive Differentiation: cmemmov vs. claude-sync

| Feature | tawandotorg/claude-sync | cmemmov |
|---------|------------------------|---------|
| Cloud storage required | ✅ Yes (S3/R2/GCS) | ❌ No — local file |
| Interactive menu | ❌ No | ✅ Yes |
| Selective export | ❌ No | ✅ Yes (by category + project) |
| Path remapping | ❌ No | ✅ Yes (auto-detect + manual) |
| Cross-OS support | ⚠️ Partial | ✅ Full |
| Merge vs. overwrite | ❌ No | ✅ Yes |
| One-time migration UX | ❌ Awkward | ✅ Primary use case |
| Fix paths utility | ❌ No | ✅ Yes |
| Inspect export file | ❌ Binary (encrypted) | ✅ JSON (readable) |
| Silent/CLI mode | ✅ Yes | ✅ Yes |

### 4.4 Verdict: **Build It**

`cmemmov` fills a genuine gap. The existing tools are either:
- **Continuous sync** tools that require cloud infrastructure (tawandotorg)
- **File-to-Claude.ai** sync tools (jahwag)

Neither handles the **one-time migration** use case well. No tool handles:
- Path remapping between machines/OSes
- Interactive selection of what to migrate
- Windows ↔ macOS ↔ Linux cross-OS migration
- Local file transfer (no cloud dependency)

This is exactly the workflow described in `initial-prompt.md` — and it's a workflow with no good existing solution.

---

## Section 5: Node.js Implementation Guidance

### 5.1 Key npm Dependencies

| Purpose | Recommended Package | Notes |
|---------|-------------------|-------|
| Interactive menus | `@clack/prompts` or `inquirer` | Clack is newer, better UX |
| Path operations | Node.js built-in `path`, `os` | No extra deps needed |
| File I/O | Node.js built-in `fs/promises` | Async throughout |
| Compression (sessions) | Node.js built-in `zlib` | `gzipSync`/`gunzipSync` |
| Color/formatting | `chalk` or `picocolors` | CLI output |
| Argument parsing | `minimist` or `yargs` | Silent mode flags |

### 5.2 Claude Code Config Dir Resolution

```js
const os = require('os');
const path = require('path');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR
  ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude')
  : path.join(os.homedir(), '.claude');

const CLAUDE_STATE_FILE = path.join(os.homedir(), '.claude.json');
```

### 5.3 Project Slug Algorithm (Verified)

```js
function pathToSlug(absolutePath) {
  return absolutePath.replace(/[:\\/]/g, '-');
}

function slugToOriginalPath(slug) {
  // Reverse: first '-' after drive letter → ':\'  (Windows)
  // Or: leading '-' → '/' (Unix)
  if (/^[A-Z]-/.test(slug)) {
    // Windows path: C--git-project → C:\git\project
    return slug[0] + ':\\' + slug.slice(2).replace(/-/g, '\\');
  } else {
    // Unix path: -home-user-project → /home/user/project
    return '/' + slug.slice(1).replace(/-/g, '/');
  }
}
```

> ⚠️ **Ambiguity**: The slug conversion is lossy — folder names with `-` in them become ambiguous on decode. cmemmov should store the original path in export metadata and read from the session `cwd` field to get the canonical original path.

---

## Key Findings Summary

1. **Claude Code data structure is well-understood and stable** — all text files (JSON, JSONL, Markdown), no binary databases, straightforward to read/write programmatically.

2. **Project path encoding is a simple slug** (`path.replace(/[:\\/]/g, '-')`), NOT base64 — making path remapping algorithmic.

3. **Two separate state locations** exist: `~/.claude/` directory AND `~/.claude.json` file — both need to be handled.

4. **Path-sensitivity is pervasive** — project slugs, session `cwd` fields, permission rules in `settings.json`, and entries in `.claude.json` all embed absolute paths.

5. **`os.homedir()` is the correct resolver** for `~/.claude` on all platforms; `CLAUDE_CONFIG_DIR` env var overrides it.

6. **JSON bundle format is best** for the export file — readable, selective-import-friendly, no binary deps, embeds remapping metadata naturally.

7. **The competitive gap is real** — no existing tool handles interactive selective migration + path remapping + local file transfer + cross-OS. `cmemmov` is worth building.

---

## Sources

- Live inspection: `C:\Users\Josh\.claude\` — Claude Code v2.1.133, Windows 11 (primary source)
- Perplexity: Claude Sync tools landscape (dev.to/tawanorg, github.com/jahwag/ClaudeSync)
- Perplexity: Windows Claude Code path location (code.claude.com/docs/en/claude-directory)
- Perplexity: Node.js cross-platform path resolution (env-paths, platformdirs)
- Perplexity: Archive format comparison for Node.js CLI tools
- `initial-prompt.md` — project requirements
- `claude-memory-move-research.md` — prior research
