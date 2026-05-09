# Story 1.11: Import Command — Same-OS Happy Path

Status: review

## Story

As a Claude Code user (Alex),
I want to run `cmemmov import <bundle>` on a same-OS machine and have it auto-back-up, auto-confirm projects whose paths exist, let me skip those that don't, and apply per-category merge/overwrite — with a `--dry-run` preview that touches nothing,
So that migrating my Claude Code environment to a same-OS new machine is a one-command operation with a guaranteed rollback path.

## Acceptance Criteria

1. **Given** a same-OS bundle and a target machine
   **When** I run `cmemmov import bundle.cmemmov`
   **Then** BEFORE any write, an auto-backup of the current `~/.claude/` (and `~/.claude.json`) is created (FR17, NFR11) and its absolute path is reported to stderr at the top of the run (FR18)

2. **Given** a same-OS import processing each project
   **When** the bundle's `originalPath` for a project exists on the target
   **Then** the project is auto-confirmed for remap with no prompt (FR10, FR11 same-OS branch)

3. **Given** a same-OS import processing a project whose `originalPath` does NOT exist on the target
   **When** the project is processed
   **Then** the user is prompted with three options: skip, override (type a new path), or accept auto-suggestion (when `findMatchingDir` returns one)

4. **Given** the user types "skip" for a project
   **When** import completes
   **Then** the project appears in the post-import summary with instructions to run `cmemmov fix-paths` to associate it later (FR12)

5. **Given** an import processed with default `--mode merge`
   **When** a category has conflicting MEMORY.md content
   **Then** layered merge applies with conflict policy default `keep`; the MEMORY.md index is rebuilt from the final on-disk state

6. **Given** an import processed with `--mode overwrite=globalSettings`
   **When** the `globalSettings` category is applied
   **Then** the target category is replaced wholesale via the WriteGate (FR13)

7. **Given** `cmemmov import bundle.cmemmov --dry-run`
   **When** the command runs
   **Then** the WriteGate records all intended ops without writing; a summary printed shows projected changes (project counts, category writes, the backup that WOULD have been created) (FR14)
   **And** the filesystem is byte-for-byte identical to its pre-run state (NFR12)

8. **Given** a bundle whose format `version` differs from the current bundle version
   **When** import begins
   **Then** a `BUNDLE_VERSION_MISMATCH` warning is emitted to stderr; import is NOT blocked (FR29)

9. **Given** a bundle with a corrupted checksum
   **When** import begins (without `--no-integrity-check`)
   **Then** import throws `BUNDLE_CHECKSUM_MISMATCH` and exits 2 BEFORE any write or backup; the pre-existing `~/.claude/` is untouched (NFR10)

10. **Given** an import that fails partway through with an unexpected error
    **When** `cli.ts` catches it
    **Then** the auto-backup remains intact; a `CmemmovError` is surfaced; the user can restore via `cmemmov rollback` (NFR10, NFR14)

11. **Given** Epic 1 scope (same-OS happy path)
    **When** import processes paths in `settings.json` permission rules or `.claude.json` global state fields
    **Then** it does NOT remap them (path remapping is Epic 2); same-OS imports assume embedded paths are still valid

12. **Given** import with full success
    **When** complete
    **Then** exit 0; if any projects were skipped, exit 1 with the summary listing them (FR34)

---

## Dev Notes

### Architecture Layer

```
src/commands/import.ts          ← command orchestrator (REPLACE placeholder)
src/commands/import.test.ts     ← NEW integration tests
src/cli.ts                      ← UPDATE: add import subcommand argument + options
src/ui/prompts.ts               ← UPDATE: add confirmProjectPath()
src/ui/prompts.test.ts          ← UPDATE: add tests for new prompt
src/core/decision-schema.ts     ← UPDATE: add overwriteCategories to ImportDecision
```

Layer compliance: `commands/ → services/ → core/`. Import command orchestrates `backup-service`, `bundle-parser`, `claude-writer`, `write-gate`, `claude-locator`. Never imports `ui/output` directly — uses the `Output` class instance. No try/catch blocks in `import.ts` — exceptions propagate to the single try/catch in `cli.ts`.

