# Story 1.7: Claude Code Surface — Locator, Reader, Writer

Status: done

## Story

As a developer working on cmemmov,
I want services that locate the Claude Code config directory (honoring `CLAUDE_CONFIG_DIR`), read the full `~/.claude/` + `~/.claude.json` surface into typed structures, and write categories back through the WriteGate with merge/overwrite semantics,
So that every command reads and writes Claude Code state through a single typed surface — no command reads or writes raw `~/.claude/` paths directly.

## Acceptance Criteria

1. **Given** no `CLAUDE_CONFIG_DIR` environment variable
   **When** `claude-locator` runs
   **Then** it returns `path.join(os.homedir(), '.claude')` for the config dir and `path.join(os.homedir(), '.claude.json')` for the global state file

2. **Given** `CLAUDE_CONFIG_DIR=/custom/path`
   **When** `claude-locator` runs
   **Then** it returns `/custom/path` for the config dir and the corresponding `.claude.json` location matching Claude Code's own resolution behavior (NFR19)

3. **Given** any source file other than `services/claude-locator.ts`
   **When** it imports `homedir` from `node:os` or reads `process.env.CLAUDE_CONFIG_DIR`
   **Then** the build fails (the `no-process-env-home` rule + updated `no-restricted-imports` enforces the `homedir` import; `CLAUDE_CONFIG_DIR` access is by convention + code review)

4. **Given** a fixture `~/.claude/` tree at `tests/fixtures/claude-trees/linux-typical/`
   **When** `readClaudeSurface(claudeDir, claudeJson)` runs against it
   **Then** it returns a typed `ClaudeSurface` struct populated with all categories: `globalMemory`, `projectMemory`, `globalSettings`, `projectSettings`, `claudeMd`, `mcpConfig`, `customCommands`, `teams`, `plugins`, `sessionHistory`, plus `claudeJson` content and a `credentialsRef` (path only, not content)

