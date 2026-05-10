# Story 3.3: Apply Renames & Update `.claude.json` + Backup

Status: review

## Story

As a Claude Code user (Jordan),
I want `cmemmov fix-paths` to back up `~/.claude/` first, then rename the project directories under `~/.claude/projects/` and update the corresponding entries in `~/.claude.json` so both stay coherent — and to abort safely if something would clobber existing state,
So that fix-paths is trustworthy: my Claude Code state is never left half-renamed, and I always have a rollback point.

## Acceptance Criteria

**AC1 — Auto-backup before any write**

**Given** confirmed remap decisions from Story 3.2 (at least one `action: 'remap'` decision)
**When** the apply phase begins
**Then** BEFORE any rename or write, an auto-backup of `~/.claude/` (and adjacent `~/.claude.json`) is created via the `backup-service.createBackup(claudeDir)` function; the backup path is reported to stderr

**AC2 — Apply remap decision**

**Given** a remap decision with `action: 'remap'` and a non-null `targetPath`
**When** applied
**Then** (a) the new slug is computed via `path-engine.pathToSlug(targetPath)`, (b) `~/.claude/projects/<oldSlug>` is renamed to `~/.claude/projects/<newSlug>` via `gate.rename()`, (c) the matching path fields in `~/.claude.json` are updated via `applyCategory({ category: 'claudeJson', mode: 'overwrite', remapDecisions: [...] })`

**AC3 — Collision detection before any rename**

**Given** a remap decision whose target slug already exists at `~/.claude/projects/<newSlug>` (collision)
**When** detected
**Then** all collisions are checked upfront (after backup, before any rename); the apply phase throws `CmemmovError({ code: 'INTERNAL', hint: 'target slug <newSlug> already exists; remove or merge manually before re-running, or run cmemmov rollback' })`; nothing is renamed; the backup remains intact

**AC4 — Orphaned slug (project dir exists but no `.claude.json` entry)**

**Given** a project being renamed has no corresponding path entry in `~/.claude.json`
**When** applied
**Then** the project directory is renamed; `remapClaudeJsonPaths`'s `warn` callback fires for the unmatched project path; `summary.warnings` records it; the command exits 0

**AC5 — Missing `.claude.json`**

**Given** `~/.claude.json` does not exist
**When** the apply phase runs
**Then** project directories are renamed; a warning is emitted ("`.claude.json` not found — directory renames completed but global state not updated"); the apply succeeds (exit 0)

**AC6 — Dry-run mode**

**Given** `--dry-run` flag
**When** the apply phase runs
**Then** no filesystem writes occur; `gate.recordedOps()` is used to enumerate and emit each operation that WOULD happen (renames + writes); the dry-run gate's backup step is also skipped (no actual backup needed); exit 0

**AC7 — Error recovery**

**Given** the apply phase fails with an unexpected error mid-rename
**When** caught
**Then** the backup created in AC1 remains intact; a `CmemmovError` is thrown so the user can run `cmemmov rollback`

**AC8 — Final summary**

**Given** the apply phase completes
**When** done
**Then** `out.finish()` reports the backup path (or "[dry-run]"), count of renames, count of skips (skip + no-op decisions), count of warnings; exit code is 0 for clean completion

**AC9 — Unit tests**

**Given** `src/commands/fix-paths.test.ts` (extended)
**When** the test suite runs
**Then** it covers at minimum:
- (a) single remap decision → backup created, directory renamed via gate.rename, applyCategory called
- (b) collision detected → CmemmovError INTERNAL thrown, gate.rename NOT called
- (c) missing `.claude.json` → directory renamed, warning emitted, no throw
- (d) orphaned slug (no .claude.json entry matches) → warning from applyCategory's warn callback
- (e) `--dry-run` → gate.recordedOps() emitted, no actual writes, backup skipped
- (f) all skip/no-op decisions → applyDecisions returns immediately (no backup, no rename)
- (g) `--json` mode → `out.finish` called with `{ projects, remappings, backupPath, warnings }`

## Dev Notes

### Overview

Story 3.3 adds `applyDecisions()` to `fix-paths.ts` and wires it into `run()` after the existing `collectRemapDecisions` call. Story 3.2 left a comment at the bottom of `run()`:
```typescript
// Story 3.3 will add the apply phase here (rename dirs + update .claude.json)
```
Replace that comment with the `applyDecisions` call.