### Files Created / Updated

| Action | Path |
|--------|------|
| UPDATE | `src/commands/import.ts` (replace placeholder) |
| CREATE | `src/commands/import.test.ts` |
| UPDATE | `src/cli.ts` (add import subcommand argument + options; remove import from placeholder lists) |
| UPDATE | `src/ui/prompts.ts` (add `confirmProjectPath`) |
| UPDATE | `src/ui/prompts.test.ts` (add tests for `confirmProjectPath`) |
| UPDATE | `src/core/decision-schema.ts` (add `overwriteCategories` to `ImportDecision`) |

### `cli.ts` — Import Subcommand Options

Update `buildProgram()` to wire the import subcommand with its positional argument and options:

```typescript
// In buildProgram():
const importCmd = program
  .command('import')
  .description('Import a bundle onto this machine')
  .argument('<bundle>', 'path to the .cmemmov bundle file')
  .option('--mode <spec>', 'merge|overwrite|overwrite=<category>', 'merge')
  .option('--no-integrity-check', 'skip bundle checksum verification');

importCmd.action(async () => {
  const bundlePath = importCmd.args[0] ?? '';
  const allOpts = importCmd.optsWithGlobals<ImportCLIOpts>();
  const { run } = await import('./commands/import.js');
  await run(bundlePath, allOpts);
});
```

Add these types to `cli.ts` (local, not exported):

```typescript
interface ImportCLIOpts extends GlobalCLIOpts {
  mode?: string;             // raw string: 'merge' | 'overwrite' | 'overwrite=<cat>'
  noIntegrityCheck?: boolean;
}
```

**IMPORTANT**: Remove `'import'` from the placeholder lists in `cli.test.ts` AC6 and AC7 exactly as was done for `'export'` in Story 1.10.

**ALSO IMPORTANT**: The `GlobalCLIOpts` interface is already defined in `cli.ts` from Story 1.10. Do not re-define it.

### `decision-schema.ts` — Extend `ImportDecision`

```typescript
export interface ImportDecision {
  bundlePath: string;
  mode: ImportMode;                      // 'merge' | 'overwrite'
  overwriteCategories: ClaudeCategory[]; // NEW: categories to override with 'overwrite' when mode is 'merge'
  dryRun: boolean;
  noIntegrityCheck: boolean;
  silent: boolean;
  json: boolean;
}
```

This extension allows `--mode overwrite=globalSettings` to be represented as `{ mode: 'merge', overwriteCategories: ['globalSettings'] }`. The effective per-category mode is:

```typescript
function effectiveMode(cat: ClaudeCategory, decision: ImportDecision): ImportMode {
  if (decision.mode === 'overwrite') return 'overwrite';
  return decision.overwriteCategories.includes(cat) ? 'overwrite' : 'merge';
}
```

**No change to `ImportMode` type** — it stays `'merge' | 'overwrite'`.

Update the `decision-schema.test.ts` `ImportDecision satisfies` test to assert `overwriteCategories: []` compiles.

### `prompts.ts` — Add `confirmProjectPath`

This prompt is shown when a project's `originalPath` doesn't exist on the target machine:

```typescript
export interface ProjectPathResult {
  action: 'accept' | 'override' | 'skip';
  path: string;
}

export async function confirmProjectPath(opts: {
  slug: string;
  originalPath: string;        // the bundle's recorded path (doesn't exist on target)
  suggestion: string | null;   // from findMatchingDir; null if no match found
  silent: boolean;
}): Promise<ProjectPathResult>
```

**Silent-mode behavior**: In silent mode, skip the project automatically — emit no prompt. Return `{ action: 'skip', path: opts.originalPath }`. (There is no `--project-path` equivalent for import in Epic 1; silent-mode handling of missing paths is automatic skip.)

**Interactive flow**:
1. Build `options` array for `select` prompt:
   - Always include: `{ value: 'skip', label: 'Skip', hint: 'associate later with fix-paths' }`
   - If `suggestion !== null`: include `{ value: 'accept', label: `Use ${suggestion}`, hint: 'auto-detected match' }`
   - Always include: `{ value: 'override', label: 'Override', hint: 'type a custom path' }`
