# Story 1.5: Filesystem Discipline — WriteGate & Backup Service

Status: review

## Story

As a developer working on cmemmov,
I want a `WriteGate` abstraction that all file writes flow through (atomic write-temp+rename in live mode, no-op recording in dry-run mode) plus a `backup-service` that produces complete pre-write snapshots with retention,
so that NFR10 (fatal errors leave pre-import state intact), NFR11 (complete restorable backups), NFR12 (dry-run byte-lossless), and NFR13 (atomic writes) are enforced architecturally rather than per-command.

## Acceptance Criteria

1. Live `WriteGate`: `gate.write(targetPath, content)` writes content to `<targetPath>.cmemmov-tmp-<pid>-<random>` first, then atomically renames to `targetPath`. An interrupted process cannot leave a partial file at `targetPath`.

2. Live `WriteGate`: when `gate.rename(from, to)` fails with `EXDEV` (cross-volume rename), it falls back to `fs.copyFile(from, to)` + `fs.unlink(from)` and emits a warning via the Output module explaining non-atomicity. The operation completes successfully.

3. Dry-run `WriteGate`: calls to `write`, `rename`, `mkdir`, and `remove` perform zero filesystem operations. `gate.recordedOps()` returns an array of recorded operations in invocation order with `kind`, `path`, and (for writes) `bytes`.

4. `backup-service.createBackup(claudeDir)` recursively copies the entire `claudeDir` tree to `path.join(claudeDir, 'backups', 'cmemmov', '<ISO-timestamp>-<pid>-<random>')`, plus copies the adjacent `<path.dirname(claudeDir)>/.claude.json` if it exists. Returns the backup directory path.

5. Backup retention: after a successful new backup, prune the oldest entries beyond the `keepBackups` limit (default 10). If the new backup fails, no pruning occurs — all prior backups remain.

6. ESLint `no-restricted-imports` rule is added to `eslint.config.js` banning the named imports `writeFile`, `rename`, `unlink`, `copyFile`, `rmdir`, and `rm` from `node:fs`, `node:fs/promises`, `fs`, and `fs/promises` in all `src/**/*.ts` files EXCEPT `src/services/write-gate.ts` and `src/services/backup-service.ts`. Running `npm run lint` on any other file importing those names fails with an error.

7. `tests/integration/dry-run-isolation.test.ts` creates a real temp directory, exercises a dry-run WriteGate over it (write + rename + mkdir + remove), and asserts the directory's contents are byte-for-byte identical before and after (NFR12). The `recordedOps()` output is also asserted.

## Tasks / Subtasks

- [x] Task 1: Create `src/services/write-gate.ts` (ACs: 1, 2, 3)
  - [x] Export `WriteOp` discriminated union and `WriteGate` interface — see Dev Notes for exact shape
  - [x] Export `makeLiveWriteGate(): WriteGate` — atomic write-temp+rename + EXDEV fallback
  - [x] Export `makeDryRunWriteGate(): WriteGate` — zero I/O, push to internal `ops` array
  - [x] Temp file naming: `<targetPath>.cmemmov-tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}` — use `node:crypto` for the random suffix, NOT `Math.random()`
  - [x] For EXDEV fallback: catch the rename error, check `(err as NodeJS.ErrnoException).code === 'EXDEV'`, copyFile + unlink + call `Output.warn()` — resolved via Option A: `makeLiveWriteGate(warn?: (msg: string) => void)` injects the warn callback so the service does NOT import `ui/output.ts`.
  - [x] ESM `.js` extension on all intra-src imports

- [x] Task 2: Create `src/services/write-gate.test.ts` (ACs: 1, 2, 3)
  - [x] Unit tests using `vi.mock('node:fs/promises')` for live gate write and rename
  - [x] Test live gate: write goes through temp path; rename is called atomically
  - [x] Test live gate: EXDEV code triggers copyFile + unlink fallback
  - [x] Test dry-run gate: no fs calls made (spy or mock); recordedOps() correct
  - [x] Test dry-run gate: `bytes` field reflects content length for write ops