### Files to Modify

| File | Change |
|------|--------|
| `src/commands/fix-paths.ts` | Add `applyDecisions`, update `run()` to call it |
| `src/commands/fix-paths.test.ts` | Add new describe blocks for apply phase |

**Do NOT touch:** `src/core/path-engine.ts`, `src/core/error.ts`, `src/services/backup-service.ts`, `src/services/write-gate.ts`, `src/services/claude-writer.ts` — all already have exactly what Story 3.3 needs.

---

### WriteGate — API Review (read before coding)

`src/services/write-gate.ts` exports two factory functions:

```typescript
makeLiveWriteGate(warn?: (msg: string) => void): WriteGate
makeDryRunWriteGate(): WriteGate
```

`WriteGate` interface:
```typescript
interface WriteGate {
  write(path: string, content: Buffer | string): Promise<void>;
  rename(from: string, to: string): Promise<void>;   // handles cross-volume EXDEV fallback
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  remove(path: string): Promise<void>;
  recordedOps(): readonly WriteOp[];  // used for dry-run summary
}
```

`WriteOp` union includes `{ kind: 'rename'; from: string; to: string }` and `{ kind: 'write'; path: string; bytes: number }` — use these to render the dry-run summary.

`makeLiveWriteGate` accepts a `warn` callback that fires on cross-volume rename fallback (not the same as path-remap warnings). Pass `(msg) => out.warn(msg)`.

---

### `src/commands/fix-paths.ts` Changes

#### New imports to add

```typescript
import { rename as fsRename } from 'node:fs/promises';   // ONLY if not using gate.rename
import { pathToSlug } from '../core/path-engine.js';
import { createBackup } from '../services/backup-service.js';
import { makeLiveWriteGate, makeDryRunWriteGate } from '../services/write-gate.js';
import { applyCategory } from '../services/claude-writer.js';
import { readClaudeJsonFile } from '../services/claude-reader.js';
```

**Use `gate.rename()` — do NOT import `fsRename` directly.** `gate.rename()` includes the cross-volume EXDEV fallback and is already dry-run-aware via `makeDryRunWriteGate`. Keeping all writes behind the gate simplifies dry-run logic and test verification.

#### Implement `applyDecisions`

Export this so tests can call it directly.

```typescript
export async function applyDecisions(
  decisions: RemapDecision[],
  claudeDir: string,
  opts: FixPathsOpts,
  out: Output,
): Promise<{ backupPath: string | null; warnings: string[] }> {
  const toRename = decisions.filter((d) => d.action === 'remap');

  if (toRename.length === 0) {
    return { backupPath: null, warnings: [] };
  }

  const gate =
    opts.dryRun === true
      ? makeDryRunWriteGate()
      : makeLiveWriteGate((msg) => out.warn(msg));

  // 1. Backup before any write (skip in dry-run — nothing will actually change)
  let backupPath: string | null = null;
  if (opts.dryRun !== true) {
    backupPath = await createBackup(claudeDir);
    out.progress(`Backup created: ${backupPath}`);
  }

  // 2. Pre-flight collision check — ALL slugs before ANY rename
  const projectsDir = join(claudeDir, 'projects');
  for (const d of toRename) {
    const newSlug = pathToSlug(d.targetPath!);
    const newSlugDir = join(projectsDir, newSlug);
    if (opts.dryRun !== true) {
      try {
        await stat(newSlugDir);
        // stat succeeded → target exists → collision
        throw new CmemmovError({
          code: 'INTERNAL',
          hint: `target slug ${newSlug} already exists; remove or merge manually before re-running, or run cmemmov rollback`,
        });
      } catch (err) {
        if (err instanceof CmemmovError) throw err;
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        // ENOENT → no collision, continue
      }
    }
  }

  // 3. Rename project directories
  for (const d of toRename) {
    const newSlug = pathToSlug(d.targetPath!);
    const oldSlugDir = join(projectsDir, d.slug);
    const newSlugDir = join(projectsDir, newSlug);
    await gate.rename(oldSlugDir, newSlugDir);
    out.progress(`Renamed: ${d.slug} → ${newSlug}`);
  }

  // 4. Update .claude.json
  const warnings: string[] = [];
  const claudeJsonPath = `${claudeDir}.json`;
  const existingClaudeJson = await readClaudeJsonFile(claudeJsonPath);

  if (existingClaudeJson === undefined) {
    const msg = '`~/.claude.json` not found — directory renames completed but global state not updated.';
    out.warn(msg);
    warnings.push(msg);
  } else {
    await applyCategory({
      category: 'claudeJson',
      mode: 'overwrite',
      targetDir: claudeDir,
      data: existingClaudeJson,
      gate,
      remapDecisions: toRename.map((d) => ({
        originalPath: d.originalPath,
        targetPath: d.targetPath,
      })),
      warn: (msg) => {
        warnings.push(msg);
        out.warn(msg);
      },
      info: (msg) => out.progress(msg),
    });
  }

  // 5. Dry-run: emit what WOULD have happened
  if (opts.dryRun === true) {
    out.progress('[dry-run] No changes applied. Operations that WOULD have occurred:');
    for (const op of gate.recordedOps()) {
      if (op.kind === 'rename') out.progress(`  rename: ${op.from} → ${op.to}`);
      else if (op.kind === 'write') out.progress(`  write: ${op.path} (${String(op.bytes)} bytes)`);
      else if (op.kind === 'mkdir') out.progress(`  mkdir: ${op.path}`);
    }
  }

  return { backupPath, warnings };
}
```