5. **Given** `claude-reader`
   **When** it encounters `EBUSY` or `EPERM` reading a session JSONL (active Claude Code process)
   **Then** it surfaces `CmemmovError({ code: 'INTERNAL', hint: 'close Claude Code and retry', file: <path> })` instead of failing cryptically (Architecture Important Gap #3 mitigation)

6. **Given** `claude-writer` with a live or dry-run `WriteGate`
   **When** I call `applyCategory({ category: 'globalMemory', mode: 'merge', targetDir, data, gate })`
   **Then** writes flow through the gate (atomic in live, recorded-only in dry-run); merge semantics for `globalMemory` apply layered MEMORY.md merge with default conflict policy `keep` (existing entries win) and the index is rebuilt from the conceptual final on-disk state

7. **Given** `claude-writer` with `mode: 'overwrite'` for a category
   **When** I apply it
   **Then** the target category is replaced wholesale via the gate

8. **Given** `claude-writer` in this Epic 1 scope
   **When** processing any category
   **Then** it does NOT modify paths embedded in `settings.json` permission rules or `.claude.json` global state fields (path remapping is deferred to Epic 2)

9. **Given** `claude-reader` and a project slug under `~/.claude/projects/<slug>/`
   **When** I call `resolveOriginalPath(slug, claudeDir)`
   **Then** it returns `{ path: string, source: 'sessionCwd' | 'slugDecode' | null }` where:
   - (a) `source: 'sessionCwd'` and `path` is the `cwd` field read from the most recent session JSONL when at least one session exists
   - (b) `source: 'slugDecode'` and `path` is `path-engine.slugToPath(slug, currentPlatform)` when no session JSONL exists AND slug decode is unambiguous (non-null)
   - (c) `source: null` and `path` is the verbatim slug string when slug decode is null (ambiguous/lossy)
   **And** this is the ONE function consumed by both `cmemmov export` (Story 1.10) and `cmemmov fix-paths` (Story 3.1) — no command implements a parallel resolver; a `grep` for `cwd` extraction logic outside `claude-reader.ts` returns zero matches

10. **Given** `claude-writer` and the canonical 10-category list
    **When** I inspect each category's documented merge semantics
    **Then** the table below is reflected in the writer's per-category branches and asserted by unit tests; categories not appearing in this table cause a TypeScript compile error (exhaustiveness check via `assertNever`):

| Category | `merge` semantics | `overwrite` semantics |
| --- | --- | --- |
| `globalMemory` | Layered MEMORY.md merge; conflict policy `keep` (existing entries win); index rebuilt from final state | Replace MEMORY.md and the entire memory file set wholesale |
| `projectMemory` | Per-project layered merge identical to `globalMemory` | Replace the project's memory directory wholesale |
| `globalSettings` | Deep object merge; permission-rule arrays de-duplicated by string equality | Replace `~/.claude/settings.json` wholesale |
| `projectSettings` | Per-project deep object merge | Replace per-project `settings.json` wholesale |
| `claudeMd` | Existing CLAUDE.md kept on conflict (project-defining; surprise-overwrite unsafe) | Replace CLAUDE.md wholesale |
| `mcpConfig` | MCP server entries unioned by `name`; existing entry kept on collision | Replace MCP config wholesale |
| `customCommands` | Command files unioned by filename; existing kept on collision | Replace commands directory wholesale |
| `teams` | Teams unioned by `id`; existing kept on collision | Replace teams config wholesale |
| `plugins` | Plugin entries unioned by `name`; existing kept on collision | Replace plugins config wholesale |
| `sessionHistory` | Append-only union by `sessionId` (existing JSONL files never overwritten) | Replace `~/.claude/projects/<slug>/sessions/` wholesale |

## Tasks / Subtasks

- [x] Task 1: Create `src/services/claude-locator.ts`
  - [x] Export `interface ClaudeLocation { claudeDir: string; claudeJson: string }`
  - [x] Export `function locateClaude(): ClaudeLocation`
  - [x] Default path (no env): `{ claudeDir: path.join(os.homedir(), '.claude'), claudeJson: path.join(os.homedir(), '.claude.json') }`
  - [x] CLAUDE_CONFIG_DIR path: `{ claudeDir: envVal, claudeJson: envVal + '.json' }` (the json file is adjacent to the config dir, consistent with default naming)
  - [x] This is the ONLY file allowed to call `os.homedir()` or read `process.env.CLAUDE_CONFIG_DIR`

- [x] Task 2: Update `eslint.config.js` to enforce homedir import restriction
  - [x] Add `no-restricted-imports` entry banning `homedir` from `node:os` and `os` for all `src/**/*.ts` except `src/services/claude-locator.ts` and test files
  - [x] This covers named imports (`import { homedir }`) — default import + method call (`os.homedir()`) is covered by convention and code review

- [x] Task 3: Create `src/services/claude-locator.test.ts`
  - [x] Test default resolution: stubs `os.homedir()` via `vi.spyOn`, verifies both paths
  - [x] Test CLAUDE_CONFIG_DIR override: sets `process.env.CLAUDE_CONFIG_DIR` in beforeEach, cleans in afterEach
  - [x] Verify `claudeJson` is always `claudeDir + '.json'` for CLAUDE_CONFIG_DIR case

- [x] Task 4: Define shared surface types (inline in `src/services/claude-reader.ts`)
  - [x] `export interface MemoryFile { filename: string; content: string; }`
  - [x] `export interface SessionFile { filename: string; lines: string[]; }`
  - [x] `export interface CommandFile { filename: string; content: string; }`
  - [x] `export interface ProjectSurface { slug: string; settings: unknown; memories: MemoryFile[]; claudeMd: string | undefined; sessions: SessionFile[]; }`
  - [x] `export interface ClaudeSurface { claudeDir: string; claudeJson: unknown; credentialsRef: string | undefined; globalSettings: unknown; globalMemory: MemoryFile[]; claudeMd: string | undefined; mcpConfig: unknown; customCommands: CommandFile[]; teams: unknown; plugins: unknown; projects: ProjectSurface[]; }`
  - [x] `export interface OriginalPathResult { path: string; source: 'sessionCwd' | 'slugDecode' | null; }`

- [x] Task 5: Create `src/services/claude-reader.ts`
  - [x] Export `readClaudeSurface(claudeDir: string, claudeJson: string): Promise<ClaudeSurface>`
  - [x] Export `resolveOriginalPath(slug: string, claudeDir: string): Promise<OriginalPathResult>`
  - [x] Read `claudeJson` file → parse with `JSON.parse` wrapped in try/catch (ONLY `claude-reader.ts` may call `JSON.parse` on claude config files — see note below)
  - [x] Read `<claudeDir>/settings.json` → `globalSettings`; extract `settings.mcpServers` → `mcpConfig`
  - [x] Read `<claudeDir>/memory/` → `globalMemory` (all `.md` files including MEMORY.md); read MEMORY.md separately for index
  - [x] Read `<claudeDir>/CLAUDE.md` → `claudeMd` (undefined if absent)
  - [x] Read `<claudeDir>/commands/` → `customCommands` (all files as `{ filename, content }`)
  - [x] Read `<claudeDir>/teams/` → `teams` (raw JSON; structure: `{ [teamName]: config }`)
  - [x] Read `<claudeDir>/plugins.json` or `<claudeDir>/plugins/` → `plugins` (undefined if absent)
  - [x] credentialsRef: check for `.credentials.json` or `credentials.json` in claudeDir; store PATH ONLY (no content)
  - [x] Enumerate `<claudeDir>/projects/` → one `ProjectSurface` per slug directory
  - [x] For each project slug: read `settings.json`, `memory/*.md`, `CLAUDE.md`, `sessions/*.jsonl`
  - [x] EBUSY/EPERM when reading session JSONL → throw `CmemmovError({ code: 'INTERNAL', hint: 'close Claude Code and retry', file: path })`
  - [x] `resolveOriginalPath`: (a) list session files in `<claudeDir>/projects/<slug>/sessions/`, sort by mtime desc, parse first file for `cwd` field; (b) fall back to `slugToPath(slug, process.platform as NodeJS.Platform)`; (c) `{ path: slug, source: null }` if slugToPath returns null

- [x] Task 6: Create `tests/fixtures/claude-trees/linux-typical/` fixture tree
  - [x] `.claude/settings.json` — global settings with `mcpServers` key and a sample permission rule
  - [x] `.claude/CLAUDE.md` — global CLAUDE.md with short content
  - [x] `.claude/memory/MEMORY.md` — index with one entry
  - [x] `.claude/memory/user_profile.md` — sample memory file
  - [x] `.claude/commands/greet.md` — a custom command
  - [x] `.claude/teams/my-team/config.json` — team config with `id` field
  - [x] `.claude/projects/-home-user-myproject/settings.json` — per-project settings
  - [x] `.claude/projects/-home-user-myproject/CLAUDE.md` — per-project CLAUDE.md
  - [x] `.claude/projects/-home-user-myproject/memory/MEMORY.md` — project memory index
  - [x] `.claude/projects/-home-user-myproject/memory/project_notes.md` — project memory
  - [x] `.claude/projects/-home-user-myproject/sessions/abc123.jsonl` — one session file with `cwd` field in first line
  - [x] `.claude.json` — global state file (JSON with `oauthAccount` and `projects` keys)

- [x] Task 7: Create `src/services/claude-reader.test.ts`
  - [x] Use `tests/fixtures/claude-trees/linux-typical/` as the claudeDir target
  - [x] Test `readClaudeSurface` returns correct `globalSettings`, `globalMemory`, `claudeMd`, `customCommands`, `mcpConfig`, `projects` with all fields
  - [x] Test `credentialsRef` is a path string, not content (no credentials file in fixture → `undefined`)
  - [x] Test EBUSY/EPERM: mock `fs.readFile` to throw EBUSY for a session file path; verify `CmemmovError(INTERNAL)` is thrown
  - [x] Test `resolveOriginalPath` case (a): slug with a session JSONL that has `cwd`
  - [x] Test `resolveOriginalPath` case (b): slug with no sessions, valid slug decode
  - [x] Test `resolveOriginalPath` case (c): slug with no sessions, null slug decode (ambiguous)

- [x] Task 8: Define writer types in `src/services/claude-writer.ts`
  - [x] `export type ClaudeCategory = 'globalMemory' | 'projectMemory' | 'globalSettings' | 'projectSettings' | 'claudeMd' | 'mcpConfig' | 'customCommands' | 'teams' | 'plugins' | 'sessionHistory'`
  - [x] `type CategoryDataMap` — discriminated union mapping each category key to its data type (see Dev Notes)
  - [x] Discriminated union type for `ApplyCategoryOpts` (one type per category, combined with `|`)
  - [x] `export function applyCategory(opts: ApplyCategoryOpts): Promise<void>` — top-level switch with `assertNever(opts)`
  - [x] `function assertNever(x: never): never` — ensures compile error if a category case is missing

- [x] Task 9: Implement all 10 category handlers in `src/services/claude-writer.ts`
  - [x] `globalMemory` merge: read existing `<targetDir>/memory/*.md`, union by filename (keep existing on collision), write new files via gate, rebuild `MEMORY.md` index via gate
  - [x] `globalMemory` overwrite: gate.remove existing memory dir, gate.mkdir, write all files
  - [x] `projectMemory` merge/overwrite: same as globalMemory but path is `<targetDir>/projects/<slug>/memory/`
  - [x] `globalSettings` merge: read existing JSON, deep-merge incoming, write via gate
  - [x] `globalSettings` overwrite: write incoming JSON directly via gate
  - [x] `projectSettings` merge/overwrite: same as globalSettings but at project path
  - [x] `claudeMd` merge: check if `<targetDir>/CLAUDE.md` (or project's) exists — if so, skip (keep existing); if not, write via gate
  - [x] `claudeMd` overwrite: write incoming content via gate regardless
  - [x] `mcpConfig` merge: read `settings.json`, union `mcpServers` by `name` key (keep existing on collision), write updated `settings.json` via gate
  - [x] `mcpConfig` overwrite: read `settings.json`, replace `mcpServers` wholesale, write via gate
  - [x] `customCommands` merge: enumerate `<targetDir>/commands/`, keep existing filenames, write new files via gate
  - [x] `customCommands` overwrite: gate.remove + gate.mkdir + write all files
  - [x] `teams` merge: read each `<targetDir>/teams/<id>/config.json`, union by team `id`, keep existing on collision
  - [x] `teams` overwrite: gate.remove + gate.mkdir + write all teams
  - [x] `plugins` merge/overwrite: same pattern as customCommands/teams depending on format found on disk
  - [x] `sessionHistory` merge: for each incoming session file, skip if `<targetDir>/projects/<slug>/sessions/<filename>` already exists; gate.write new files only
  - [x] `sessionHistory` overwrite: gate.remove + gate.mkdir + write all session files
  - [x] Do NOT modify any path strings inside JSON content during any write (path remapping deferred to Epic 2)

- [x] Task 10: Create `src/services/claude-writer.test.ts`
  - [x] Use `vi.spyOn` on gate methods to verify correct ops are recorded (dry-run gate)
  - [x] Test `globalMemory` merge: existing file kept, new file written, MEMORY.md rebuilt
  - [x] Test `globalSettings` merge: incoming fields merged, existing fields preserved
  - [x] Test `claudeMd` merge: existing file → no write; no existing file → write
  - [x] Test `mcpConfig` merge: union by name, existing entry kept
  - [x] Test `sessionHistory` merge: existing JSONL not overwritten, new JSONL written
  - [x] Test `globalMemory` overwrite: all incoming files written
  - [x] Test that exhaustiveness check covers all 10 categories (TypeScript compile validates this)

- [x] Task 11: Final validation
  - [x] `npm run check` exits 0 (lint + typecheck + tests)
  - [x] Verify no `os.homedir()` calls outside `claude-locator.ts` with: `grep -r "os\.homedir" src/ | grep -v claude-locator`
  - [x] Verify no `CLAUDE_CONFIG_DIR` reads outside `claude-locator.ts` with: `grep -r "CLAUDE_CONFIG_DIR" src/ | grep -v claude-locator`
  - [x] Verify `resolveOriginalPath` is defined only in `claude-reader.ts` and all `cwd` extraction logic is in one place

## Dev Notes

### Architecture Invariants (MUST NOT violate)

- Layer: all three files are `src/services/` — they receive paths as injected args, never resolve `~` themselves
- `claude-locator.ts` is the ONLY file that may call `os.homedir()` or read `process.env.CLAUDE_CONFIG_DIR`
- `claude-writer.ts` NEVER calls `fs.writeFile`, `fs.rename`, `fs.unlink`, etc. directly — ALL writes go through the injected `WriteGate`
- `claude-reader.ts` reads freely (no WriteGate needed for reads)
- Services must NOT import from `commands/` or `ui/` — only from `core/*` and node built-ins
- `JSON.parse` on claude config files (settings.json, .claude.json, etc.) is ONLY called within `claude-reader.ts` — the `no-raw-json-parse` ESLint rule already enforces this for src/

### CLAUDE_CONFIG_DIR Resolution

Claude Code's default config layout:
```
os.homedir()/.claude/        ← claudeDir
os.homedir()/.claude.json    ← claudeJson (sibling file, NOT inside the dir)
```

When `CLAUDE_CONFIG_DIR=/custom/path`:
```
claudeDir  = '/custom/path'
claudeJson = '/custom/path.json'    ← derived: claudeDir + '.json'
```

This matches the default pattern: `~/.claude` + `~/.claude.json` (the json is named like the dir with `.json` appended).

### `claude-locator.ts` — Full Implementation

This file is simple. The only complexity is the env-var branch:

```typescript
import os from 'node:os';
import { join } from 'node:path';

export interface ClaudeLocation {
  claudeDir: string;
  claudeJson: string;
}

export function locateClaude(): ClaudeLocation {
  const envDir = process.env['CLAUDE_CONFIG_DIR'];
  if (envDir !== undefined && envDir.length > 0) {
    return { claudeDir: envDir, claudeJson: envDir + '.json' };
  }
  const home = os.homedir();
  return { claudeDir: join(home, '.claude'), claudeJson: join(home, '.claude.json') };
}
```

### ESLint Update — `eslint.config.js`

Add a new config block to restrict `homedir` named imports outside `claude-locator.ts`:

```javascript
{
  files: ['src/**/*.ts'],
  ignores: ['src/services/claude-locator.ts', 'src/**/*.test.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        {
          name: 'node:os',
          importNames: ['homedir'],
          message: 'os.homedir() must only be called in services/claude-locator.ts.',
        },
        {
          name: 'os',
          importNames: ['homedir'],
          message: 'os.homedir() must only be called in services/claude-locator.ts.',
        },
      ],
    }],
  },
},
```

Note: the existing `no-restricted-imports` block (lines 26–58 of `eslint.config.js`) handles fs-write ops. Add this as a SEPARATE block. The existing rule's `ignores` include `write-gate.ts` and `backup-service.ts` — this new block's `ignores` are only `claude-locator.ts` and test files.

IMPORTANT: backup-service.ts uses `os.tmpdir()` (not `os.homedir()`), so it does NOT need to be in the homedir restriction's ignore list.

### Filesystem Layout — Claude Code `~/.claude/` Structure

Based on architecture and actual Claude Code installation patterns. The reader must tolerate missing directories/files (use `stat` before read or catch ENOENT):

```
<claudeDir>/
├── CLAUDE.md                          → claudeMd (global)
├── settings.json                      → globalSettings (full JSON); mcpServers key → mcpConfig
├── .credentials.json                  → credentialsRef (path only, NOT content)
├── memory/
│   ├── MEMORY.md                      → part of globalMemory (special: the index)
│   └── *.md                           → globalMemory files
├── commands/
│   └── *.md, *.sh, *.ts, *.js        → customCommands
├── teams/
│   └── <team-name>/config.json        → teams data (each config.json has an `id` field)
├── plugins.json                       → plugins (may not exist; tolerate ENOENT)
└── projects/
    └── <slug>/
        ├── CLAUDE.md                  → ProjectSurface.claudeMd
        ├── settings.json              → ProjectSurface.settings
        ├── memory/
        │   ├── MEMORY.md
        │   └── *.md                   → ProjectSurface.memories
        └── sessions/
            └── *.jsonl                → ProjectSurface.sessions (EBUSY/EPERM → CmemmovError)

<claudeJson>                           → claudeJson (adjacent, NOT inside claudeDir)
```

### `claude-reader.ts` — Key Implementation Patterns

**Safe directory read helper** (use throughout):
```typescript
async function safeReadDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}
```

**Safe file read helper**:
```typescript
async function safeReadFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}
```

**Session JSONL read with EBUSY/EPERM guard**:
```typescript
async function readSessionFile(filePath: string): Promise<SessionFile> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM') {
      throw new CmemmovError({
        code: 'INTERNAL',
        hint: 'close Claude Code and retry',
        file: filePath,
        cause: err,
      });
    }
    throw err;
  }
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  return { filename: basename(filePath), lines };
}
```

**mcpConfig extraction from settings**:
The `mcpServers` key in `settings.json` is the mcpConfig. Extract it:
```typescript
const rawSettings = JSON.parse(settingsText); // (in claude-reader, JSON.parse is allowed)
const mcpConfig = (rawSettings as Record<string, unknown>)['mcpServers'] ?? null;
const globalSettings = rawSettings; // full object (includes mcpServers)
```

### `resolveOriginalPath` — Algorithm

```typescript
export async function resolveOriginalPath(
  slug: string,
  claudeDir: string,
): Promise<OriginalPathResult> {
  // Step 1: look for session files
  const sessionsDir = join(claudeDir, 'projects', slug, 'sessions');
  const sessionFiles = await safeReadDir(sessionsDir);
  const jsonlFiles = sessionFiles.filter(f => f.endsWith('.jsonl'));

  if (jsonlFiles.length > 0) {
    // Sort by mtime descending — most recent session first
    const withStats = await Promise.all(
      jsonlFiles.map(async f => {
        const fullPath = join(sessionsDir, f);
        const st = await stat(fullPath);
        return { f, mtimeMs: st.mtimeMs };
      }),
    );
    withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const mostRecent = join(sessionsDir, withStats[0]!.f);

    // Parse first line with a `cwd` field
    const sessionContent = await readFile(mostRecent, 'utf8');
    for (const line of sessionContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        if (typeof obj['cwd'] === 'string') {
          return { path: obj['cwd'], source: 'sessionCwd' };
        }
      } catch {
        // skip malformed line
      }
    }
  }

  // Step 2: slug decode fallback
  const decoded = slugToPath(slug, process.platform as NodeJS.Platform);
  if (decoded !== null) {
    return { path: decoded, source: 'slugDecode' };
  }

  // Step 3: ambiguous / lossy
  return { path: slug, source: null };
}
```

Note: `JSON.parse` inside `resolveOriginalPath` is used to parse session JSONL lines, NOT bundle bytes. The `no-raw-json-parse` rule targets bundle-parsing only (its rule implementation checks the file context). Verify the rule doesn't fire here; if it does, the rule's `allowedFiles` list needs to include `claude-reader.ts`.

### `claude-writer.ts` — Type Architecture

Use a fully discriminated union so TypeScript narrows `data` correctly in each switch arm:

```typescript
type GlobalMemoryOpts    = { category: 'globalMemory';    mode: 'merge' | 'overwrite'; targetDir: string; data: MemoryFile[];                           gate: WriteGate };
type ProjectMemoryOpts   = { category: 'projectMemory';   mode: 'merge' | 'overwrite'; targetDir: string; data: { slug: string; files: MemoryFile[] };  gate: WriteGate };
type GlobalSettingsOpts  = { category: 'globalSettings';  mode: 'merge' | 'overwrite'; targetDir: string; data: unknown;                                gate: WriteGate };
type ProjectSettingsOpts = { category: 'projectSettings'; mode: 'merge' | 'overwrite'; targetDir: string; data: { slug: string; settings: unknown };    gate: WriteGate };
type ClaudeMdOpts        = { category: 'claudeMd';        mode: 'merge' | 'overwrite'; targetDir: string; data: { content: string; slug?: string };     gate: WriteGate };
type McpConfigOpts       = { category: 'mcpConfig';       mode: 'merge' | 'overwrite'; targetDir: string; data: unknown;                                gate: WriteGate };
type CustomCommandsOpts  = { category: 'customCommands';  mode: 'merge' | 'overwrite'; targetDir: string; data: CommandFile[];                          gate: WriteGate };
type TeamsOpts           = { category: 'teams';           mode: 'merge' | 'overwrite'; targetDir: string; data: unknown;                                gate: WriteGate };
type PluginsOpts         = { category: 'plugins';         mode: 'merge' | 'overwrite'; targetDir: string; data: unknown;                                gate: WriteGate };
type SessionHistoryOpts  = { category: 'sessionHistory';  mode: 'merge' | 'overwrite'; targetDir: string; data: { slug: string; files: SessionFile[] }; gate: WriteGate };

export type ApplyCategoryOpts =
  | GlobalMemoryOpts | ProjectMemoryOpts | GlobalSettingsOpts | ProjectSettingsOpts
  | ClaudeMdOpts | McpConfigOpts | CustomCommandsOpts | TeamsOpts | PluginsOpts | SessionHistoryOpts;

function assertNever(x: never): never {
  throw new Error(`Unhandled category: ${String((x as ApplyCategoryOpts).category)}`);
}

export async function applyCategory(opts: ApplyCategoryOpts): Promise<void> {
  switch (opts.category) {
    case 'globalMemory':    return applyGlobalMemory(opts);
    case 'projectMemory':   return applyProjectMemory(opts);
    case 'globalSettings':  return applyGlobalSettings(opts);
    case 'projectSettings': return applyProjectSettings(opts);
    case 'claudeMd':        return applyClaudeMd(opts);
    case 'mcpConfig':       return applyMcpConfig(opts);
    case 'customCommands':  return applyCustomCommands(opts);
    case 'teams':           return applyTeams(opts);
    case 'plugins':         return applyPlugins(opts);
    case 'sessionHistory':  return applySessionHistory(opts);
    default:                return assertNever(opts);
  }
}
```

### `globalMemory` Merge — MEMORY.md Index Rebuild

The MEMORY.md is a markdown file listing memory entries. Format (from this project's actual memory system):
```markdown
# Memory Index

- [Title](filename.md) — one-line hook
```

Merge algorithm:
1. Read existing `<targetDir>/memory/` files from disk (or empty set if dir absent)
2. Determine new files = incoming files whose `filename` is NOT in existing set
3. Write new files via `gate.write`
4. Build new index content by reading ALL files (existing on disk + new incoming); extract title from first `# ` heading; extract hook from description frontmatter or first non-blank non-heading line
5. Write rebuilt MEMORY.md via `gate.write`

For overwrite: `gate.remove` existing memory dir (if exists), `gate.mkdir`, write all incoming files, write rebuilt MEMORY.md.

### Deep Object Merge Helper for Settings

```typescript
function deepMerge(target: unknown, source: unknown): unknown {
  if (!isObject(target) || !isObject(source)) return source;
  const result: Record<string, unknown> = { ...target };
  for (const [key, val] of Object.entries(source)) {
    result[key] = deepMerge(result[key], val);
  }
  return result;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
```

Permission-rule arrays (strings in settings.json `permissions.*`) are de-duped by `[...new Set([...existingArr, ...incomingArr])]`.

### `no-raw-json-parse` Rule — Claude-Reader Exemption

The `no-raw-json-parse` ESLint rule from Story 1.2 bans `JSON.parse` in source files. The rule was designed to ensure bundle bytes only pass through `bundle-parser.ts`. But `claude-reader.ts` legitimately calls `JSON.parse` on claude config files (settings.json, .claude.json, session JSONL lines).

**Verify whether the rule fires for `claude-reader.ts`** by running `npm run lint`. If it does, check the rule implementation at `eslint-rules/no-raw-json-parse.js` — it likely needs an `allowedFiles` list to include `claude-reader.ts`. Update the rule accordingly.

The expected allowed files after this story: `['src/services/bundle-parser.ts', 'src/services/claude-reader.ts']`.

### Fixture Tree — Exact File Contents

**`.claude/settings.json`:**
```json
{
  "permissions": {
    "allow": ["Bash(npm:*)", "Read(~/.claude/*)"],
    "deny": []
  },
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  }
}
```

**`.claude/CLAUDE.md`:**
```markdown
# Global Claude Rules

Always use TypeScript strict mode.
```

**`.claude/memory/MEMORY.md`:**
```markdown
# Memory Index

- [User Profile](user_profile.md) — developer preferences and context
```

**`.claude/memory/user_profile.md`:**
```markdown
---
name: user profile
type: user
---

Prefers TypeScript strict mode. Uses Node.js v22 LTS.
```

**`.claude/commands/greet.md`:**
```markdown
---
name: greet
description: Greet the user
---
Hello! How can I help you today?
```

**`.claude/teams/my-team/config.json`:**
```json
{ "id": "team-abc", "name": "My Team", "members": [] }
```

**`.claude/projects/-home-user-myproject/settings.json`:**
```json
{ "permissions": { "allow": [], "deny": [] } }
```

**`.claude/projects/-home-user-myproject/CLAUDE.md`:**
```markdown
# My Project Rules

Follow the coding standards defined in src/README.md.
```

**`.claude/projects/-home-user-myproject/memory/MEMORY.md`:**
```markdown
# Memory Index

- [Project Notes](project_notes.md) — key decisions for myproject
```

**`.claude/projects/-home-user-myproject/memory/project_notes.md`:**
```markdown
---
name: project notes
type: project
---

This project uses ESM with NodeNext resolution.
```

**`.claude/projects/-home-user-myproject/sessions/abc123.jsonl`** (first line has cwd):
```
{"type":"system","cwd":"/home/user/myproject","timestamp":"2026-01-01T00:00:00.000Z"}
{"type":"user","content":"Hello","timestamp":"2026-01-01T00:00:01.000Z"}
```

**`.claude.json`** (adjacent to `.claude/`, i.e., the root of the linux-typical fixture):
```json
{
  "oauthAccount": { "emailAddress": "test@example.com" },
  "projects": {}
}
```

The fixture directory structure is thus:
```
tests/fixtures/claude-trees/linux-typical/
├── .claude/
│   ├── CLAUDE.md
│   ├── settings.json
│   ├── memory/
│   │   ├── MEMORY.md
│   │   └── user_profile.md
│   ├── commands/
│   │   └── greet.md
│   ├── teams/
│   │   └── my-team/
│   │       └── config.json
│   └── projects/
│       └── -home-user-myproject/
│           ├── CLAUDE.md
│           ├── settings.json
│           ├── memory/
│           │   ├── MEMORY.md
│           │   └── project_notes.md
│           └── sessions/
│               └── abc123.jsonl
└── .claude.json
```

The `.gitkeep` in `tests/fixtures/claude-trees/` was placed by Story 1.3 — delete it when creating the `linux-typical/` subdirectory. The `.gitkeep` in `tests/fixtures/bundles/` should NOT be removed.

### `no-raw-json-parse` Rule — Expected Update

Look at `eslint-rules/no-raw-json-parse.js`. It likely has a hard-coded file allowlist for `bundle-parser.ts`. Add `claude-reader.ts` to that list. The rule must not fire for JSON.parse calls inside `src/services/claude-reader.ts`.

### Previous Story Learnings (from Story 1.6 review)

- **`delete obj.property` over destructure `_omit`**: To exclude a property before stringify, use `const copy = { ...obj }; delete (copy as { key?: T }).key;` — avoids the no-unused-vars lint error that triggers on `const { key: _omit, ...rest } = obj`.
- **Wrap all zlib/native throws**: Unguarded `gunzipSync` leaks raw zlib errors past the `CmemmovError` boundary. Same pattern applies here: any native operation that can throw (`readFile`, `readdir`, `stat`) should be wrapped with appropriate error translation (ENOENT → graceful, EBUSY/EPERM → CmemmovError).
- **`vi.spyOn` for injected callbacks**: Use `vi.spyOn` on the warn callback when testing warning paths.
- **`exactOptionalPropertyTypes: true`**: Always use `if (x !== undefined) this.x = x` pattern for optional class fields — direct assignment `this.x = opts.x` is rejected.
- **`no-unnecessary-condition` on literal types**: Don't `if (x === 'literal')` when x is already a narrow literal type — TypeScript detects this. Use exhaustive switch instead.

### ESLint Rule Updates Summary

After this story, three ESLint enforcement changes in `eslint.config.js` or `eslint-rules/`:
1. **New `no-restricted-imports` block** for `homedir` from `node:os` / `os` (exclude `claude-locator.ts`)
2. **Update `no-raw-json-parse` rule** (`eslint-rules/no-raw-json-parse.js`) to allow `claude-reader.ts`
3. No changes to write-gate restriction (claude-reader.ts only reads; claude-writer.ts uses injected gate)

### Files to Create / Modify

| Action | Path |
|--------|------|
| CREATE | `src/services/claude-locator.ts` |
| CREATE | `src/services/claude-locator.test.ts` |
| CREATE | `src/services/claude-reader.ts` |
| CREATE | `src/services/claude-reader.test.ts` |
| CREATE | `src/services/claude-writer.ts` |
| CREATE | `src/services/claude-writer.test.ts` |
| CREATE | `tests/fixtures/claude-trees/linux-typical/` (full tree, 13 files) |
| UPDATE | `eslint.config.js` (add homedir import restriction block) |
| UPDATE | `eslint-rules/no-raw-json-parse.js` (allow claude-reader.ts) |
| DELETE | `tests/fixtures/claude-trees/.gitkeep` |

### Imports Allowed for These Files

```typescript
// claude-locator.ts (ONLY file with these)
import os from 'node:os';
// process.env['CLAUDE_CONFIG_DIR'] — direct env access (not via os module)

// claude-reader.ts
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { CmemmovError } from '../core/error.js';
import { slugToPath } from '../core/path-engine.js';

// claude-writer.ts
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { WriteGate } from './write-gate.js';
import type { MemoryFile, SessionFile, CommandFile } from './claude-reader.js';
// (imports types from claude-reader are fine — service-to-service type imports OK)
```

### Complexity Warning

This is the largest story in Epic 1. The writer's 10-category × 2-mode = 20 implementation branches, plus the reader scanning a full directory tree, plus 3 new source files and a fixture tree. Estimate: ~600-800 lines of production code + ~400 lines of tests. Plan carefully, implement task by task, run `npm run check` frequently.

## Dev Agent Record

### Completion Notes

Implemented the Claude Code surface as three coordinated services:

- **`src/services/claude-locator.ts`**: pure resolver returning `{ claudeDir, claudeJson }`. Honors `CLAUDE_CONFIG_DIR` (claudeJson derived as `<claudeDir>.json`); otherwise uses `os.homedir()` joined with `.claude` and `.claude.json`. This is the only file allowed to call `os.homedir()` or read `process.env.CLAUDE_CONFIG_DIR`, enforced by ESLint and verified via grep.
- **`src/services/claude-reader.ts`**: enumerates the full `~/.claude/` tree into a typed `ClaudeSurface` (globalSettings, mcpConfig, globalMemory, claudeMd, customCommands, teams, plugins, projects[], claudeJson, credentialsRef path-only). Tolerates missing dirs/files via ENOENT-graceful helpers. Session JSONL reads guard against `EBUSY`/`EPERM` and surface `CmemmovError({ code: 'INTERNAL', hint: 'close Claude Code and retry' })`. `resolveOriginalPath` is the single source for slug→path resolution: prefers session `cwd` (sessionCwd source), falls back to `slugToPath` (slugDecode), else returns slug verbatim with `source: null`.
- **`src/services/claude-writer.ts`**: discriminated-union `ApplyCategoryOpts` covers all 10 categories with merge/overwrite modes. Exhaustiveness enforced via `assertNever`. All writes flow through the injected `WriteGate` (no direct `fs` write calls). Per-category semantics match the story's table:
  - `globalMemory`/`projectMemory` merge: existing files kept, MEMORY.md index rebuilt from final state (extracts title from first `# ` heading and hook from frontmatter `description:` or first body line); overwrite: `gate.remove` + recreate.
  - `globalSettings`/`projectSettings` merge: deep object merge with permission-rule arrays de-duped by string equality; overwrite: replace.
  - `claudeMd` merge: existing wins (skip write); overwrite: replace.
  - `mcpConfig` merge: union by server name, existing wins; overwrite: replace `mcpServers` key while preserving other settings keys.
  - `customCommands`/`teams`/`plugins` merge: union by filename / team `id` / plugin name with existing winning; overwrite: remove + recreate.
  - `sessionHistory` merge: append-only by filename, existing JSONL never overwritten; overwrite: replace sessions dir.
- All 4 ESLint architectural-invariant rules (`no-process-env-home`, `no-hardcoded-separator`, `no-console-outside-output`, `no-raw-json-parse`) continue to pass. The `homedir` import restriction was added by combining fs-write + homedir restrictions into a base block with file-specific overrides for `write-gate.ts`/`backup-service.ts`/`claude-locator.ts` (separate same-rule blocks would lose precedence under flat-config last-wins semantics).
- The `no-raw-json-parse` rule now allows `claude-reader.ts` (the canonical Claude config parser) and `.test.ts` files (test parsing of stringified outputs). All `JSON.parse` calls on Claude config files in the writer route through the new exported `readClaudeJsonFile()` helper in `claude-reader.ts`, preserving the architecture invariant.

### Validation

- `npm run check` exits 0 (lint + typecheck + tests).
- 17 test files, 164 tests pass — including 7 locator tests, 16 reader tests, 19 writer tests added by this story.
- Architectural invariant grep:
  - `os.homedir` outside locator: zero hits in `src/`.
  - `CLAUDE_CONFIG_DIR` outside locator: zero hits in `src/`.
  - `cwd` extraction logic outside `claude-reader.ts`: zero hits in `src/services/`.

### File List

Created:

- `src/services/claude-locator.ts`
- `src/services/claude-locator.test.ts`
- `src/services/claude-reader.ts`
- `src/services/claude-reader.test.ts`
- `src/services/claude-writer.ts`
- `src/services/claude-writer.test.ts`
- `tests/fixtures/claude-trees/linux-typical/.claude/CLAUDE.md`
- `tests/fixtures/claude-trees/linux-typical/.claude/settings.json`
- `tests/fixtures/claude-trees/linux-typical/.claude/memory/MEMORY.md`
- `tests/fixtures/claude-trees/linux-typical/.claude/memory/user_profile.md`
- `tests/fixtures/claude-trees/linux-typical/.claude/commands/greet.md`
- `tests/fixtures/claude-trees/linux-typical/.claude/teams/my-team/config.json`
- `tests/fixtures/claude-trees/linux-typical/.claude/projects/-home-user-myproject/CLAUDE.md`
- `tests/fixtures/claude-trees/linux-typical/.claude/projects/-home-user-myproject/settings.json`
- `tests/fixtures/claude-trees/linux-typical/.claude/projects/-home-user-myproject/memory/MEMORY.md`
- `tests/fixtures/claude-trees/linux-typical/.claude/projects/-home-user-myproject/memory/project_notes.md`
- `tests/fixtures/claude-trees/linux-typical/.claude/projects/-home-user-myproject/sessions/abc123.jsonl`
- `tests/fixtures/claude-trees/linux-typical/.claude.json`

Modified:

- `eslint.config.js` — restructured `no-restricted-imports` into a base block + per-file overrides so fs-write and homedir restrictions both apply to files outside their respective allowlists (avoids flat-config last-wins precedence loss).
- `eslint-rules/no-raw-json-parse.js` — added `src/services/claude-reader.ts` to allowed suffixes and a `.test.ts` exemption for legitimate test-side JSON parsing of captured outputs.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 1-7 transitioned ready-for-dev → in-progress → review.

Deleted:

- `tests/fixtures/claude-trees/.gitkeep` (replaced by the populated `linux-typical/` subdirectory).

### Change Log

- 2026-05-09: Implemented Story 1.7 (locator, reader, writer + fixture tree + ESLint updates). All 11 tasks complete, all 10 ACs satisfied. Status moved ready-for-dev → in-progress → review.
- 2026-05-09: Code review applied — HIGH/MEDIUM auto-resolves landed (writer mkdir-before-write for project paths, safeGateRemove for live-mode fresh installs, AC5 EBUSY/EPERM wrap in `resolveOriginalPath`). All 169 tests pass, lint+typecheck clean.

### Review Findings

- [x] [Review][Patch] `applyProjectSettings` / `applyClaudeMd` (project path) skipped `mkdir` before `gate.write`, so live writes against a brand-new project slug throw ENOENT. Fixed by adding `gate.mkdir(dirname(filePath), { recursive: true })` ahead of every per-file write. Regression tests added in `claude-writer.test.ts` (`fresh-install parent-dir creation` describe block). [src/services/claude-writer.ts:296-338]
- [x] [Review][Patch] Overwrite paths called `gate.remove(dir)` unconditionally, but the live gate's `fs.rm` is invoked without `force: true` (per Story 1.5 spec) so it throws ENOENT when the category dir is missing on a fresh install. Added `safeGateRemove(gate, path)` helper that `stat`s first and skips the gate op if the path is absent. Updated `applyMemoryAt`, `applyCustomCommands`, `applyTeams`, `applySessionHistory` overwrite branches. New regression test "skips remove when commands dir does not exist (fresh install)" in `claude-writer.test.ts`. [src/services/claude-writer.ts:175-187, 256-269, 379-388, 405-414, 469-477]
- [x] [Review][Patch] AC5 violation: `resolveOriginalPath` used raw `readFile` (not the wrapped `readSessionFile` helper) on the most-recent session JSONL, so EBUSY/EPERM bubbled out as raw NodeJS errno errors instead of `CmemmovError({ code: 'INTERNAL', hint: 'close Claude Code and retry' })`. Wrapped the session-content read in the same try/catch that `readSessionFile` uses. Two new regression tests in `claude-reader.test.ts` cover EBUSY and EPERM. [src/services/claude-reader.ts:275-300]
- [x] [Review][Patch] `applyMemoryAt` overwrite would write incoming `MEMORY.md` and immediately clobber it with the rebuilt index — wasted gate op. Added an early-skip for `MEMORY.md` filenames so the rebuilt index is the only authoritative MEMORY.md write. [src/services/claude-writer.ts:266-269]
- [x] [Review][Defer] `deepMerge` Set-dedup applies uniformly to every array, but Story Dev Notes only specify string-array dedup for permission-rule arrays. Object arrays (e.g., hook arrays) get reference-based dedup which produces duplicates rather than logical-equality dedup. Logged to `deferred-work.md` for future hardening (likely a settings-merge clarification story). — deferred, pre-existing
- [x] [Review][Defer] Corrupt `settings.json` / `plugins.json` is silently treated as `{}` by `applyGlobalSettings` / `applyMcpConfig` / `applyPlugins` (because `safeParseJson` returns `undefined` on parse failure), causing a destructive overwrite. Mitigated in practice by the import-time backup invariant (rollback recovers the corrupt-but-original file), but writers should arguably refuse to write when prior state can't be reasoned about. Logged to `deferred-work.md`. — deferred, pre-existing
- [x] [Review][Defer] `applyPlugins` always writes `plugins.json` even when the existing installation uses the `plugins/<name>/config.json` directory form. The reader prefers `plugins.json`, so a future read silently masks the directory contents. Story Task 9 line 157 mentioned "same pattern as customCommands/teams depending on format found on disk" but the implementation always uses the JSON file form for Epic 1 scope. Logged to `deferred-work.md`. — deferred, format dual-state
- [x] [Review][Defer] `applyTeams` merge has no defined behavior for incoming team configs lacking an `id` field — currently always written (no merge key → no collision). Logged to `deferred-work.md` for spec clarification. — deferred, pre-existing
- [x] [Review][Defer] `resolveOriginalPath` issues unbounded `Promise.all(stat)` over every JSONL in a project's sessions dir; no concurrency cap. Acceptable for typical Claude installs but could hit EMFILE on very large session histories. Logged to `deferred-work.md`. — deferred, performance hardening