- [x] Task 3: Create `src/services/backup-service.ts` (ACs: 4, 5)
  - [x] Export `createBackup(claudeDir: string, opts?: { keepBackups?: number }): Promise<string>`
  - [x] Build backup dir: `path.join(claudeDir, 'backups', 'cmemmov', buildTimestamp())`
  - [x] Timestamp format: `new Date().toISOString().replace(/[:.]/g, '-')` + `-${process.pid}-<4-hex-bytes>`
  - [x] Recursively copy claudeDir tree using `fs.cp(...)` — staged through `os.tmpdir()` because Node's `fs.cp` rejects with EINVAL when destination is a subdirectory of source. See Completion Notes.
  - [x] Copy adjacent `.claude.json`: `path.join(path.dirname(claudeDir), '.claude.json')` — skip silently if it does not exist (ENOENT is not an error; `.claude.json` may be absent)
  - [x] After successful new backup: read `path.join(claudeDir, 'backups', 'cmemmov')`, sort entries by name (ISO timestamps sort lexicographically), remove oldest beyond `keepBackups` (default 10) using `fs.rm(dir, { recursive: true })`
  - [x] If the new backup write throws: do NOT prune — re-throw the error
  - [x] Do NOT call `os.homedir()` — derive all paths from `claudeDir` parameter

- [x] Task 4: Create `src/services/backup-service.test.ts` (ACs: 4, 5)
  - [x] Integration-style tests using real temp dirs under `os.tmpdir()`
  - [x] Test: createBackup copies directory tree to expected path pattern
  - [x] Test: createBackup copies adjacent `.claude.json` when present; skips when absent
  - [x] Test: 11 backups with keepBackups=10 → oldest pruned after 11th succeeds
  - [x] Test: if backup write fails → no pruning, original 10 remain intact
  - [x] Clean up temp dirs in `afterEach`

- [x] Task 5: Add `no-restricted-imports` rule to `eslint.config.js` (AC: 6)
  - [x] READ `eslint.config.js` before editing
  - [x] Add a new config block scoped to `src/**/*.ts` (EXCLUDING write-gate.ts, backup-service.ts, and `*.test.ts` co-located tests) with the `no-restricted-imports` rule
  - [x] Verify: `npm run lint` fails on a file that imports `writeFile` from `node:fs/promises`; confirm write-gate.ts is exempt
  - [x] Verify: `npm run lint` passes on the full project after adding the rule

- [x] Task 6: Create `tests/integration/dry-run-isolation.test.ts` (AC: 7)
  - [x] Use `os.tmpdir()` + `mkdtemp` for isolated temp dir
  - [x] Snapshot directory contents before dry-run operations (recursive readdir with content fingerprint)
  - [x] Exercise all four WriteGate operations (write, rename, mkdir, remove) via dry-run gate
  - [x] Assert directory contents are byte-identical to snapshot
  - [x] Assert `recordedOps()` contains 4 entries with correct shapes
  - [x] Clean up temp dir in `afterEach`

- [x] Task 7: Create `src/services/.gitkeep` cleanup — delete if it exists (housekeeping)

- [x] Task 8: Final validation (ACs: 6, 7)
  - [x] `npm run check` exits 0
  - [x] Verify `no-restricted-imports` rule fires correctly on a synthetic test (verified by adding a temporary file with a banned import and observing ESLint error, then deleting it)

## Dev Notes

### `WriteGate` interface and `WriteOp` union

```typescript
import { writeFile, rename, mkdir, rm, copyFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import process from 'node:process';

export type WriteOp =
  | { kind: 'write'; path: string; bytes: number }
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'mkdir'; path: string }
  | { kind: 'remove'; path: string };

export interface WriteGate {
  write(path: string, content: Buffer | string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  remove(path: string): Promise<void>;
  recordedOps(): readonly WriteOp[];
}
```

[Source: architecture.md — §"Key Module Specs" (`services/write-gate.ts`)]

### `makeLiveWriteGate` implementation sketch