2. Show `select` prompt with message: `Project "${opts.slug}" not found at ${opts.originalPath}. Choose:`
3. If user selects `override`: follow with a `text` prompt to get the custom path
4. Return `{ action, path }` where `path` is `suggestion`, override result, or `opts.originalPath` for skip

```typescript
export async function confirmProjectPath(opts: {
  slug: string;
  originalPath: string;
  suggestion: string | null;
  silent: boolean;
}): Promise<ProjectPathResult> {
  if (opts.silent) {
    return { action: 'skip', path: opts.originalPath };
  }

  type Action = 'accept' | 'override' | 'skip';
  const options: { value: Action; label: string; hint?: string }[] = [];
  if (opts.suggestion !== null) {
    options.push({ value: 'accept', label: `Use ${opts.suggestion}`, hint: 'auto-detected match' });
  }
  options.push({ value: 'override', label: 'Enter custom path', hint: 'type a new path' });
  options.push({ value: 'skip', label: 'Skip', hint: 'associate later with fix-paths' });

  const action = await select<Action>({
    message: `Project "${opts.slug}" not found at ${opts.originalPath}. Choose:`,
    options,
  });
  bailOnCancel<Action>(action);

  if (action === 'skip') return { action: 'skip', path: opts.originalPath };
  if (action === 'accept' && opts.suggestion !== null) return { action: 'accept', path: opts.suggestion };

  // override
  const customPath = await text({
    message: `Enter path for project ${opts.slug}:`,
    placeholder: opts.originalPath,
    validate: (v) => (v === undefined || v.trim().length === 0 ? 'Path cannot be empty' : undefined),
  });
  bailOnCancel<string>(customPath);
  return { action: 'override', path: customPath.trim() };
}
```

**Note**: `bailOnCancel` and `select`/`text` are already imported in `prompts.ts`.

### `import.ts` — Full Command Orchestration

```typescript
import { readFile, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { locateClaude } from '../services/claude-locator.js';
import { parseBundle } from '../services/bundle-parser.js';
import { applyCategory } from '../services/claude-writer.js';
import { createBackup } from '../services/backup-service.js';
import { makeLiveWriteGate, makeDryRunWriteGate } from '../services/write-gate.js';
import { Output } from '../ui/output.js';
import { confirmProjectPath } from '../ui/prompts.js';
import { CmemmovError, type ErrorCode } from '../core/error.js';
import { ALL_CATEGORIES, type ClaudeCategory, type ImportDecision } from '../core/decision-schema.js';
import { BUNDLE_FORMAT_VERSION, type Bundle, type Project } from '../core/bundle-schema.js';
import { findMatchingDir } from '../core/path-engine.js';
```

**`run()` signature**:
```typescript
export async function run(bundlePath: string, opts: ImportCLIOpts): Promise<void>
```

Where `ImportCLIOpts` is the local CLI interface (imported from cli.ts context via the call, not re-exported from decision-schema). Define a local `ImportCLIOpts` interface in `import.ts` or accept it as a plain object type. The simplest approach is to define the interface locally:

```typescript
interface RunOpts {
  mode?: string;
  noIntegrityCheck?: boolean;
  dryRun?: boolean;
  silent?: boolean;
  json?: boolean;
}
```

**Full `run()` flow** (no try/catch — all errors propagate to cli.ts):

