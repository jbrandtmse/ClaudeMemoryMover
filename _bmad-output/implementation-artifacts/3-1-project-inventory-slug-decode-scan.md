# Story 3.1: Project Inventory & Slug Decode Scan

Status: done

## Story

As a Claude Code user (Jordan),
I want `cmemmov fix-paths` to scan `~/.claude/projects/`, decode each slug to its original path (preferring session `cwd` over lossy slug reversal), and report which projects exist on disk vs. which are missing,
So that I can see at a glance which of my projects have orphaned memories from a moved or renamed directory — before any changes are proposed.

## Acceptance Criteria

**AC1 — Slug inventory with exists/source fields**

**Given** a populated `~/.claude/projects/` and I run `cmemmov fix-paths`
**When** the scan phase runs
**Then** stderr emits a progress line per project and a final summary line
**And** the inventory contains entries with `slug`, `decodedPath`, `exists` (boolean), and `source` (`sessionCwd` | `slugDecode` | `null`) per project (FR21)

**AC2 — Session cwd takes priority over slug decode**

**Given** a project slug whose path is recoverable from session JSONL `cwd` fields
**When** scan runs
**Then** `decodedPath` is taken from the most-recent session file's first `cwd` value; `source: 'sessionCwd'` is recorded
**And** `slugToPath` is NOT called for this project

**AC3 — Slug decode fallback for memory-only projects**

**Given** a project slug whose project directory has no session JSONL files (memory-only project)
**When** scan runs
**Then** `decodedPath` falls back to `slugToPath(slug, process.platform)`; `source: 'slugDecode'` is recorded
**And** if `slugToPath` returns `null` (structurally invalid slug), `decodedPath` is the slug verbatim and `source: null`

**AC4 — FOUND vs NOT FOUND**

**Given** a project's `decodedPath` exists on the filesystem
**When** checked
**Then** `exists: true`

**Given** a project's `decodedPath` does NOT exist
**When** checked
**Then** `exists: false`

**AC5 — Early exit when no projects need fixing**

**Given** all projects scan as FOUND, OR `~/.claude/projects/` is empty or does not exist
**When** scan completes
**Then** an informational message "No projects need fixing." is emitted to stderr
**And** `out.finish` is called with the success summary; the command exits 0
**And** no remap or apply phase runs (those belong to Stories 3.2 and 3.3)

**Note on `FIXPATHS_NO_PROJECTS`:** This error code (exit 1) in `error.ts` is reserved for Story 3.2's `--silent` path when there are no resolvable missing projects in non-interactive mode. Do NOT throw it in Story 3.1's scan phase.

**AC6 — `--json` mode output**

**Given** `cmemmov fix-paths --json`
**When** scan runs
**Then** progress lines go to stderr as normal
**And** the final `out.finish` call includes `extra: { projects: ProjectInventoryEntry[] }` so the stdout JSON object contains `summary.projects`

**AC7 — `--dry-run` scan is identical to live scan**

**Given** `cmemmov fix-paths --dry-run` with no remap phase to apply
**When** scan runs
**Then** behavior is identical to the live scan (no writes either way at scan time) — the dry-run flag is accepted and passed through; it governs the apply phase in Stories 3.3+, not the read-only scan

**AC8 — CLI wiring: opts passed to `run()`**

**Given** the `fix-paths` CLI command in `src/cli.ts`
**When** the command action fires
**Then** `optsWithGlobals()` is called on the fix-paths Command object and the resulting opts are passed to `run(opts)` (previously `run()` with no args)
**And** the fix-paths Command object is stored in a variable (like `fixPathsCmd`) so `.optsWithGlobals()` can be called inside the action callback

**AC9 — Unit tests for the scan phase**

