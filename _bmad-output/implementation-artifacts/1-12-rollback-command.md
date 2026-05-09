# Story 1.12: Rollback Command

Status: done

## Story

As a Claude Code user,
I want to run `cmemmov rollback` and have it restore the most recent pre-import backup in one command,
So that I have a low-friction recovery path if an import goes wrong (FR19, NFR11) — knowing the backup was created automatically before the import started.

## Acceptance Criteria

1. **Given** at least one pre-import backup exists under `~/.claude/backups/cmemmov/`
   **When** I run `cmemmov rollback`
   **Then** the most recent backup is restored over `~/.claude/` and `~/.claude.json` via WriteGate (atomic where possible)

2. **Given** no backup directory exists at `~/.claude/backups/cmemmov/`
   **When** I run `cmemmov rollback`
   **Then** it throws `CmemmovError({ code: 'ROLLBACK_NOT_AVAILABLE', exitCode: 2, hint: 'no backups found under ~/.claude/backups/cmemmov/' })`

3. **Given** rollback succeeds
   **When** complete
   **Then** the stderr/JSON summary names the backup that was restored (timestamp + directory path); exit code is 0

4. **Given** `cmemmov rollback --json`
   **When** the command runs
   **Then** progress goes to stderr; the final JSON object on stdout includes the restored backup path

5. **Given** the most-recent backup directory is partially corrupted (truncated file, missing required path)
   **When** rollback runs
   **Then** a clean error explains the corruption; rollback does NOT silently fall back to the next-most-recent backup (user must re-run with `--backup <path>` to choose explicitly)

6. **Given** `cmemmov rollback --dry-run`
   **When** invoked
   **Then** the WriteGate records the restoration ops without writing; summary shows what would be restored; filesystem is byte-for-byte unchanged (NFR12)

---

## Dev Notes

### Architecture Layer

```
src/commands/rollback.ts        ← command orchestrator (REPLACE placeholder)
src/commands/rollback.test.ts   ← NEW integration tests
src/cli.ts                      ← UPDATE: add --backup option to rollback command
src/cli.test.ts                 ← UPDATE: remove 'rollback' from placeholder lists
```

Layer compliance: `commands/ → services/ → core/`. Rollback orchestrates `backup-service` (for `BACKUP_ROOT` constant), `write-gate`, `claude-locator`. No try/catch in `rollback.ts` — exceptions propagate to `cli.ts`.

### Files Created / Updated

| Action | Path |
|--------|------|
| UPDATE | `src/commands/rollback.ts` (replace placeholder) |
| CREATE | `src/commands/rollback.test.ts` |
| UPDATE | `src/cli.ts` (add `--backup <path>` option to rollback subcommand) |
| UPDATE | `src/cli.test.ts` (remove `'rollback'` from AC6/AC7 placeholder lists) |

### Backup Directory Structure (from `backup-service.ts`)

The backup layout created by Story 1.5:

```
~/.claude/backups/cmemmov/
  <timestamp>-<pid>-<hex>/      ← one directory per backup
    ...all ~/.claude/ contents except backups/...
    .claude.json                 ← adjacent ~/.claude.json copied here
```

Key facts:
- Backup names are `<ISO-8601 with colons/dots replaced by dashes>-<pid>-<hex>` e.g. `2026-05-09T17-21-33-289Z-12345-a1b2c3d4`
- ISO timestamps sort lexicographically, so `sort()` + `last()` = most recent
- Each backup dir contains the `~/.claude/` content (minus the `backups/` subdirectory itself) PLUS a `.claude.json` file at the top level of the backup directory
- `BACKUP_ROOT` = `join(claudeDir, 'backups', 'cmemmov')` — derive this inline in rollback.ts (do NOT import from backup-service.ts; that module has no exported constants)

### `cli.ts` — Rollback Subcommand Options

Replace the bare rollback `.action()` with an options-aware version:

```typescript
const rollbackCmd = program
  .command('rollback')
  .description('Restore the most recent pre-import backup')
  .option('--backup <path>', 'restore a specific backup directory instead of the most recent');

rollbackCmd.action(async () => {
  const allOpts = rollbackCmd.optsWithGlobals<RollbackCLIOpts>();
  const { run } = await import('./commands/rollback.js');
  await run(allOpts);
});
```

Add type to `cli.ts` (local, not exported):

```typescript
interface RollbackCLIOpts extends GlobalCLIOpts {
  backup?: string;   // path to a specific backup directory
}
```