```typescript
export function makeLiveWriteGate(): WriteGate {
  const ops: WriteOp[] = [];

  return {
    async write(path, content) {
      const tmp = `${path}.cmemmov-tmp-${process.pid.toString()}-${randomBytes(4).toString('hex')}`;
      await writeFile(tmp, content);
      await rename(tmp, path);
      ops.push({ kind: 'write', path, bytes: Buffer.byteLength(content) });
    },
    async rename(from, to) {
      try {
        await rename(from, to);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
          await copyFile(from, to);
          await rm(from);
          // Output.warn call — see "Output import direction" below
        } else {
          throw err;
        }
      }
      ops.push({ kind: 'rename', from, to });
    },
    async mkdir(path, opts) {
      await mkdir(path, opts);
      ops.push({ kind: 'mkdir', path });
    },
    async remove(path) {
      await rm(path, { recursive: true });
      ops.push({ kind: 'remove', path });
    },
    recordedOps() {
      return ops;
    },
  };
}
```

### Output import direction — cross-layer concern

The architecture's layered rule (`services → core`, NOT `services → ui`) prevents `write-gate.ts` from importing `output.ts` directly. The EXDEV warning (AC 2) needs to reach the user. Two options:

**Option A (preferred for Story 1.5):** Accept a `warn: (msg: string) => void` callback parameter in `makeLiveWriteGate(warn)`. The command layer (Story 1.9+) passes `Output.warn` when constructing the gate. The dry-run gate ignores it. This keeps the service pure and pushes the Output dependency up to the caller.

**Option B:** Pass a `warn` callback in the `WriteGate` interface constructor. Same idea, slightly different surface.

Use **Option A** — it matches how the architecture designs "services receive paths as injected arguments" principle. Update the function signature: `makeLiveWriteGate(warn: (msg: string) => void = () => {}): WriteGate`. The default no-op means tests and Story 1.5's own tests don't need to provide Output.

[Source: architecture.md — §"Architectural Boundaries"]

### `makeDryRunWriteGate` implementation sketch

```typescript
export function makeDryRunWriteGate(): WriteGate {
  const ops: WriteOp[] = [];

  return {
    async write(path, content) {
      ops.push({ kind: 'write', path, bytes: Buffer.byteLength(content) });
    },
    async rename(from, to) {
      ops.push({ kind: 'rename', from, to });
    },
    async mkdir(path) {
      ops.push({ kind: 'mkdir', path });
    },
    async remove(path) {
      ops.push({ kind: 'remove', path });
    },
    recordedOps() {
      return ops;
    },
  };
}
```

### `backup-service.ts` — path derivation (no `os.homedir()`)

```typescript
import { cp, rm, readdir, copyFile, access } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import process from 'node:process';

// claudeDir = absolute path to ~/.claude/ (resolved by claude-locator in later stories)
// backups live at claudeDir/backups/cmemmov/<timestamp>-<pid>-<hex>/
// adjacent .claude.json lives at dirname(claudeDir)/.claude.json

export async function createBackup(
  claudeDir: string,
  opts?: { keepBackups?: number },
): Promise<string> {
  const keepBackups = opts?.keepBackups ?? 10;
  const backupRoot = join(claudeDir, 'backups', 'cmemmov');

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = `${process.pid.toString()}-${randomBytes(4).toString('hex')}`;
  const backupDir = join(backupRoot, `${ts}-${suffix}`);

  // Create the backup (throws on failure — no pruning if this throws)
  await cp(claudeDir, join(backupDir, 'claude'), { recursive: true });

  // Copy adjacent .claude.json — skip if absent
  const claudeJsonSrc = join(dirname(claudeDir), '.claude.json');
  try {
    await access(claudeJsonSrc);
    await copyFile(claudeJsonSrc, join(backupDir, '.claude.json'));
  } catch {
    // .claude.json absent — not an error
  }

  // Prune oldest backups beyond keepBackups limit
  const entries = await readdir(backupRoot);
  const sorted = entries.sort(); // ISO timestamps sort lexicographically
  const toRemove = sorted.slice(0, Math.max(0, sorted.length - keepBackups));
  await Promise.all(toRemove.map(e => rm(join(backupRoot, e), { recursive: true })));

  return backupDir;
}
```