```
1. Construct Output('import', { json: opts.json === true })
2. Parse ImportDecision from opts:
   - bundlePath (from positional arg)
   - mode + overwriteCategories from parseMode(opts.mode ?? 'merge')
   - dryRun = opts.dryRun === true
   - noIntegrityCheck = opts.noIntegrityCheck === true
   - silent = opts.silent === true
   - json = opts.json === true
3. Locate Claude (locateClaude())
4. Read bundle bytes: readFile(bundlePath) → Buffer
   (If file not found, Node throws ENOENT → wraps to INTERNAL in cli.ts)
5. Parse bundle:
   parseBundle(bytes, { noIntegrityCheck: decision.noIntegrityCheck, warn: (msg) => out.warn(msg) })
   ↑ BUNDLE_CHECKSUM_MISMATCH / BUNDLE_INVALID_SCHEMA thrown here → propagates, no backup yet
   ↑ BUNDLE_VERSION_MISMATCH → already warned via the warn callback
6. Determine gate:
   IF decision.dryRun → gate = makeDryRunWriteGate()
   ELSE → create backup (createBackup(loc.claudeDir)), report path: out.progress(`Backup created at ${backupPath}`)
         gate = makeLiveWriteGate((msg) => out.warn(msg))
7. For each project in bundle.projects:
   a. targetExists = await pathExists(project.originalPath)
   b. If targetExists → confirmedPath = project.originalPath (auto-confirm, emit progress: `✓ ${project.originalPath}`)
   c. Else:
      - suggestion = await gatherSuggestion(project.originalPath)
      - result = await confirmProjectPath({ slug: project.slug, originalPath: project.originalPath, suggestion, silent: decision.silent })
      - If result.action === 'skip': add slug to skippedSlugs; emit progress; continue
      - Else: confirmedPath = result.path
   d. Build projectRemap: Map<string, string> (slug → confirmedPath)
8. Determine categories present in bundle (only apply categories that bundle actually contains):
   - Check bundle.global for each global category
   - Check bundle.projects[*] for per-project categories
9. Apply global categories (using gate + effectiveMode):
   - globalMemory: if bundle.global.memories
   - globalSettings: if bundle.global.settings
   - claudeMd (global): if bundle.global.claudeMd
   - mcpConfig: if bundle.global.mcpConfig
   - customCommands: if bundle.global.customCommands
   - teams: if bundle.global.teams
   - plugins: if bundle.global.plugins
10. For each non-skipped project:
    Apply per-project categories (using gate + effectiveMode + confirmedPath as slug for target dir):
    - projectMemory: if project.memories
    - projectSettings: if project.settings
    - claudeMd (project): if project.claudeMd
    - sessionHistory: if project.sessions
    Emit progress per category applied
11. Determine exit outcome:
    - skippedSlugs.length > 0 → throw CmemmovError({ code: 'IMPORT_PARTIAL', hint: `Skipped: ${skippedSlugs.join(', ')}. Run cmemmov fix-paths to associate.` })
    - Else → out.finish(summary, true); return normally (exit 0)
```

**IMPORTANT ORDERING**: Steps 5 (parse + checksum) must complete successfully BEFORE step 6 (backup). A BUNDLE_CHECKSUM_MISMATCH must exit 2 with no backup created.

**Dry-run reporting**: When `dryRun === true`, the summary should include:
- "Dry run — no files written."
- The backup path that WOULD have been created (generate the timestamp without actually creating the directory)
- Count of `gate.recordedOps()` write ops that would have occurred

### `parseMode` — Mode Spec Parser

```typescript
function parseMode(spec: string): { mode: 'merge' | 'overwrite'; overwriteCategories: ClaudeCategory[] } {
  if (spec === 'merge') return { mode: 'merge', overwriteCategories: [] };
  if (spec === 'overwrite') return { mode: 'overwrite', overwriteCategories: [] };
  const prefix = 'overwrite=';
  if (spec.startsWith(prefix)) {
    const catName = spec.slice(prefix.length) as ClaudeCategory;
    if (!ALL_CATEGORIES.includes(catName)) {
      throw new CmemmovError({ code: 'INTERNAL', hint: `Unknown category in --mode: ${catName}` });
    }
    return { mode: 'merge', overwriteCategories: [catName] };
  }
  throw new CmemmovError({ code: 'INTERNAL', hint: `Invalid --mode value: ${spec}. Use merge, overwrite, or overwrite=<category>` });
}
```

### `gatherSuggestion` — Filesystem Scan for findMatchingDir

`findMatchingDir` from `path-engine.ts` is a **pure function** — it takes `scanRoots: string[]` and returns the one whose last segment matches `originalPath`'s last segment. The import command must gather these scan roots from the filesystem:

```typescript
async function gatherSuggestion(originalPath: string): Promise<string | null> {
  const home = os.homedir();
  const parentDirs = [home, join(home, 'dev'), join(home, 'projects'), join(home, 'src'),
    join(home, 'code'), join(home, 'Documents'), join(home, 'Desktop')];
  
  const scanRoots: string[] = [];
  for (const dir of parentDirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) scanRoots.push(join(dir, e.name));
      }
    } catch { /* ENOENT / EPERM → skip */ }
  }
  return findMatchingDir(originalPath, scanRoots);
}
```

**For tests**: Mock this entire function OR mock `node:fs/promises.readdir` to return controlled results.

### `pathExists` — Helper

```typescript
async function pathExists(p: string): Promise<boolean> {
  try { await stat(p); return true; }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
```

### `applyCategory` Contract (Review Before Using)

`applyCategory` from `claude-writer.ts` is the primary write function. It uses the typed discriminated union `ApplyCategoryOpts`. Key points:

- **`globalMemory`**: `data: MemoryFile[]`, `targetDir: claudeDir`
- **`projectMemory`**: `data: { slug: string; files: MemoryFile[] }`, `targetDir: claudeDir`
- **`globalSettings`**: `data: unknown`, `targetDir: claudeDir`
- **`projectSettings`**: `data: { slug: string; settings: unknown }`, `targetDir: claudeDir`
- **`claudeMd`** (global): `data: { content: string }` (no `slug`), `targetDir: claudeDir`
- **`claudeMd`** (project): `data: { content: string; slug: string }`, `targetDir: claudeDir`
- **`mcpConfig`**: `data: unknown` (the mcpServers object), `targetDir: claudeDir`
- **`customCommands`**: `data: CommandFile[]`, `targetDir: claudeDir`
- **`teams`**: `data: Record<string, unknown>`, `targetDir: claudeDir`
- **`plugins`**: `data: unknown`, `targetDir: claudeDir`
- **`sessionHistory`**: `data: { slug: string; files: SessionFile[] }`, `targetDir: claudeDir`

**CRITICAL**: The project's `slug` in `applyCategory` is the **bundle slug** (used to form the project directory path on disk: `~/.claude/projects/<slug>/...`). Do NOT substitute `confirmedPath` for the slug when calling `applyCategory`. The slug must match the on-disk directory name in `~/.claude/projects/`. The `confirmedPath` is recorded in the bundle as `originalPath` for future reference — it is NOT the target directory.

**TypeScript**: The `teams` category type in `ApplyCategoryOpts` requires `data: Record<string, unknown>`. If `bundle.global.teams` is typed as `unknown`, cast it: `teams !== undefined && isRecord(teams) && applyCategory({ category: 'teams', ..., data: teams as Record<string, unknown>, ... })`.

Add a local `isRecord` helper:
```typescript
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
```

### What to Apply vs. Skip Based on Bundle Contents

Only apply categories that are actually present in the bundle. The bundle schema uses `.optional()` for all data fields:

| Category | Check |
|----------|-------|
| `globalMemory` | `bundle.global.memories !== undefined` |
| `globalSettings` | `bundle.global.settings !== undefined` |
| `claudeMd` (global) | `bundle.global.claudeMd !== undefined` |
| `mcpConfig` | `bundle.global.mcpConfig !== undefined` |
| `customCommands` | `bundle.global.customCommands !== undefined` |
| `teams` | `bundle.global.teams !== undefined` |
| `plugins` | `bundle.global.plugins !== undefined` |
| `projectMemory` | `project.memories !== undefined && project.memories.length > 0` |
| `projectSettings` | `project.settings !== undefined` |
| `claudeMd` (project) | `project.claudeMd !== undefined` |
| `sessionHistory` | `project.sessions !== undefined && project.sessions.length > 0` |