**Critical: `d.targetPath!`** — `targetPath` is guaranteed non-null when `action === 'remap'` (enforced by Story 3.2's `collectRemapDecisions`). The `!` non-null assertion is correct here. ESLint's `no-non-null-assertion` rule might flag it — if so, add a runtime guard:
```typescript
if (d.targetPath === null) continue; // should never happen for action === 'remap'
const newSlug = pathToSlug(d.targetPath);
```

**Note on `remapDecisions` type mismatch:** `applyCategory` expects `RemapDecisionLike` (which is `readonly { originalPath: string; targetPath: string | null }[]`). The `toRename.map(...)` produces that shape exactly. No casting needed.

#### Update `run()` — replace the Story 3.2 comment

Find the line:
```typescript
  // Story 3.3 will add the apply phase here (rename dirs + update .claude.json)
```

Replace it with:

```typescript
  const { backupPath, warnings } = await applyDecisions(decisions, claudeDir, opts, out);

  const remapCount = decisions.filter((d) => d.action === 'remap').length;
  const skipCount = decisions.filter((d) => d.action === 'skip' || d.action === 'no-op').length;
  const backupNote = opts.dryRun === true ? '[dry-run]' : (backupPath ?? 'none');
  const summary = `${String(remapCount)} project(s) renamed, ${String(skipCount)} skipped. Backup: ${backupNote}`;

  if (opts.json === true) {
    out.finish(summary, true, {
      projects: entries,
      remappings: decisions,
      backupPath,
      warnings,
    });
  } else {
    if (warnings.length > 0) {
      for (const w of warnings) out.warn(w);
    }
    out.finish(summary);
  }
```

**Remove the old `out.finish` call** that currently appears right before the Story 3.3 comment:
```typescript
  const remapCount = decisions.filter((d) => d.action === 'remap').length;
  const summary = `${String(remapCount)} project(s) will be renamed.`;
  if (opts.json === true) {
    out.finish(summary, true, { projects: entries, remappings: decisions });
  } else {
    out.finish(summary);
  }
```

Story 3.3 consolidates the summary emission into a single `out.finish` call that includes the backup path and warnings.

Also update `run()` to destructure `claudeJson` from `locateClaude()` (needed for the `readClaudeJsonFile` call inside `applyDecisions` but it derives `claudeJsonPath` from `claudeDir` directly — so no change needed to `run()` itself).

---

### `src/commands/fix-paths.test.ts` Changes

New mocks to add at top of file (alongside existing mocks):

```typescript
// Mock backup-service
vi.mock('../services/backup-service.js', () => ({
  createBackup: vi.fn(() => Promise.resolve('/home/jordan/.claude/backups/cmemmov/2026-mock')),
}));

// Mock write-gate
const mockLiveGate = vi.hoisted(() => ({
  write: vi.fn(() => Promise.resolve()),
  rename: vi.fn(() => Promise.resolve()),
  mkdir: vi.fn(() => Promise.resolve()),
  remove: vi.fn(() => Promise.resolve()),
  recordedOps: vi.fn(() => []),
}));
const mockDryRunGate = vi.hoisted(() => ({
  write: vi.fn(() => Promise.resolve()),
  rename: vi.fn(() => Promise.resolve()),
  mkdir: vi.fn(() => Promise.resolve()),
  remove: vi.fn(() => Promise.resolve()),
  recordedOps: vi.fn(() => [] as import('../services/write-gate.js').WriteOp[]),
}));
vi.mock('../services/write-gate.js', () => ({
  makeLiveWriteGate: vi.fn(() => mockLiveGate),
  makeDryRunWriteGate: vi.fn(() => mockDryRunGate),
}));

// Mock claude-writer
vi.mock('../services/claude-writer.js', () => ({
  applyCategory: vi.fn(() => Promise.resolve()),
}));

// Mock claude-reader (readClaudeJsonFile — add to existing mock if prompts mock already there)
// The existing claude-reader mock only mocks resolveOriginalPath.
// Extend it:
vi.mock('../services/claude-reader.js', () => ({
  resolveOriginalPath: vi.fn((slug: string) => { ... }),  // keep existing
  readClaudeJsonFile: vi.fn(() => Promise.resolve({ lastSessionCwd: '/home/jordan/moved-app' })),
}));
```

Add to `resetState()`:
```typescript
  vi.mocked(createBackup).mockClear();
  mockLiveGate.rename.mockClear();
  mockLiveGate.write.mockClear();
  vi.mocked(applyCategory).mockClear();
  vi.mocked(readClaudeJsonFile).mockClear();
```

**Note:** The existing `vi.mock('../services/claude-reader.js', ...)` mock covers `resolveOriginalPath`. You must MERGE `readClaudeJsonFile` into that same mock object — do not add a second `vi.mock` for the same module (Vitest deduplicates by module path).

#### New describe blocks

**AC9(a) — Single remap, happy path:**
```typescript
describe('AC9(a): applyDecisions — single remap → backup created, rename called', () => {
  it('createBackup called, gate.rename called with correct slugs', async () => {
    const d: RemapDecision = {
      slug: '-home-jordan-old-app',
      originalPath: '/home/jordan/old-app',
      targetPath: '/home/jordan/new-app',
      action: 'remap',
    };

    await applyDecisions([d], CLAUDE_DIR, {}, mockOutput);

    expect(vi.mocked(createBackup)).toHaveBeenCalledWith(CLAUDE_DIR);
    const expectedOldSlugDir = join(CLAUDE_DIR, 'projects', '-home-jordan-old-app');
    const expectedNewSlugDir = join(CLAUDE_DIR, 'projects', '-home-jordan-new-app');
    expect(mockLiveGate.rename).toHaveBeenCalledWith(expectedOldSlugDir, expectedNewSlugDir);
    expect(vi.mocked(applyCategory)).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'claudeJson', mode: 'overwrite' })
    );
  });
});
```

**AC9(b) — Collision → CmemmovError INTERNAL:**

Set `state.statPaths` for the target slug dir to simulate it exists.

```typescript
describe('AC9(b): applyDecisions — collision → INTERNAL thrown, no rename', () => {
  it('throws INTERNAL when target slug already exists', async () => {
    const d: RemapDecision = {
      slug: '-home-jordan-old-app',
      originalPath: '/home/jordan/old-app',
      targetPath: '/home/jordan/new-app',
      action: 'remap',
    };
    // Target slug dir exists → collision
    state.statPaths.set(join(CLAUDE_DIR, 'projects', '-home-jordan-new-app'), existingFileStat());

    await expect(applyDecisions([d], CLAUDE_DIR, {}, mockOutput))
      .rejects.toMatchObject({ code: 'INTERNAL' });

    expect(mockLiveGate.rename).not.toHaveBeenCalled();
  });
});
```

**AC9(c) — Missing `.claude.json` → warning, no throw:**
Set `readClaudeJsonFile` to return `undefined`.

**AC9(e) — Dry-run → no actual writes, backup skipped:**
```typescript
describe('AC9(e): applyDecisions — dry-run → gate ops recorded, backup not created', () => {
  it('uses dry-run gate, createBackup not called, recordedOps emitted', async () => {
    const d: RemapDecision = {
      slug: '-home-jordan-old-app',
      originalPath: '/home/jordan/old-app',
      targetPath: '/home/jordan/new-app',
      action: 'remap',
    };
    mockDryRunGate.recordedOps.mockReturnValue([
      { kind: 'rename', from: join(CLAUDE_DIR, 'projects', '-home-jordan-old-app'), to: join(CLAUDE_DIR, 'projects', '-home-jordan-new-app') },
    ]);

    await applyDecisions([d], CLAUDE_DIR, { dryRun: true }, mockOutput);

    expect(vi.mocked(createBackup)).not.toHaveBeenCalled();
    expect(vi.mocked(makeDryRunWriteGate)).toHaveBeenCalled();
    expect(vi.mocked(makeLiveWriteGate)).not.toHaveBeenCalled();
  });
});
```

**AC9(f) — All skip/no-op → applyDecisions returns immediately:**
```typescript
describe('AC9(f): applyDecisions — all skip/no-op → backup not created', () => {
  it('returns immediately with no backup when no remap decisions', async () => {
    const decisions: RemapDecision[] = [
      { slug: 'a', originalPath: '/p/a', targetPath: null, action: 'skip' },
      { slug: 'b', originalPath: '/p/b', targetPath: null, action: 'no-op' },
    ];

    const result = await applyDecisions(decisions, CLAUDE_DIR, {}, mockOutput);

    expect(result.backupPath).toBeNull();
    expect(vi.mocked(createBackup)).not.toHaveBeenCalled();
    expect(mockLiveGate.rename).not.toHaveBeenCalled();
  });
});
```

**Helper `mockOutput` for tests:**

Tests that call `applyDecisions` directly need a mock `Output` instance. Add:

```typescript
const mockOutput = {
  progress: vi.fn(),
  warn: vi.fn(),
  finish: vi.fn(),
  error: vi.fn(),
} as unknown as Output;
```

Reset these in `resetState()`.

**Existing tests that call `run({})` with missing projects:** After Story 3.3, `run({})` calls `applyDecisions` which calls `createBackup`. With the new mocks, `createBackup` is mocked to resolve, so existing `run({})` tests will continue to pass without changes — the mock gate is returned and `applyCategory` is mocked to resolve. Verify this is the case before submitting to review.

---

### ESLint Rules to Observe

| Rule | What to avoid | Alternative |
|------|--------------|-------------|
| `no-hardcoded-separator` | `'/'`, `'\\'` as string literals | Use `join()`, `posix.sep`, `win32.sep` |
| `no-non-null-assertion` | `d.targetPath!` | Add runtime guard `if (d.targetPath === null) continue;` |
| `no-process-env-home` | `process.env.HOME` | Not needed here (`claudeDir` is already resolved) |

---

### Key Constraints

1. **ALL collisions must be checked before ANY rename.** A single pre-flight loop through `toRename` checking `stat(newSlugDir)` prevents partial rename states. Do not interleave collision check with rename.

2. **Backup is skipped in dry-run.** No actual backup is created when `opts.dryRun === true`. The gate records what WOULD happen without touching disk.

3. **`applyCategory` with `mode: 'overwrite'` and existing data.** Pass the data read by `readClaudeJsonFile` as `data`. The `remapClaudeJsonPaths` call inside `applyClaudeJson` will remap paths and then `applySettingsAt(filePath, remappedData, 'overwrite', gate)` writes the result. Do NOT pass `data: {}` — that would leave the `.claude.json` path fields unremapped.

4. **`applyDecisions` returns `{ backupPath, warnings }`.** The caller (`run()`) uses these to build the final summary. Do not call `out.finish` inside `applyDecisions`.

5. **Import `Output` type for the mock.** The `mockOutput` in tests uses `as unknown as Output`. Import `Output` as a type at the top of the test file if not already imported.

6. **`readClaudeJsonFile` is already imported in `claude-reader.ts`** and exported. Add it to the imports in `fix-paths.ts`.

7. **`stat` is already imported** in `fix-paths.ts` (used by `buildSuggestion`). Do not add a duplicate import.

---

### Testing the Story Manually

```bash
npm run build

# Single project missing, interactive accept
node dist/cli.js fix-paths

# Scripted mode
node dist/cli.js fix-paths --silent --remap "/home/jordan/old=/home/jordan/new"

# Dry-run
node dist/cli.js fix-paths --dry-run

# JSON output
node dist/cli.js fix-paths --json

# Full test suite
npm test -- fix-paths
```

---

### Story 3.4 Dependencies

Story 3.4 adds integration tests that run the full `fix-paths` pipeline end-to-end via the CLI shell against realistic fixture trees. Story 3.3 must:
- Leave `applyDecisions` exported (integration tests may call it directly or run it via `run()`)
- Ensure the JSON output shape (`{ projects, remappings, backupPath, warnings }`) is stable — integration tests will assert on it

## Tasks / Subtasks

- [x] AC1: Auto-backup before any write
  - [x] Call `createBackup(claudeDir)` before any rename when `dryRun !== true`
  - [x] Report backup path via `out.progress`
- [x] AC2: Apply remap decision
  - [x] Compute new slug via `pathToSlug(d.targetPath)`
  - [x] Rename `~/.claude/projects/<oldSlug>` → `<newSlug>` via `gate.rename`
  - [x] Update `~/.claude.json` via `applyCategory({ category: 'claudeJson', mode: 'overwrite', remapDecisions })`
- [x] AC3: Collision detection upfront
  - [x] Single pre-flight loop after backup, before any rename
  - [x] Throw `CmemmovError({ code: 'INTERNAL', hint: 'target slug ... already exists; ...' })`
- [x] AC4: Orphaned slug → warn callback fires; `summary.warnings` records it; exit 0
- [x] AC5: Missing `.claude.json` → warning emitted, renames completed, exit 0
- [x] AC6: Dry-run mode
  - [x] No backup created
  - [x] `makeDryRunWriteGate` used in place of live gate
  - [x] `gate.recordedOps()` enumerated and emitted
- [x] AC7: Error recovery — backup remains intact on collision/INTERNAL throw
- [x] AC8: Final summary reports backup path (or `[dry-run]`), rename count, skip count
- [x] AC9: Unit tests
  - [x] (a) Single remap → backup created, rename called, applyCategory invoked
  - [x] (b) Collision → CmemmovError INTERNAL thrown, no rename
  - [x] (c) Missing `.claude.json` → warning, no throw
  - [x] (d) Orphaned slug → warn callback from applyCategory propagates
  - [x] (e) Dry-run → recordedOps emitted, backup skipped
  - [x] (f) All skip/no-op → applyDecisions returns immediately
  - [x] (g) `--json` mode → out.finish receives `{ projects, remappings, backupPath, warnings }`
- [x] Update existing tests to match the new summary string format

## Dev Agent Record

### Implementation Plan

The story Dev Notes provided a near-complete reference implementation. Followed it almost verbatim, with the following intentional adjustments:

1. **Non-null assertion replacement**: ESLint `strictTypeChecked` flags `d.targetPath!`. Used the runtime guard `if (d.targetPath === null) continue;` as suggested in the Dev Notes. The `continue` is unreachable for `action === 'remap'` (Story 3.2 invariant) but satisfies the rule cleanly.

2. **Output stub for tests**: `applyDecisions` takes an `Output` instance directly. Tests use a `makeMockOutput()` helper that returns a stub cast through `unknown` to `Output`. Cast is necessary because `Output` declares private fields the stub cannot replicate; `applyDecisions` only ever calls the four public methods (`progress`, `warn`, `finish`, `error`), so the stub is structurally complete for test purposes.

3. **`recordedOps` op kinds**: The Dev Notes example covered `rename`, `write`, `mkdir` but `WriteOp` also includes `remove`. Added an explicit `else` branch for `remove` so a future change to `applyClaudeJson` (e.g. wholesale-replace mode that removes a stale file) does not silently drop the op from the dry-run summary.

4. **Shared mocks via `vi.hoisted`**: Used hoisted-mock pattern matching the existing `mockPromptRemapDecision` style — keeps the mock-vs-mocked-module wiring consistent across the test file. Added `mockReadClaudeJsonFile` to the existing `claude-reader.js` mock object as the Dev Notes explicitly warned against creating a duplicate `vi.mock` for the same module path.

5. **Existing test updates**: Five `expect(stdoutText).toContain('N project(s) will be renamed.')` assertions had to be updated to the new summary format (`'N project(s) renamed, M skipped. Backup: ...'`). The dry-run test now also asserts `Backup: [dry-run]`. The `--json` AC8(h) test now also asserts `parsed.summary.backupPath` is the mocked backup path string.

### Completion Notes

- All 30 fix-paths tests pass; full suite reports **458 passed, 2 skipped, 0 failed**.
- `npm run lint` clean (max-warnings=0 enforced).
- `npx tsc --noEmit` clean.
- `npm run build` produces `dist/fix-paths-*.js` and the dist CLI loads `--help` cleanly.
- `applyDecisions` is exported so Story 3.4 integration tests can drive it directly.
- The JSON output shape is now `{ text, projects, remappings, backupPath, warnings }` — stable for Story 3.4 assertions.
- No additional dependencies required; no configuration changes.

## File List

- `src/commands/fix-paths.ts` — added `applyDecisions` export, rewired `run()` apply phase + summary
- `src/commands/fix-paths.test.ts` — extended mocks (backup-service, write-gate, claude-writer, claude-reader.readClaudeJsonFile), added 7 AC9 describe blocks, updated 5 existing summary assertions
- `_bmad-output/implementation-artifacts/3-3-apply-renames-update-claude-json-backup.md` — added Tasks/Subtasks, Dev Agent Record, File List, Change Log; status → review
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 3-3 ready-for-dev → in-progress → review

## Change Log

- **2026-05-09** — Story 3.3 implemented: `applyDecisions` added with backup → collision pre-check → rename → `.claude.json` remap pipeline. Updated `run()` to consume `{ backupPath, warnings }` and emit a single combined summary line. Test suite extended with 7 new describe blocks covering all AC9 sub-cases; 5 existing assertions updated to the new summary format. Status: review.
- **2026-05-09 (review pass)** — Code review found 2 MEDIUM issues (malformed `.claude.json` silently treated as missing; intra-batch target-slug collision not detected). Both patched in-place: switched `.claude.json` read to `readSettingsFileStrict` and moved it ahead of the rename loop so a malformed file aborts before any directory change; added intra-batch target-slug dedup to the pre-flight collision check. 1 LOW patched in-place: dry-run rename progress line now reads `[dry-run] Would rename:` instead of `Renamed:`. Three LOW items deferred (see `deferred-work.md`). Test suite grew from 30 to 32 cases (added malformed-JSON and intra-batch-collision regression tests); full suite reports 460 passed / 2 skipped / 0 failed. Lint and `tsc --noEmit` clean.

## Review Findings

### Patched in-place

- [x] [Review][Patch] Malformed `~/.claude.json` silently treated as missing [src/commands/fix-paths.ts:282] — `readClaudeJsonFile` collapsed ENOENT and parse-failure into the same `undefined` result, so a corrupt-but-recoverable `.claude.json` would emit a misleading `not found` warning while leaving its real (stale) content untouched. Switched to `readSettingsFileStrict` (which surfaces `'malformed'` distinctly) and moved the read ahead of the rename loop so a malformed file aborts the whole apply phase before any rename — the user's filesystem stays in a clean pre-rename state with the backup available for inspection. Severity: MEDIUM.
- [x] [Review][Patch] Intra-batch target-slug collision not detected [src/commands/fix-paths.ts:233-244] — pre-flight only checked each target against on-disk state, so two `remap` decisions whose targetPaths slugged to the same string would both pass the on-disk check; the first rename would succeed, the second would fail mid-loop, leaving a half-renamed tree. Added a `seenTargets: Map<newSlug, originatingSlug>` to the pre-flight loop that throws `INTERNAL` with both originating decision slugs in the hint when a duplicate is detected. Severity: MEDIUM.
- [x] [Review][Patch] Dry-run progress line claimed `Renamed:` even though no rename occurred [src/commands/fix-paths.ts:263] — confusing for users reviewing dry-run output. Now emits `[dry-run] Would rename: <oldSlug> -> <newSlug>` in dry-run mode, `Renamed: ...` in live mode. Severity: LOW.

### Deferred (logged in `_bmad-output/implementation-artifacts/deferred-work.md` under "Deferred from: code review of story-3.3 (2026-05-09)")

- [x] [Review][Defer] Collision pre-flight skipped in dry-run [src/commands/fix-paths.ts:232] — deferred, scope/usability iteration. Severity: LOW.
- [x] [Review][Defer] `WriteGate.rename` EXDEV fallback fails for directories [src/services/write-gate.ts:46-54] — deferred, write-gate is shared infrastructure beyond Story 3.3 scope. Severity: LOW.
- [x] [Review][Defer] Warnings duplicated in JSON output (`summary.warnings` AND top-level `warnings`) — deferred, output-contract polish for a later docs/cleanup pass. Severity: LOW.