**Key constraint:** `backup-service.ts` is explicitly permitted to call `fs.cp`, `fs.copyFile`, `fs.rm`, `fs.readdir` (ESLint rule only bans `writeFile`, `rename`, `unlink`, `rmdir`). The service creates its own real fs operations directly — it does NOT route through a `WriteGate` (backup is a meta-operation, not a user-data write).

[Source: architecture.md — §"Filesystem Discipline", §"Architectural Boundaries"]

### `no-restricted-imports` ESLint config

Add this block to `eslint.config.js` **after** the existing `files: ['src/**/*.ts']` block and **before** the `ignores` block:

```js
{
  files: ['src/**/*.ts'],
  ignores: [
    'src/services/write-gate.ts',
    'src/services/backup-service.ts',
  ],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        {
          name: 'node:fs/promises',
          importNames: ['writeFile', 'rename', 'unlink', 'copyFile', 'rmdir', 'rm'],
          message: 'Direct fs write ops must go through WriteGate (src/services/write-gate.ts).',
        },
        {
          name: 'fs/promises',
          importNames: ['writeFile', 'rename', 'unlink', 'copyFile', 'rmdir', 'rm'],
          message: 'Direct fs write ops must go through WriteGate (src/services/write-gate.ts).',
        },
        {
          name: 'node:fs',
          importNames: ['writeFileSync', 'renameSync', 'unlinkSync', 'copyFileSync', 'rmdirSync', 'rmSync'],
          message: 'Direct fs write ops must go through WriteGate (src/services/write-gate.ts).',
        },
      ],
    }],
  },
},
```

**Note on `ignores` inside a config block:** ESLint flat config supports `ignores` within a config block as a negation of the `files` glob. The `src/services/write-gate.ts` and `src/services/backup-service.ts` entries are excluded from the rule. Confirm this works with the installed ESLint version (9.11.1) before finalizing.

**Alternative if per-block `ignores` doesn't work:** Use two separate config blocks — one for the restricted files (all `src/**/*.ts` except the two permitted files) using a negative glob pattern like `!src/services/write-gate.ts`.

[Source: architecture.md — §"Architectural Boundaries" (forbidden list), §"Enforcement" table]

### `process` import note

In ESM under `@typescript-eslint/strict-type-checked`, bare `process.pid` may require an explicit `import process from 'node:process'`. The `no-process-env-home` rule only bans `process.env.HOME`; `process.pid` is fine. Use `import process from 'node:process'` to be explicit.

### `fs.rm` vs `fs.rmdir`

The architecture bans `fs.rmdir`. Use `fs.rm(path, { recursive: true })` instead for recursive directory removal. This is available in Node.js v14.14+ and is the recommended API in v22.

### What exists in `src/services/` at start of Story 1.5

After Stories 1.1–1.4:
- `src/services/.gitkeep` (if it still exists from Story 1.1)
- No other service files

Story 1.5 creates the first real service modules.

### Integration test approach for `dry-run-isolation.test.ts`

```typescript
import { mkdtemp, readdir, stat, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { makeDryRunWriteGate } from '../../src/services/write-gate.js';

// Snapshot helper: recursively list all files + their sizes
async function snapshot(dir: string): Promise<Record<string, number>> { ... }

describe('dry-run isolation', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'cmemmov-test-')); });
  afterEach(async () => { await rm(tmpDir, { recursive: true }); });

  it('leaves filesystem byte-identical after dry-run operations', async () => {
    // Seed some files
    await writeFile(join(tmpDir, 'seed.txt'), 'hello');
    const before = await snapshot(tmpDir);

    const gate = makeDryRunWriteGate();
    await gate.write(join(tmpDir, 'new.txt'), 'world');
    await gate.rename(join(tmpDir, 'seed.txt'), join(tmpDir, 'renamed.txt'));
    await gate.mkdir(join(tmpDir, 'subdir'));
    await gate.remove(join(tmpDir, 'seed.txt'));

    const after = await snapshot(tmpDir);
    expect(after).toEqual(before); // no change

    const ops = gate.recordedOps();
    expect(ops).toHaveLength(4);
    expect(ops[0]).toMatchObject({ kind: 'write', bytes: 5 });
    expect(ops[1]).toMatchObject({ kind: 'rename' });
    expect(ops[2]).toMatchObject({ kind: 'mkdir' });
    expect(ops[3]).toMatchObject({ kind: 'remove' });
  });
});
```