**`GlobalCLIOpts` is already defined in `cli.ts` from Story 1.10.** Do NOT re-define it.

**Remove `'rollback'` from placeholder lists in `cli.test.ts`** AC6 and AC7, exactly as was done for `'export'` (Story 1.10) and `'import'` (Story 1.11).

**Also update the AC8 dispatch test** — the `cmemmov rollback` dispatch test currently does `await runCli(['rollback'])` and expects the placeholder INTERNAL error. After this story, `run()` will be real — update the test to pass mocked dependencies that produce a successful rollback or expected error.

### `RollbackDecision` — Already Defined

`decision-schema.ts` already has:

```typescript
export interface RollbackDecision {
  backupPath: string | undefined;   // undefined = auto-select most recent
  dryRun: boolean;
  silent: boolean;
  json: boolean;
}
```

`FLAG_NAMES.backupPath = '--backup'` is also already defined. Do NOT add fields to `RollbackDecision` — use it as-is.

### `rollback.ts` — Full `run()` Implementation

**Exported interface and signature**:

```typescript
export interface RollbackOpts {
  backup?: string;
  dryRun?: boolean;
  silent?: boolean;
  json?: boolean;
}

export async function run(opts: RollbackOpts): Promise<void>
```

**Full `run()` flow** (no try/catch — all errors propagate to cli.ts):

```
1. Construct Output('rollback', { json: opts.json === true })
2. Locate Claude (locateClaude())
3. Derive BACKUP_ROOT = join(loc.claudeDir, 'backups', 'cmemmov')
4. Determine backupDir:
   a. If opts.backup !== undefined → backupDir = opts.backup (explicit selection)
   b. Else → find most recent:
      - readdir(BACKUP_ROOT) to get entries; ENOENT → throw ROLLBACK_NOT_AVAILABLE
      - If entries.length === 0 → throw ROLLBACK_NOT_AVAILABLE
      - Sort entries lexicographically; backupDir = join(BACKUP_ROOT, entries.sort().at(-1))
5. Validate backup dir:
   - stat(backupDir) → must be a directory; ENOENT → throw ROLLBACK_NOT_AVAILABLE with specific hint
   - List top-level contents; if empty → throw CmemmovError({ code: 'ROLLBACK_NOT_AVAILABLE', hint: `Backup at ${backupDir} appears empty or corrupted` })
6. Announce: out.progress(`Restoring backup: ${backupDir}`)
7. Determine gate:
   IF opts.dryRun → gate = makeDryRunWriteGate()
   ELSE → gate = makeLiveWriteGate((msg) => out.warn(msg))
8. Restore operation (core logic):
   a. List direct children of loc.claudeDir
   b. For each child that is NOT 'backups':
      - gate.remove(join(loc.claudeDir, child))
   c. Walk backupDir recursively:
      - For each DIRECTORY encountered (except root): gate.mkdir(corresponding path in claudeDir, { recursive: true })
      - For each FILE encountered:
        * If filename is '.claude.json' AND it is directly inside backupDir (not nested):
          → gate.write(loc.claudeJson, content)  (restore adjacent .claude.json)
        * Else:
          → gate.write(join(loc.claudeDir, relPath), content)
9. Emit progress: out.progress(`Restored ${opCount} file(s) from ${backupDir}`)
10. out.finish(`Rollback complete. Restored from: ${backupDir}`, true)
```

### Recursive Walk Helper

Implement a private async generator or recursive function to walk the backup directory. Example:

```typescript
interface WalkEntry {
  absPath: string;
  relPath: string;    // relative to backupDir root
  isDir: boolean;
}

async function* walkDir(root: string, prefix = ''): AsyncGenerator<WalkEntry> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    const abs = join(root, e.name);
    const rel = prefix.length > 0 ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      yield { absPath: abs, relPath: rel, isDir: true };
      yield* walkDir(abs, rel);
    } else {
      yield { absPath: abs, relPath: rel, isDir: false };
    }
  }
}
```

### `.claude.json` Restore Rule

The backup stores `~/.claude.json` as `backupDir/.claude.json` (directly at the root of the backup dir, not nested in a subdirectory). During restore:

- **Detect it**: `relPath === '.claude.json'` (not nested — `!relPath.includes('/')`)
- **Restore to**: `loc.claudeJson` (which is `~/.claude.json`, the path from `locateClaude()`)
- All other files use `join(loc.claudeDir, relPath)` as the target

### ROLLBACK_NOT_AVAILABLE Hint Convention

The hint must name the backup root so the user knows where to look:

```typescript
// No backups dir at all:
throw new CmemmovError({
  code: 'ROLLBACK_NOT_AVAILABLE',
  hint: `no backups found under ${BACKUP_ROOT}`,
});

// Specific backup dir given but doesn't exist:
throw new CmemmovError({
  code: 'ROLLBACK_NOT_AVAILABLE',
  hint: `backup not found: ${backupDir}`,
});

// Backup dir exists but is empty/corrupted:
throw new CmemmovError({
  code: 'ROLLBACK_NOT_AVAILABLE',
  hint: `Backup at ${backupDir} appears empty or corrupted. Use --backup <path> to choose a different backup.`,
});
```

### ESLint Compliance

- No `console.*` or `process.stdout/stderr.write` — use `out.progress()`, `out.warn()`, `out.finish()`
- No try/catch in `rollback.ts` — except low-level ENOENT translation helpers (same as import.ts)
- `readFile` from `node:fs/promises` is fine for reading backup files — not a WriteGate concern
- Do NOT use `os.homedir()` directly in rollback.ts — use `locateClaude()` to get `claudeDir`, then derive `home` as `dirname(claudeDir)` if needed (same workaround as import.ts; ESLint blocks direct homedir() calls in command modules)
- `BACKUP_ROOT` is derived inline — `join(loc.claudeDir, 'backups', 'cmemmov')` — do NOT import from backup-service.ts (it exports no constants)

### Test Strategy

**`rollback.test.ts`** — integration tests:

Mock setup:
```typescript
vi.mock('../services/claude-locator.js', () => ({
  locateClaude: vi.fn(() => ({ claudeDir: '/claude', claudeJson: '/claude.json' })),
}))
vi.mock('../services/write-gate.js', () => ({
  makeLiveWriteGate: vi.fn(() => fakeGate),
  makeDryRunWriteGate: vi.fn(() => fakeDryGate),
}))
vi.mock('node:fs/promises', async () => ({
  ...await vi.importActual('node:fs/promises'),
  readdir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}))
```

Key test cases:
1. **AC1** — backup exists → `gate.remove` called for non-backup children; `gate.write` called for backup files; `gate.write(claudeJson, ...)` called for `.claude.json`
2. **AC2** — no BACKUP_ROOT dir → ENOENT from readdir → ROLLBACK_NOT_AVAILABLE thrown
3. **AC2** — BACKUP_ROOT exists but empty → ROLLBACK_NOT_AVAILABLE thrown
4. **AC3/AC4** — success → `out.finish` summary contains `backupDir` path
5. **AC5** — backup dir exists but `readdir(backupDir)` returns empty array → ROLLBACK_NOT_AVAILABLE (corrupted); no fallback to next backup
6. **AC6** — `--dry-run` → `makeDryRunWriteGate` used, `gate.write` called (dry), real filesystem untouched
7. **`--backup <path>`** explicit → uses that path rather than auto-detecting most recent
8. **Most-recent selection** — multiple backups → lexicographically last selected

**`prompts.test.ts` / `cli.test.ts`** — minor updates:
- `cli.test.ts`: remove `'rollback'` from AC6/AC7 placeholder lists
- `cli.test.ts` AC8 dispatch test for `rollback`: update to mock `run` returning success (not the placeholder INTERNAL error)

### Previous Story Learnings

From Stories 1.10, 1.11:
- **No try/catch in command modules** — only low-level ENOENT translators (matching backup-service.ts and import.ts pattern)
- **Commander `optsWithGlobals<T>()`** — captures both local and global options; `--dry-run` is global
- **`GlobalCLIOpts` already in `cli.ts`** — extend it, don't re-declare
- **Remove command from cli.test.ts placeholder lists** — exactly as was done for export and import
- **`vi.hoisted` for mutable test state** — declare state before `vi.mock` factory calls
- **Mock `node:fs/promises` carefully** — use `vi.importActual` + spread `...actual` so other FS functions remain functional
- **`out.finish()` vs throwing** — on success call `out.finish(summary, true)` and return; on partial/error throw `CmemmovError` (cli.ts handles all error output)
- **`RollbackDecision` exists** — use it; don't create new decision types

### Key Invariants to Preserve