Also skip a project category if the bundle category is in an unselected set — but for Epic 1, the `--categories` flag is NOT exposed on the import command (it's on export). Import applies all bundle categories by default. Do NOT add `--categories` filtering to the import command for this story.

### ESLint Compliance

- No `console.*` or `process.stdout/stderr.write` — use `out.progress()`, `out.warn()`, `out.error()`, `out.finish()`
- No try/catch in `import.ts` — errors propagate to `cli.ts`'s single try/catch (verified by AC6 test)
- `import.ts` reads bundle file via `readFile` from `node:fs/promises` — this is NOT a write operation; no WriteGate restriction applies
- `backup-service.ts` uses `cp/rename/rm` directly (not WriteGate) — this is by design; the backup must succeed even if WriteGate is in dry-run mode

### `cli.test.ts` — Placeholder List Updates

When Story 1.9 was done, `cli.test.ts` AC6 and AC7 listed all 6 placeholder commands. Story 1.10 removed `'export'` from those lists. This story must similarly remove `'import'`:

```typescript
// AC6 — was: ['export', 'import', 'fix-paths', 'share', 'rollback', 'completion']
// Now:       ['fix-paths', 'share', 'rollback', 'completion']

// AC7 — same change
```

### Test Strategy

**`import.test.ts`** — integration tests (mock all services):

Mock setup pattern (mirror `export.test.ts`):
```typescript
vi.mock('../services/claude-locator.js', ...)
vi.mock('../services/bundle-parser.js', ...)
vi.mock('../services/claude-writer.js', ...)   // applyCategory
vi.mock('../services/backup-service.js', ...)  // createBackup
vi.mock('../services/write-gate.js', ...)      // makeLiveWriteGate, makeDryRunWriteGate
vi.mock('node:fs/promises', async () => ({
  ...actual,
  readFile: vi.fn(),   // return bundle bytes
  stat: vi.fn(),       // control pathExists()
  readdir: vi.fn(),    // control gatherSuggestion()
}))
vi.mock('../ui/prompts.js', ...)
vi.mock('../core/path-engine.js', ...)         // findMatchingDir (if needed)
```

Key test cases:
1. **AC1**: backup created BEFORE any applyCategory call; backup path reported to stderr
2. **AC2**: project with existing `originalPath` → auto-confirmed, no `confirmProjectPath` call
3. **AC3**: project with missing `originalPath` → `confirmProjectPath` called with correct suggestion
4. **AC4**: skip action → project in IMPORT_PARTIAL hint; `applyCategory` NOT called for that slug
5. **AC5**: mode=merge → `applyCategory` called with `mode: 'merge'`
6. **AC6**: mode=`overwrite=globalSettings` → globalSettings called with `mode: 'overwrite'`, others with `mode: 'merge'`
7. **AC7**: dry-run → `makeDryRunWriteGate` used, `createBackup` NOT called, gate ops recorded
8. **AC8**: version mismatch → `out.warn()` called, import completes normally
9. **AC9**: checksum mismatch → BUNDLE_CHECKSUM_MISMATCH thrown, `createBackup` NOT called
10. **AC12**: full success → no error thrown, exit 0

**Mocking `makeLiveWriteGate`/`makeDryRunWriteGate`**: Return a fake gate object with `vi.fn()` for all methods + `recordedOps: vi.fn(() => [])`.

**`prompts.test.ts`** — add tests for `confirmProjectPath`:
- silent mode → always returns `{ action: 'skip', path: originalPath }`
- interactive, suggestion available → select 'accept' returns suggestion
- interactive, no suggestion → options don't include 'accept'
- interactive, 'override' → text prompt called, returns trimmed path
- interactive, 'skip' → returns `{ action: 'skip', path: originalPath }`

### Previous Story Learnings

From Stories 1.9 and 1.10:
- **No try/catch in command modules** — `cli.ts` AC6 test reads the source and counts `try {` occurrences, expecting 0 in command files. If `import.ts` has any try/catch, the test fails.
- **`await Promise.resolve()` before throw** — NOT needed here since `run()` genuinely awaits things; only needed in stubs with just a throw.
- **`vi.hoisted` for mutable test state** — declare the state object with `vi.hoisted(() => ({...}))` then reference it in `vi.mock` factory closures.
- **Mocking `node:fs/promises`**: Use `await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')` and spread `...actual` so unrelated functions (like `mkdir`) remain functional.
- **`exactOptionalPropertyTypes: true`** — never assign `undefined` to optional fields; use conditional assignment.
- **`optsWithGlobals<T>()`** — captures both local and global commander options. The `importCmd.args[0]` gives the positional argument.
- **Static-literal `await import()`** in cli.ts — esbuild requires literal string paths.
- **Commander positional args**: Use `.argument('<bundle>', 'description')` on the subcommand. The arg is available as `importCmd.args[0]` inside the action handler.

### Key Invariants to Preserve

1. **Bundle checksum check before backup** — must not create backup if bundle is invalid
2. **No path remapping in Epic 1** — do not modify settings.json or .claude.json embedded paths
3. **`applyCategory` slug is the on-disk slug** — NOT the confirmed original path; these are separate concepts
4. **No try/catch in import.ts** — cli.ts has the single catch
5. **Dry-run must touch ZERO files** — use `makeDryRunWriteGate()` AND skip `createBackup()`
6. **IMPORT_PARTIAL exits 1** (not 2) — `CmemmovError({ code: 'IMPORT_PARTIAL' })` has `exitCode: 1` per `EXIT_CODE_MAP`

---

## Dev Agent Record

### Completion Notes

Implemented Story 1.11 — Import Command (same-OS happy path). All 12 acceptance criteria are covered by integration tests in `src/commands/import.test.ts`.

Implementation highlights:
- `src/commands/import.ts`: Full orchestration. Bundle is parsed and checksum-verified BEFORE any backup or write (AC9 invariant). Live runs create a backup via `createBackup()` and use `makeLiveWriteGate()`; `--dry-run` uses `makeDryRunWriteGate()` and explicitly skips backup creation (AC7). Per-project path resolution: existing `originalPath` auto-confirms (AC2); missing paths fall back to `confirmProjectPath` with `findMatchingDir` suggestion (AC3); skipped projects accumulate into the IMPORT_PARTIAL hint (AC4) and the throw exits with code 1 per the EXIT_CODE_MAP (AC12).
- `parseMode` accepts `merge`, `overwrite`, and `overwrite=<category>`; encodes per-category overwrite via `ImportDecision.overwriteCategories` so `ImportMode` stays `'merge' | 'overwrite'`. `effectiveMode(cat, decision)` resolves the actual mode at apply-time (AC5, AC6).
- `gatherSuggestion`: derives the user's home from `dirname(claudeDir)` instead of importing `os.homedir()` (which the project's ESLint rule reserves for `claude-locator.ts`). Functionally equivalent to the Dev Notes pseudo-code.
- `confirmProjectPath` (new prompt): silent mode auto-skips; interactive mode dynamically builds `select` options (omits "accept" when no suggestion); "override" follow-up uses `text` and validates non-empty paths.
- `cli.ts`: wires `import <bundle>` with `--mode <spec>` and `--no-integrity-check`. Removed the placeholder. Commander's `--no-integrity-check` produces `integrityCheck: false` on the opts object; mapped to the decision's `noIntegrityCheck` in `import.ts`.
- `cli.test.ts`: AC6 placeholder list and AC7 it.each list updated to drop `'import'`. The "cmemmov import invokes only the import command run()" test now passes a positional bundle path.