**Note:** `tests/integration/dry-run-isolation.test.ts` is NOT in `src/` so the `no-restricted-imports` rule does not apply to it. Direct `fs` imports are fine in integration test helpers.

### ESLint `ignores` in `eslint.config.js` current state

Current `eslint.config.js` (already read in Story 1.2):
```js
import tseslint from 'typescript-eslint';
import cmemmovPlugin from './eslint-rules/index.js';

export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: { parserOptions: { project: ['./tsconfig.eslint.json'], tsconfigRootDir: import.meta.dirname } },
  },
  {
    files: ['src/**/*.ts'],
    plugins: { cmemmov: cmemmovPlugin },
    rules: {
      'cmemmov/no-process-env-home': 'error',
      'cmemmov/no-hardcoded-separator': 'error',
      'cmemmov/no-console-outside-output': 'error',
      'cmemmov/no-raw-json-parse': 'error',
    },
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint-rules/**'],
  },
);
```

READ this file before editing. Add the `no-restricted-imports` block after the cmemmov rules block.

### Project Structure Notes

Files being created (NEW):
- `src/services/write-gate.ts`
- `src/services/write-gate.test.ts`
- `src/services/backup-service.ts`
- `src/services/backup-service.test.ts`
- `tests/integration/dry-run-isolation.test.ts`

Files being modified (UPDATE):
- `eslint.config.js` — add `no-restricted-imports` block
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — update story 1-5 status

Files being deleted (REMOVE):
- `src/services/.gitkeep` (if present)

### References

- [Source: epics.md — Story 1.5 Acceptance Criteria, lines 431–479]
- [Source: architecture.md — §"Key Module Specs" (`services/write-gate.ts`), lines 683–701]
- [Source: architecture.md — §"Filesystem Discipline", lines 293–316]
- [Source: architecture.md — §"Architectural Boundaries" (forbidden list), lines 637–643]
- [Source: architecture.md — §"Test Patterns", lines 451–457]
- [Source: architecture.md — §"Enforcement" table, lines 474–486]
- [Source: Story 1.2 — current eslint.config.js shape]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- `npm run check` — full lint + typecheck + test suite passes (12 test files, 93 tests passing).
- New tests added: 13 unit tests for write-gate, 7 integration-style tests for backup-service, 3 integration tests for dry-run isolation = 23 new tests.

### Completion Notes List