1. **No try/catch in `rollback.ts` orchestration body** — cli.test.ts AC6 verifies this (now that rollback is real, the source-level try-block count for the non-placeholder commands must remain 0 in orchestration code)
2. **No silent fallback on corruption** — AC5: if most-recent backup is corrupted, throw immediately; never try the next backup
3. **Preserve `~/.claude/backups/` during restore** — do NOT remove the `backups/` child when clearing claudeDir; only remove non-backup children
4. **WriteGate for ALL writes** — never write to `~/.claude/` using raw `fsWriteFile`; use the gate
5. **Dry-run must touch ZERO files** — use `makeDryRunWriteGate()`, skip no backup creation since rollback never creates a backup
6. **`ROLLBACK_NOT_AVAILABLE` exits 2** — `EXIT_CODE_MAP` already maps it; no change needed

---

## Tasks/Subtasks

- [x] Replace `src/commands/rollback.ts` placeholder with full `run(opts)` implementation per Dev Notes
  - [x] Construct `Output('rollback', { json })`
  - [x] Locate Claude (`locateClaude()`) and derive `BACKUP_ROOT = join(claudeDir, 'backups', 'cmemmov')`
  - [x] Determine `backupDir`: explicit `--backup` path, else most-recent (lexicographic last) entry of `BACKUP_ROOT`
  - [x] Throw `ROLLBACK_NOT_AVAILABLE` (exit 2) for missing/empty backup root, missing explicit path, and empty/corrupted selected backup
  - [x] Pick gate: `makeDryRunWriteGate()` when `--dry-run`, else `makeLiveWriteGate(out.warn)`
  - [x] Clear non-`backups` children of `claudeDir` via `gate.remove`
  - [x] Walk backup directory recursively; mkdir directories, write files, restoring `.claude.json` to `loc.claudeJson` (adjacent), all others under `claudeDir`
  - [x] Emit progress + final summary naming the restored backup; success exits 0
  - [x] No `try/catch` in orchestration body — only ENOENT translators (matching `import.ts` pattern)
- [x] Update `src/cli.ts` rollback subcommand to use `optsWithGlobals<RollbackCLIOpts>()` and add `--backup <path>` option
  - [x] Add local (non-exported) `RollbackCLIOpts extends GlobalCLIOpts` interface
- [x] Create `src/commands/rollback.test.ts` integration tests covering AC1–AC6, explicit `--backup`, lexicographic selection, and `backups/` preservation
- [x] Update `src/cli.test.ts`
  - [x] Remove `'rollback'` from AC6 placeholder list
  - [x] Remove `'rollback'` from AC7 `it.each` placeholder list
  - [x] Update AC8 dispatch test for `cmemmov rollback` to mock a successful run instead of expecting the INTERNAL placeholder

## Dev Agent Record

### Completion Notes

Implemented `cmemmov rollback` end-to-end, replacing the Story 1.9 placeholder.
Behavior:

- `cmemmov rollback` selects the lexicographically last (most recent) entry in `~/.claude/backups/cmemmov/`, then for the selected backup directory:
  1. removes every direct child of `~/.claude/` except `backups/` (which is preserved unconditionally so we never delete sibling backups),
  2. recursively walks the backup directory and writes every file through `WriteGate` — files restore under `claudeDir`; the special top-level `.claude.json` restores to the adjacent `~/.claude.json` returned by `locateClaude()`,
  3. emits a final summary line that names the backup directory.
- `cmemmov rollback --backup <path>` skips the most-recent scan and validates the explicit path with `stat`. Missing → `ROLLBACK_NOT_AVAILABLE`.
- No backups under `~/.claude/backups/cmemmov/` (ENOENT or zero entries), or selected backup is empty (zero entries), → `ROLLBACK_NOT_AVAILABLE` with a hint that names the missing/corrupt path. AC5: there is no silent fallback to the next-most-recent backup; the user must re-run with `--backup <path>` to choose explicitly.
- `--dry-run` swaps in `makeDryRunWriteGate()`; the gate records `mkdir`/`write`/`remove` ops without touching disk. The summary reports the would-be backup directory and the recorded op count.
- `--json` keeps the human progress on stderr and emits the final OutputResult JSON (with the restored `backupPath` in `summary`) on stdout via `out.finish(...)`.
- No `try/catch` in the rollback orchestration body. The only `try/catch` blocks are the two low-level `readdir`/`stat` ENOENT translators — same pattern import.ts uses for its own ENOENT translators. AC6 (`cli.test.ts`) still passes because `rollback.ts` is no longer in the placeholder list it scans.

Path-portability decisions:

- `walkDir` uses `path.join(prefix, name)` for `relPath` so the separator matches the platform; the "is `.claude.json` adjacent?" check uses `!relPath.includes(path.sep)` rather than a hardcoded `/` (also satisfies the `cmemmov/no-hardcoded-separator` lint rule).
- Tests build all expected paths with `path.join` so fixture keys match what production code produces on Windows (backslash) as well as POSIX (forward slash).

`BACKUP_ROOT` is derived inline (`join(claudeDir, 'backups', 'cmemmov')`) per Dev Notes — `backup-service.ts` exports no constant.

✅ Validated: 25 test files / 323 tests pass (`npm run check` = lint + typecheck + tests). 11 new rollback tests cover AC1, AC2 (both ENOENT and zero-entries cases), AC3/AC4 human + JSON summaries, AC5 corrupted-backup-no-fallback, AC6 dry-run isolation, explicit `--backup` (success and missing path), lexicographic most-recent selection, and `~/.claude/backups/` preservation.

### File List

| Action | Path |
|--------|------|
| UPDATE | `src/commands/rollback.ts` |
| CREATE | `src/commands/rollback.test.ts` |
| UPDATE | `src/cli.ts` |
| UPDATE | `src/cli.test.ts` |
| UPDATE | `_bmad-output/implementation-artifacts/sprint-status.yaml` (status: ready-for-dev → in-progress → review) |

### Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-05-09 | Story created | bmad-create-story |
| 2026-05-09 | Implemented rollback command (run + tests + cli wiring); story → review | dev-1-12 |
| 2026-05-09 | Code review: HIGH/MEDIUM auto-resolved (pre-validation pass; .claude.json removal when absent in backup); 3 new tests; 14/14 rollback tests pass, 326/326 total | review-1-12 |

### Review Findings

- [x] [Review][Patch] **AC1 safety: pre-destructive removal — restore aborts with no recovery on mid-walk failure** [src/commands/rollback.ts:143-169 (original)] — RESOLVED. Refactored to do a pre-validation walk via `access()` on every backup file BEFORE clearing any of `~/.claude/`. Permission errors and missing files now surface as `ROLLBACK_NOT_AVAILABLE` while the user's existing state is intact. New regression test "AC1 safety: validates backup readability before any destruction" verifies neither `makeLiveWriteGate` nor `makeDryRunWriteGate` is constructed when an unreadable file is present.
- [x] [Review][Patch] **AC1: backup without `.claude.json` left a stale `~/.claude.json` after rollback** [src/commands/rollback.ts removal loop (original)] — RESOLVED. Removal loop only iterated `~/.claude/` children and ignored the adjacent `~/.claude.json`. Added a follow-up step that calls `gate.remove(loc.claudeJson)` when the backup did not contain `.claude.json` AND the existing file is on disk. Two new regression tests verify both branches (existing file removed; missing file not touched).
- [x] [Review][Patch] **Redundant `!relPath.includes(sep)` guard after exact-string equality** [src/commands/rollback.ts:160-165 (original)] — RESOLVED. Folded the redundancy out as part of the AC1 refactor; `entry.relPath === '.claude.json'` already excludes any nested form (a string equal to `.claude.json` cannot contain a separator). Dropped unused `sep` import.
- [x] [Review][Defer] AC5 only detects empty-directory corruption, not truncated files — deferred (architectural; requires backup-service.ts integrity manifests). Logged in deferred-work.md.
- [x] [Review][Defer] No backup integrity manifest produced by `backup-service.ts` — deferred (out of scope). Logged in deferred-work.md.
- [x] [Review][Defer] Dry-run still calls `readFile` on every backup file (mild perf cost on multi-GB backups) — deferred (low impact; intentional to keep gate.write byte counts honest). Logged in deferred-work.md.
- [x] [Review][Defer] Race window between `readdir(BACKUP_ROOT)` and `readdir(backupDir)` — deferred (very unlikely; misleading hint only). Logged in deferred-work.md.
- [x] [Review][Defer] No CLI dispatch test verifying `--backup <path>` flag is forwarded through `optsWithGlobals` — deferred (LOW; unit test already covers `run({ backup })`). Logged in deferred-work.md.
- [x] [Review][Defer] Coupled assumption between rollback.ts `.claude.json`-at-backup-root logic and backup-service.ts layout — deferred (LOW; no contract test asserts the format). Logged in deferred-work.md.
- [x] [Review][Defer] Test fixture in `recordedOpsResult` uses `${CLAUDE_DIR}/settings.json` template-literal `/` instead of `path.join` — deferred (LOW; cosmetic, test does not assert on path values). Logged in deferred-work.md.