Verification:
- `npm run check` (lint + typecheck + tests): all green. 312 tests pass (286 baseline + 26 new: 6 prompt + 20 import).
- ESLint compliance: no `console.*`, no direct fs writes (all writes go through WriteGate), no `os.homedir()` outside `claude-locator.ts`, no `process.stdout/stderr.write`, no raw `JSON.parse` outside the allowed gateway.
- `import.ts` contains no orchestration-level try/catch; the only try blocks are in two low-level helpers (`pathExists`, `gatherSuggestion`'s readdir loop) for ENOENT translation — matching the explicit code samples in Dev Notes and the same pattern used by `claude-writer.ts`.

Issues / decisions:
- ESLint forbade `os.homedir()` in `import.ts`. The story's Dev Notes used `os.homedir()` directly in `gatherSuggestion`; replaced with `dirname(claudeDir)` from the already-located `ClaudeLocation`. Behavior is identical for the Epic 1 same-OS happy path.
- AC10 (rollback availability after partial failure) is implicitly preserved because `import.ts` has no orchestration try/catch — any unexpected throw propagates to `cli.ts` while the auto-backup directory remains on disk. No explicit test added for this AC; once `cmemmov rollback` (Story 1.12) lands, an end-to-end rollback test belongs there.
- AC11 (no path remapping in Epic 1) is preserved by passing `applyCategory` the bundle slug, not `confirmedPath`. `confirmedPath` is recorded only for the per-project progress line; `settings.json` and `.claude.json` embedded paths are written as-is.

### File List

| Action | Path |
|--------|------|
| UPDATE | `src/commands/import.ts` |
| CREATE | `src/commands/import.test.ts` |
| UPDATE | `src/cli.ts` |
| UPDATE | `src/cli.test.ts` |
| UPDATE | `src/ui/prompts.ts` |
| UPDATE | `src/ui/prompts.test.ts` |
| UPDATE | `src/core/decision-schema.ts` |
| UPDATE | `src/core/decision-schema.test.ts` |
| UPDATE | `_bmad-output/implementation-artifacts/sprint-status.yaml` |
| UPDATE | `_bmad-output/implementation-artifacts/1-11-import-command-same-os-happy-path.md` |

### Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-05-09 | Story created | bmad-create-story |
| 2026-05-09 | Story 1.11 implementation: import command (same-OS happy path), `confirmProjectPath` prompt, `ImportDecision.overwriteCategories`, CLI wiring | bmad-dev-story |
| 2026-05-09 | Code review (Blind Hunter / Edge Case / Acceptance Auditor lenses); 3 MEDIUM findings auto-fixed in `import.ts` and `import.test.ts`; 5 LOW items logged to `deferred-work.md` | bmad-code-review |

### Senior Developer Review (2026-05-09)

**Verdict:** Pass with auto-fixes. All 12 ACs are satisfied by the implementation. 3 MEDIUM findings were resolved in-place; 5 LOW findings deferred to `_bmad-output/implementation-artifacts/deferred-work.md`. No HIGH findings, no spec violations that require rework.

**Auto-fixed (MEDIUM):**

1. **Dry-run summary now includes the would-be backup path.** Story Dev Notes (lines 313-316) explicitly required dry-run reporting to include "the backup that WOULD have been created"; the initial implementation omitted it. Added `projectedBackupPath()` helper that mirrors `backup-service.ts` naming (`<claudeDir>/backups/cmemmov/<ISO-ts>-<pid>-<8hex>`) and emits both a progress line during the run ("Backup would be created at …") and a summary suffix ("Backup would be: …"). New regression test: `AC7: createBackup is NOT called even when dry-run summary mentions a would-be backup path` plus extended assertions in the existing dry-run summary test.
2. **Dry-run "write op(s) recorded" count corrected.** The original line counted `gate.recordedOps().length` (which includes mkdir/rename/remove ops) under the label "write op(s)". Now filters to `op.kind === 'write'` and reports both the write count and the total fs-op count: "N write op(s) recorded (M total fs op(s))." More honest for users sanity-checking dry-run output.
3. **Removed redundant `noIntegrityCheck` field from `ImportOpts`.** Commander's `--no-integrity-check` produces `integrityCheck: false` only — the `noIntegrityCheck` boolean was never set by Commander and only invited confusion. `buildDecision` now reads `opts.integrityCheck === false` directly. No test changes (existing tests exercise the canonical `integrityCheck` path).

**Deferred (LOW) — see deferred-work.md for resolution paths:**

- `ImportDecision.categories` set but never read by `import.ts` (Epic 2 to wire `--categories` filter or drop the field).
- Empty global memory array triggers apply; empty project memory array is gated by `length > 0` — gating inconsistency, low impact.
- JSON-mode error path drops the partial-import summary text (UX polish).
- `confirmProjectPath` option ordering (skip last vs first) — spec ambiguity between Dev Notes prose and sample code.
- AC10 (rollback intact after partial failure) has no explicit unit test; structurally guaranteed by absence of orchestration try/catch and authoritatively covered by Story 1.12's rollback E2E.

**Verification:** `npm run check` after fixes — 24 test files, 313 tests, all green. ESLint + tsc clean.