- **WriteGate**: implemented per spec. The `Output` import direction concern (Dev Notes) was resolved with **Option A**: `makeLiveWriteGate(warn?: (msg: string) => void)` accepts an optional warn callback, defaulting to a no-op. Services therefore never import from `ui/`.
- **Temp-file naming** uses `crypto.randomBytes(4).toString('hex')` per spec (NOT `Math.random()`).
- **Backup staging deviation from Dev Notes sketch**: Node.js `fs.cp` rejects with `EINVAL` ("cannot copy a path to a subdirectory of self") when `dest` is inside `src` — even if a `filter` excludes the destination subtree. This is a documented Node.js behavior (nodejs/node#55267). Since `backupDir` is by design at `<claudeDir>/backups/cmemmov/<ts>/`, the implementation **stages the copy in `os.tmpdir()` first** (`mkdtemp`), then `rename`s the staged directory into the final backup root. EXDEV is handled by falling back to `cp + rm` (cross-volume move when tmpdir is on a different filesystem). The pre-existing `<claudeDir>/backups/` subtree is excluded from the staged copy via a `filter` option so a new backup never contains older backups.
- **ESLint rule scope**: per AC6, the rule applies to `src/**/*.ts` except `write-gate.ts` and `backup-service.ts`. Since the project colocates tests as `src/**/*.test.ts` (matching the existing pattern in `src/core/`), and tests need direct fs access for fixture setup and mock injection, `src/**/*.test.ts` was added to the rule's `ignores`. Production code in `src/` (everything except the two service modules and `*.test.ts`) is bound by the rule. The Dev Notes alternative ("two separate config blocks with negative globs") was not needed — flat-config per-block `ignores` works as documented in ESLint 9.11.1.
- **`fs` and `fs/promises` namespaces**: AC6 lists "node:fs, node:fs/promises, fs, and fs/promises" — added all four namespace blocks to `no-restricted-imports`.
- **`no-hardcoded-separator` rule**: backup-service uses `sep` from `node:path` (variable, not literal) when computing `excludePrefix`, so the rule passes.
- **`fs.rm` vs `fs.rmdir`**: `fs.rm(path, { recursive: true })` used throughout per architecture guidance.

### File List

**Created:**

- `src/services/write-gate.ts` — `WriteGate` interface, `WriteOp` union, `makeLiveWriteGate`, `makeDryRunWriteGate`.
- `src/services/write-gate.test.ts` — 13 unit tests (mocked `node:fs/promises`).
- `src/services/backup-service.ts` — `createBackup(claudeDir, opts?)`.
- `src/services/backup-service.test.ts` — 7 integration-style tests (real temp dirs).
- `tests/integration/dry-run-isolation.test.ts` — 3 NFR12 integration tests.

**Modified:**

- `eslint.config.js` — added `no-restricted-imports` block scoped to `src/**/*.ts` (excluding the two service modules and co-located `*.test.ts` files).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 1-5 status moved ready-for-dev → in-progress → review.

**Deleted:**

- `src/services/.gitkeep` — no longer needed; directory now contains real source files.

### Change Log

- 2026-05-09 — Initial implementation: WriteGate (live + dry-run), backup-service (staged-copy variant for dest-inside-src), ESLint enforcement, integration tests. All ACs satisfied; `npm run check` passes.
- 2026-05-09 — Code review fixes (cr-1-5): patched temp-file cleanup on rename failure in `write-gate.ts`; narrowed silent catch in `backup-service.ts` to ENOENT-only; protected the just-created backup from `keepBackups < 1` pruning. Added 4 regression tests (97 tests total now passing).

### Review Findings

- [x] \[Review\]\[Patch\] write-gate.ts `write()` leaked the `.cmemmov-tmp-*` file when `fsRename` failed after a successful `fsWriteFile` [src/services/write-gate.ts:29-39] — fixed with try/catch around rename + best-effort `fsRm(tmp, { force: true })` cleanup before rethrow. Regression tests added: "cleans up the temp file when rename fails" and "still rethrows the rename error even if temp-file cleanup fails".
- [x] \[Review\]\[Patch\] backup-service.ts silent `catch {}` around the `.claude.json` access+copyFile block swallowed ALL errors (EACCES, EISDIR, ENOSPC mid-copy), violating the architecture rule that catches must handle a specific known case [src/services/backup-service.ts:65-67] — narrowed to rethrow non-ENOENT errors. Regression test added: "propagates non-ENOENT errors when copying the adjacent .claude.json" (uses an EISDIR scenario by creating `.claude.json` as a directory).
- [x] \[Review\]\[Patch\] backup-service.ts pruning could destroy the just-created backup when `keepBackups < 1` was passed, leaving the function returning a path to a deleted directory and breaking its contract [src/services/backup-service.ts:70-75] — added a `.filter((entry) => entry !== justCreated)` guard. Regression test added: "never prunes the just-created backup even when keepBackups is 0".
- [x] \[Review\]\[Defer\] AC6 ESLint rule deviation — `src/**/*.test.ts` was added to the rule's `ignores` beyond the literal AC6 scope (which exempts only the two service modules) [eslint.config.js:30] — deferred, sensible deviation already documented in the story Completion Notes; logged to `deferred-work.md` for PM/Architect ratification.
- [x] \[Review\]\[Defer\] AC4 strict-text deviation — `stageClaudeCopy` excludes `<claudeDir>/backups/**` from the recursive copy, while AC4 says "recursively copies the entire `claudeDir` tree" [src/services/backup-service.ts:18-25] — deferred, the exclusion is necessary to prevent recursive backup-of-backups but is not in the spec; logged to `deferred-work.md` for AC clarification.