**Given** `src/commands/fix-paths.test.ts` (new file)
**When** the test suite runs
**Then** it covers at minimum:
- (a) empty `~/.claude/projects/` → early exit, "No projects need fixing", exits 0
- (b) missing `~/.claude/projects/` directory → treated as empty → same early exit
- (c) one project FOUND via sessionCwd → `source: 'sessionCwd'`, `exists: true`
- (d) one project NOT FOUND via sessionCwd → `source: 'sessionCwd'`, `exists: false`
- (e) memory-only project (no session JSONL) → falls back to slugDecode
- (f) structurally invalid slug (slugToPath returns null) → `source: null`, decodedPath is slug verbatim
- (g) mixed tree (some FOUND, some NOT FOUND) → inventory has correct exists values; command returns normally (exit 0 in Story 3.1 before remap phase)
- (h) `--json` mode → `out.finish` receives `extra.projects` array

**AC10 — `npm run check` passes clean**

**Given** all changes in this story
**When** `npm run check` runs
**Then** it exits 0 with no errors and no TypeScript complaints

## Tasks / Subtasks

- [x] Task 1 — Update CLI to pass opts to fix-paths (AC: #8)
  - [x] 1.1 In `src/cli.ts`, store the fix-paths command in a variable:
    ```ts
    const fixPathsCmd = program
      .command('fix-paths')
      .description('Re-associate project slugs with new repository locations');

    fixPathsCmd.action(async () => {
      const allOpts = fixPathsCmd.optsWithGlobals<FixPathsCLIOpts>();
      const { run } = await import('./commands/fix-paths.js');
      await run(allOpts);
    });
    ```
  - [x] 1.2 Add `FixPathsCLIOpts` to the type-import section in `cli.ts`:
    ```ts
    import type { FixPathsOpts as FixPathsCLIOpts } from './commands/fix-paths.js';
    ```
  - [x] 1.3 Remove the old `program.command('fix-paths')...` block (replaced by the above)

- [x] Task 2 — Define types and implement scan in `src/commands/fix-paths.ts` (AC: #1–#7)
  - [x] 2.1 Define `FixPathsOpts` interface:
    ```ts
    export interface FixPathsOpts {
      silent?: boolean;
      json?: boolean;
      dryRun?: boolean;
    }
    ```
  - [x] 2.2 Define `ProjectInventoryEntry` interface (exported — used by test and later by Stories 3.2/3.3):
    ```ts
    export interface ProjectInventoryEntry {
      slug: string;
      decodedPath: string;
      exists: boolean;
      source: 'sessionCwd' | 'slugDecode' | null;
    }
    ```
  - [x] 2.3 Implement `scanProjects(claudeDir: string): Promise<ProjectInventoryEntry[]>`:
    - Read `~/.claude/projects/` via `readdir` → ENOENT returns `[]`
    - Filter to directories only (use `withFileTypes: true` or stat each)
    - For each slug directory, call `resolveOriginalPath(slug, claudeDir)` (imported from `claude-reader.ts`)
    - `stat(entry.decodedPath)` → `exists = true`; ENOENT → `exists = false`; other errors propagate
    - Return array of `ProjectInventoryEntry`
  - [x] 2.4 Implement `run(opts: FixPathsOpts = {}): Promise<void>`:
    - `const out = new Output('fix-paths', { json: opts.json === true })`
    - `const { claudeDir } = locateClaude()`
    - Call `scanProjects(claudeDir)` — emit `out.progress('Scanning ~/.claude/projects/...')` before
    - Emit `out.progress(...)` per project found: `Scanned <slug>: <path> [FOUND|NOT FOUND]`
    - Count missing: `const missing = entries.filter(e => !e.exists)`
    - If `entries.length === 0` or `missing.length === 0`:
      - `out.progress('No projects need fixing.')`
      - In JSON mode: `out.finish('No projects need fixing.', true, { projects: entries })`
      - In human mode: `out.finish('No projects need fixing.')`
      - Return (exit 0)
    - Otherwise (there ARE missing projects — Stories 3.2/3.3 will extend here):
      - Emit summary: `N project(s) need path repair.`
      - In JSON mode: `out.finish('<summary>', true, { projects: entries })`
      - In human mode: `out.finish('<summary>')`
      - Return (exit 0 in Story 3.1; Stories 3.2/3.3 will insert the remap phase before this)
  - [x] 2.5 Ensure required imports: `readdir`, `stat` from `'node:fs/promises'`; `join` from `'node:path'`; `locateClaude` from `'../services/claude-locator.js'`; `resolveOriginalPath` from `'../services/claude-reader.js'`; `Output` from `'../ui/output.js'`

- [x] Task 3 — Unit tests `src/commands/fix-paths.test.ts` (AC: #9)
  - [x] 3.1 Create `src/commands/fix-paths.test.ts` using vi.mock for:
    - `'../services/claude-locator.js'` → returns a fixed `claudeDir` (tmpdir)
    - `'../services/claude-reader.js'` → mock `resolveOriginalPath`
    - `'node:fs/promises'` → mock `readdir` and `stat`
  - [x] 3.2 Test case (a): empty projects dir (`readdir` returns `[]`) → `run()` completes normally; `out.finish` called with `'No projects need fixing.'`
  - [x] 3.3 Test case (b): missing projects dir (`readdir` throws ENOENT) → treated as empty → same as (a)
  - [x] 3.4 Test case (c): one project FOUND via sessionCwd — `resolveOriginalPath` resolves `{ path: '/home/jordan/proj-a', source: 'sessionCwd' }`, `stat(path)` succeeds → inventory entry has `exists: true, source: 'sessionCwd'`; early exit (all found)
  - [x] 3.5 Test case (d): one project NOT FOUND via sessionCwd — `stat` throws ENOENT → `exists: false, source: 'sessionCwd'`; command returns exit 0 (remap phase deferred)
  - [x] 3.6 Test case (e): memory-only project — `resolveOriginalPath` returns `{ path: '/home/jordan/my-app', source: 'slugDecode' }` → `source: 'slugDecode'`
  - [x] 3.7 Test case (f): structurally invalid slug — `resolveOriginalPath` returns `{ path: 'bad-slug', source: null }` → `source: null`, `decodedPath: 'bad-slug'`
  - [x] 3.8 Test case (g): mixed tree (2 FOUND, 1 NOT FOUND) → inventory has all 3; command returns normally (exit 0 in Story 3.1)
  - [x] 3.9 Test case (h): `--json` mode — verify `out.finish` receives an `extra` object containing a `projects` array

- [x] Task 4 — Validate and finalize (AC: #10)
  - [x] 4.1 Run `npm run check` and confirm clean exit

## Dev Notes

### File inventory

| File | Change type | Notes |
|------|-------------|-------|
| `src/cli.ts` | UPDATE | Store fix-paths cmd in variable; pass `optsWithGlobals()` to `run()` |
| `src/commands/fix-paths.ts` | UPDATE | Replace placeholder with real scan implementation |
| `src/commands/fix-paths.test.ts` | NEW | Unit tests for scan phase |

### Key existing functions to reuse — DO NOT reinvent

| Function | Location | Usage |
|----------|----------|-------|
| `resolveOriginalPath(slug, claudeDir)` | `src/services/claude-reader.ts` | Already handles both sessionCwd and slugDecode paths; returns `{ path, source }` |
| `locateClaude()` | `src/services/claude-locator.ts` | Returns `{ claudeDir, claudeJson }` |
| `slugToPath(slug, platform)` | `src/core/path-engine.ts` | **Do not call directly** — `resolveOriginalPath` already calls it as fallback |
| `Output` | `src/ui/output.js` | Standard output module: `.progress()` → stderr, `.finish()` → stdout |

### `resolveOriginalPath` behavior (already implemented in Story 1.7)

```ts
// In claude-reader.ts:
export interface OriginalPathResult {
  path: string;
  source: 'sessionCwd' | 'slugDecode' | null;
}
export async function resolveOriginalPath(slug: string, claudeDir: string): Promise<OriginalPathResult>
```

The function:
1. Reads session JSONL files from `~/.claude/projects/<slug>/sessions/`
2. Finds the most-recently-modified JSONL, reads its first line with a `cwd` field → `source: 'sessionCwd'`
3. If no JSONL files: calls `slugToPath(slug, process.platform)` → `source: 'slugDecode'`
4. If `slugToPath` returns null: returns the raw slug with `source: null`

**Critical**: EBUSY/EPERM on JSONL files is already translated to `CmemmovError({ code: 'INTERNAL', hint: 'close Claude Code and retry' })` inside `resolveOriginalPath`. Do not try/catch that — let it propagate.

### `Output` usage pattern

```ts
const out = new Output('fix-paths', { json: opts.json === true });

out.progress('Scanning ~/.claude/projects/...');  // → stderr, always
out.progress('  [FOUND]     /home/jordan/agents');
out.progress('  [NOT FOUND] /home/jordan/my-app');
out.warn('...');  // → stderr, also collected in warnings[]

// Human mode:
out.finish('No projects need fixing.');
// JSON mode (--json):
out.finish('No projects need fixing.', true, { projects: entries });
// ^^ stdout: { success: true, command: 'fix-paths', summary: { text: '...', projects: [...] }, errors: [], warnings: [] }
```

### CLI `optsWithGlobals()` pattern — follow existing commands

```ts
// ✅ Correct pattern (follow export/import/rollback):
const fixPathsCmd = program
  .command('fix-paths')
  .description('...');

fixPathsCmd.action(async () => {
  const allOpts = fixPathsCmd.optsWithGlobals<FixPathsOpts>();
  const { run } = await import('./commands/fix-paths.js');
  await run(allOpts);
});
```

Global opts inherited via `optsWithGlobals()`: `silent`, `json`, `dryRun` (camelCase via Commander). These are already globally defined on the parent program in `cli.ts`.

### `FIXPATHS_NO_PROJECTS` error code — do NOT use in Story 3.1

This code is already defined in `error.ts` with `exitCode: 1`. Do NOT throw it in the scan phase. The scan phase exits 0 when no projects need fixing. `FIXPATHS_NO_PROJECTS` is reserved for Story 3.2's silent mode when there are unresolvable missing projects.

### Testing pattern — follow existing command tests

Look at `src/commands/rollback.test.ts` for the vi.mock + fs-mocking pattern used by command-level tests. The fix-paths tests mock:
- `node:fs/promises` for `readdir` + `stat`  
- `../services/claude-locator.js` for `locateClaude`
- `../services/claude-reader.js` for `resolveOriginalPath`

Use `vi.spyOn(process.stdout, 'write')` and `vi.spyOn(process.stderr, 'write')` to assert output (or spy on `Output.prototype.finish`).

### ESLint rules to keep in mind (from Story 3.0)

- `no-process-env-home`: use `os.homedir()` via `locateClaude()`, never `process.env.HOME` directly
- `no-hardcoded-separator`: use `join()` from `node:path`, never `'/'` or `'\\'` string literals for path building
- `no-raw-fs-access` in `src/*.ts` (non-test): all fs reads go through `readdir`/`stat` from `node:fs/promises` — but these ARE allowed in the command module (only `claude-reader.ts` and `claude-writer.ts` have the internal-service pattern)
- `no-raw-json-parse`: not relevant for this story (no JSON parsing)
- `no-console-outside-output`: use `out.progress()` / `out.finish()` — never `console.log()`

### Story 3.0 key changes that affect Story 3.1

- `readSettingsForMerge` is the new merge helper in `claude-reader.ts` — not relevant to Story 3.1 (scan-only, no writes)
- `deepMerge` now uses string-vs-object array strategy — not relevant (no merges in Story 3.1)
- vitest bumped to `^2.1.8` — tests should now pass under Node v22.20.0

### Future extension points (Stories 3.2 and 3.3)

Story 3.1 creates the scan phase and exports `ProjectInventoryEntry`. Stories 3.2 and 3.3 will:
- Import `ProjectInventoryEntry` and `scanProjects` (if exported — recommend exporting for testability)
- In `run()`, after the scan, add the remap phase (Story 3.2) and apply phase (Story 3.3) for `missing.length > 0` cases
- The `--remap` CLI flag will be added to `fixPathsCmd` in Story 3.2
- The backup step (Story 3.3) happens BEFORE any rename

Design the `run()` function so that the remap/apply extension in Stories 3.2/3.3 is a natural addition to the existing `if (missing.length > 0)` branch.

## Dev Agent Record

### Implementation Plan

1. Updated `src/cli.ts` to store `fix-paths` Command in a variable so `optsWithGlobals<FixPathsCLIOpts>()` can be invoked inside the action callback, then forward the resolved opts to `run(opts)`. Added a type-only import for `FixPathsOpts as FixPathsCLIOpts` from `./commands/fix-paths.js`.
2. Replaced the placeholder body of `src/commands/fix-paths.ts` with: exported `FixPathsOpts`, exported `ProjectInventoryEntry`, exported `scanProjects(claudeDir)` (treats ENOENT on `~/.claude/projects/` as empty, filters to directories via `readdir(..., { withFileTypes: true })`, delegates path resolution to `resolveOriginalPath`, and probes existence with `stat` translating ENOENT → `exists: false`), and `run(opts)` (constructs `Output('fix-paths', { json })`, emits per-project progress lines, early-exits with "No projects need fixing." when the tree is empty or fully resolved, and otherwise emits a "N project(s) need path repair." summary — all writes go through `out.progress` / `out.finish`).
3. Created `src/commands/fix-paths.test.ts` covering all eight AC9 cases (empty dir, missing dir, sessionCwd FOUND, sessionCwd NOT FOUND, slugDecode fallback, structurally-invalid slug, mixed tree, `--json` mode) plus an extra `--dry-run` parity case for AC7 and a `--json` summary-with-missing case for AC6.

### Completion Notes

- All ten ACs satisfied. `npm run check` passes (lint clean, typecheck clean, 439 tests passing — no regressions; 2 pre-existing skipped).
- Only used `out.progress` / `out.finish` — no raw `console.*`, no string-literal path separators, no direct `os.homedir()` calls (per the project's ESLint architectural rules).
- Side-effect of removing the fix-paths placeholder: `src/cli.test.ts` AC6 and AC7 lists were narrowed to `['share', 'completion']` (mirroring the same pattern used when stories 1.10/1.11/1.12 graduated `export`/`import`/`rollback` out of placeholder status), and AC8's static-import regex was tightened to ignore `import type ...` so the new type-only `FixPathsOpts` import does not register as a runtime command-module import.
- `FIXPATHS_NO_PROJECTS` (exit 1) is intentionally NOT thrown in this story — reserved for Story 3.2's `--silent` non-interactive path.
- `--dry-run` is accepted and threaded into `FixPathsOpts` but not yet acted upon, since Story 3.1 is read-only; it will gate the apply phase in Story 3.3.

### File List

- MODIFIED: `src/cli.ts` — store `fix-paths` Command in a variable and pass `optsWithGlobals()` to `run`; added type-only import of `FixPathsOpts`.
- MODIFIED: `src/commands/fix-paths.ts` — replaced placeholder with the scan-phase implementation (`FixPathsOpts`, `ProjectInventoryEntry`, `scanProjects`, `run`).
- NEW: `src/commands/fix-paths.test.ts` — 11 unit tests covering AC1–AC7 and all AC9 cases.
- MODIFIED: `src/cli.test.ts` — moved `fix-paths` out of the AC6/AC7 placeholder lists; tightened AC8 static-import regex to allow `import type` of command modules.

### Change Log

- 2026-05-09: Story 3.1 implemented — fix-paths now performs a read-only project inventory scan that decodes slugs (preferring session `cwd` over slug-reverse) and reports FOUND vs NOT FOUND for each project, with early-exit when nothing needs fixing. CLI wired to forward global opts. Exports `ProjectInventoryEntry` and `scanProjects` for Stories 3.2 / 3.3 to extend.

### Review Findings

Code review performed 2026-05-09 by adversarial multi-layer pass (Blind Hunter / Edge Case Hunter / Acceptance Auditor). Severity-tagged findings below; HIGH/MEDIUM auto-resolved per team-lead directive, LOW/INFO deferred to `deferred-work.md`.

- [x] [Review][Patch] **MEDIUM — Duplicate "No projects need fixing." emission in human mode** [src/commands/fix-paths.ts:73] — `out.progress('No projects need fixing.')` writes to stderr followed immediately by `out.finish('No projects need fixing.')` writing the same string to stdout, so users see the message twice in interleaved terminal output. The missing-projects branch correctly emits the summary only via `out.finish`; this branch is asymmetric. Fix: drop the redundant `out.progress` call in the success branch. AC5 still satisfied (the spec only mandates that `out.finish` be called with the success summary).
- [x] [Review][Patch] **LOW — `readdir` test mock ignores `withFileTypes` opt** [src/commands/fix-paths.test.ts:39] — Diverges from the established `rollback.test.ts` pattern (which dispatches between dirent-form and string-form based on the opts flag). Future code calling `readdir(...)` without the flag would silently receive Dirent objects. Fix: branch on `opts?.withFileTypes` and reject the unsupported call form.
- [x] [Review][Dismiss] LOW — `String(missing.length)` in template literal (src/commands/fix-paths.ts:82) — Initially flagged as a redundant coercion, but the project's `@typescript-eslint/restrict-template-expressions` lint rule rejects bare `number` in template literals. The cast is required by lint, not noise. Dismissed.
- [x] [Review][Defer] **MEDIUM — `stat` non-ENOENT errors propagate raw, not wrapped as `CmemmovError`** [src/commands/fix-paths.ts:38] — deferred, matches spec AC4 wording verbatim ("other errors propagate"); see `deferred-work.md`.
- [x] [Review][Defer] **LOW — `readdir` ENOENT-only handling on projects dir** [src/commands/fix-paths.ts:24] — deferred, EACCES/EPERM on `~/.claude/projects/` will surface as raw NodeJS errors; see `deferred-work.md`.
- [x] [Review][Defer] **LOW — `stat` ENOENT-only handling for `decodedPath`** [src/commands/fix-paths.ts:38] — deferred, see above; sister-issue to the previous defer.
- [x] [Review][Defer] **LOW — Sequential `await resolveOriginalPath` in for-loop** [src/commands/fix-paths.ts:32] — deferred, no concurrency cap; acceptable for typical project counts. See `deferred-work.md`.
- [x] [Review][Defer] **LOW — Unused `silent` and `dryRun` fields in `FixPathsOpts`** [src/commands/fix-paths.ts:7] — deferred, intentionally reserved for Stories 3.2/3.3 per spec AC7 / Dev Notes. See `deferred-work.md`.
- [x] [Review][Defer] **LOW — `cli.test.ts` static-import regex blind to mixed-import `type` form** [src/cli.test.ts:309] — deferred, no current trigger; future hardening for `import { type Foo } from '...'`. See `deferred-work.md`.
- [x] [Review][Defer] **LOW — Test mock fallback for unregistered slugs is silently permissive** [src/commands/fix-paths.test.ts:74] — deferred, test-clarity issue; not a bug. See `deferred-work.md`.

5 findings dismissed as noise (single-use type alias by spec convention, theoretical Windows junction case, Dev Notes example progress format being illustrative-not-contractual, redundant duplicates of dismissed items, false positive on JSON-mode progress emission).

Acceptance Auditor: all 10 ACs satisfied. The MEDIUM "duplicate emission" patch above strengthens AC5's UX intent without changing its formal contract.
