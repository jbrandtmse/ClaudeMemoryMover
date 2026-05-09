# Story 2.4: Cross-OS Integration Tests

Status: done

## Story

As a cmemmov maintainer,
I want a comprehensive integration test suite that exercises all six cross-OS combinations (win→mac, win→linux, mac→linux, mac→win, linux→mac, linux→win) as full export → import round-trips,
So that the central differentiator is regression-protected by mechanical assertion, satisfying the PRD's explicit success criterion that "cross-OS migrations complete without manual file editing for all supported artifact categories."

## Acceptance Criteria

1. **Exactly 6 test cases in `tests/integration/cross-os-import.test.ts`.** One per cross-OS combination: win→mac, win→linux, mac→linux, mac→win, linux→mac, linux→win.

2. **Each test case follows this protocol:**
   - (a) Build a fixture `~/.claude/` tree representative of the source OS using `tests/integration/helpers/temp-claude-dir.ts`
   - (b) Run export via the production code path to produce a `.cmemmov` bundle
   - (c) Mock `os.platform()` and `os.homedir()` to the target OS via `tests/integration/helpers/platform-mock.ts`
   - (d) Run import with prepared `--remap` flags (scripted mode — no interactive prompts in CI)
   - (e) Assert the resulting target tree

3. **Assertions on a successful cross-OS import:**
   - Project directories under target `~/.claude/projects/` use target-OS slug encoding (slug of target-OS path)
   - `settings.json` permission rules contain target-OS-style paths
   - `~/.claude.json` global state path fields are target-OS-style
   - `MEMORY.md` indexes match the on-disk file layout

4. **Skip scenario:** When one project is simulated as skipped (via `--remap` covering only the other project and silent mode so no prompt fires for the uncovered one — or more precisely, by simulating a skip via `remapDecisions` with `targetPath: null`), the post-import target tree does NOT contain that project's directory.

5. **Dry-run contract (NFR12):** A cross-OS test with `--dry-run` completes without error; byte-for-byte snapshot of the target tree before vs. after is identical — zero changes.

6. **Corrupted bundle contract:** A cross-OS test with a corrupted bundle checksum exits 2 with `BUNDLE_CHECKSUM_MISMATCH`; no auto-backup is created; target tree is untouched.

7. **Tests run on all three CI OS runners** (win/mac/linux). The platform mock makes the source OS portable — tests don't skip based on the real OS (AC7 ban: no `describe.skip`/`it.skip` for OS reasons). Only assertions that depend on current-OS filesystem behavior (e.g., `fs.rename` atomicity) are individually guarded with `os.platform()` checks WITH a documented comment.

## Tasks / Subtasks

- [x] Task 1 — Create `tests/integration/helpers/temp-claude-dir.ts` (AC: #2a, #2b)
  - [x] 1.1 Export `TempClaudeDir` interface:
    ```ts
    export interface TempClaudeDir {
      homeDir: string;        // e.g. "C:\\Users\\alice" or "/home/alice"
      claudeDir: string;      // homeDir + "/.claude" or homeDir + "\\.claude"
      claudeJsonPath: string; // claudeDir + ".json"
      projectRealPath: string; // homeDir + "/projects/my-app" (one fixture project)
      projectSlug: string;    // pathToSlug(projectRealPath)
      tmpRoot: string;        // actual tempdir for cleanup
    }
    ```
  - [x] 1.2 Export `seedClaudeTree(opts: SeedOpts): Promise<TempClaudeDir>` where `SeedOpts`:
    ```ts
    interface SeedOpts {
      sourcePlatform: 'win32' | 'darwin' | 'linux';
      sourceUser: string;   // e.g. "alice"
      targetUser: string;   // e.g. "maya" — used in settings.json paths
    }
    ```
  - [x] 1.3 In `seedClaudeTree`:
    - Create `tmpRoot` via `mkdtemp(join(tmpdir(), 'cmemmov-crossos-'))`
    - Derive source-OS-style paths using string manipulation (NOT `path.join` — that uses the real OS separator). Use template literals:
      - win32: `` `C:\\Users\\${sourceUser}` `` for homeDir; `` `${homeDir}\\.claude` `` for claudeDir
      - darwin: `` `/Users/${sourceUser}` `` for homeDir; `` `${homeDir}/.claude` `` for claudeDir
      - linux: `` `/home/${sourceUser}` `` for homeDir; `` `${homeDir}/.claude` `` for claudeDir
    - `projectRealPath`:
      - win32: `` `C:\\Users\\${sourceUser}\\projects\\my-app` ``
      - darwin/linux: `` `${homeDir}/projects/my-app` ``
    - `projectSlug`: call `pathToSlug(projectRealPath)` from `'../../../src/core/path-engine.js'`
    - Create real directories on disk using `tmpRoot`:
      - `tmpRoot/.claude/projects/<projectSlug>/sessions/`
      - Write `session-1.jsonl` with `{ type: 'message', cwd: projectRealPath, version: '2.1.133' }` — the `cwd` uses the source-OS path string (the fake path, not a real disk path)
      - Write `CLAUDE.md` in project dir: `'# Project memory\n'`
      - Write `settings.json` in project dir with a permission rule using source-OS path:
        - win32: `{ "permissions": ["Read(C:\\\\Users\\\\${targetUser}\\\\projects\\\\**)", "Write(C:\\\\Users\\\\${sourceUser}\\\\projects\\\\my-app\\\\**)"] }`
        - darwin: `{ "permissions": ["Read(/Users/${targetUser}/projects/**)", "Write(/Users/${sourceUser}/projects/my-app/**)"] }`
        - linux: `{ "permissions": ["Read(/home/${targetUser}/projects/**)", "Write(/home/${sourceUser}/projects/my-app/**)"] }`
      - Write global `settings.json`: `{ "model": "sonnet" }`
      - Write global `CLAUDE.md`: `'# Global memory\n'`
      - Write `MEMORY.md` in global dir: `'# Memory Index\n\n- [note](note.md) — a note\n'`
      - Write `.claude.json` adjacent to `.claude/`:
        ```json
        {
          "lastSessionCwd": "<projectRealPath>",
          "currentProject": "<projectRealPath>",
          "recentProjects": [{ "path": "<projectRealPath>" }]
        }
        ```
        Use source-OS-style path strings (fake paths, not real disk paths)
    - Set `process.env.CLAUDE_CONFIG_DIR` = `tmpRoot/.claude` (real tmpdir path) so `locateClaude()` resolves the test tree
    - Return the `TempClaudeDir` struct

- [x] Task 2 — Create `tests/integration/helpers/platform-mock.ts` (AC: #2c)
  - [x] 2.1 This module provides `vi.mock` helpers that override `node:os` in the test scope.
  - [x] 2.2 Export `PlatformMock` interface:
    ```ts
    export interface PlatformMock {
      restore(): void;
    }
    ```
  - [x] 2.3 Export `mockPlatform(platform: NodeJS.Platform, homedir: string): PlatformMock`:
    - Uses `vi.stubGlobal` / property override on the `os` module to set `process.platform` and intercept `os.platform()` + `os.homedir()`
    - Returns a `restore()` that undoes the override
    - **Key constraint**: `import.ts` derives homedir as `dirname(claudeDir)` (not `os.homedir()`). The platform mock only needs to affect `process.platform` and `isCrossPlatformMigration`'s platform checks. The homedir is derived from `CLAUDE_CONFIG_DIR` env var, so no `os.homedir()` mock is needed for the scripted-remap path.
    - Implementation:
      ```ts
      export function mockPlatform(platform: NodeJS.Platform): PlatformMock {
        const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', {
          configurable: true,
          get: () => platform,
        });
        return {
          restore() {
            if (originalPlatform) {
              Object.defineProperty(process, 'platform', originalPlatform);
            }
          },
        };
      }
      ```
  
- [x] Task 3 — Create `tests/integration/cross-os-import.test.ts` (AC: #1–#7)
  - [x] 3.1 Write exactly 6 parameterized test cases using `it.each` or a `const CASES` array with `describe` + `it`:
    ```ts
    const CROSS_OS_CASES = [
      { src: 'win32',  srcUser: 'alice', tgt: 'darwin', tgtUser: 'maya' },
      { src: 'win32',  srcUser: 'alice', tgt: 'linux',  tgtUser: 'maya' },
      { src: 'darwin', srcUser: 'alice', tgt: 'win32',  tgtUser: 'maya' },
      { src: 'darwin', srcUser: 'alice', tgt: 'linux',  tgtUser: 'maya' },
      { src: 'linux',  srcUser: 'alice', tgt: 'darwin', tgtUser: 'maya' },
      { src: 'linux',  srcUser: 'alice', tgt: 'win32',  tgtUser: 'maya' },
    ] as const;
    ```
  - [x] 3.2 For each test case (full round-trip, AC: #2–#3):
    - `beforeEach`: Call `seedClaudeTree({ sourcePlatform: src, sourceUser: srcUser, targetUser: tgtUser })` — captures `tmpDir`
    - Run export via `run` from `'../../src/commands/export.js'` with `{ silent: true, json: true, categories: '...all...', allProjects: true, output: bundlePath }`
    - Mock platform to target OS using `mockPlatform(tgt)`
    - Build `--remap` string: `"${srcHomePrefix}=${tgtHomePrefix}"` where `srcHomePrefix` = source-OS home (e.g., `C:\Users\alice`), `tgtHomePrefix` = target-OS home constructed for `tgtUser` (e.g., `/Users/maya`)
    - Set up target tmpdir for import (`CLAUDE_CONFIG_DIR` = new tmpdir `.claude`)
    - Run import via `run` from `'../../src/commands/import.js'` with `{ mode: 'merge', silent: true, json: true, remap: [remapSpec] }`
    - **Assert target tree** (all using `readFile` / `stat` on real disk):
      - Target project dir exists: `~/.claude/projects/<targetSlug>/`
      - `targetSlug` = `pathToSlug(tgtProjectPath)` where `tgtProjectPath` = source path with home prefix swapped
      - `settings.json` in target project dir: permission rules use target-OS separator style (e.g., `/` for POSIX, `\` for win32)
      - `.claude.json` at target claudeJsonPath: `lastSessionCwd`, `currentProject`, `recentProjects[0].path` all use target-OS style path
      - `MEMORY.md` exists in global target dir
    - `afterEach`: Restore platform mock, cleanup both source and target tmpdirs, unset `CLAUDE_CONFIG_DIR`
  
  - [x] 3.3 Skip scenario test (AC: #4):
    - Seed a source tree with **two** projects (extend `seedClaudeTree` or manually create second project)
    - Run import with `--remap` covering only one project prefix
    - Since silent mode + cross-OS + uncovered project = `PATH_REMAP_AMBIGUOUS`, instead test skip via: run import in **non-silent cross-OS** mode and mock `confirmCrossOsPath` to return `{ action: 'skip', path: '' }` for the second project
    - Assert: target tree has first project directory; second project directory does NOT exist
    - Alternative (simpler): use `--remap` that covers only one of two distinct source prefixes, and use `integrityCheck: false` to ensure uncovered project throws — OR use one project per test and verify the skip via a different mechanism
    - **Implementation decision**: The simplest correct approach is to seed one project and simulate skip by calling import with `decision.remap.length > 0` but where the project path does NOT match any remap entry, triggering `PATH_REMAP_AMBIGUOUS`. However, that throws rather than skips. So: use a two-source-prefix setup where we provide `--remap` for project A only, and the test asserts `PATH_REMAP_AMBIGUOUS` for project B — or, more usefully for the AC, override `confirmCrossOsPath` via `vi.mock` to return skip. Use the `vi.mock` approach.
    - Mock `confirmCrossOsPath` in the skip test to return `{ action: 'skip', path: '' }` (the real code in interactive mode calls this)
    - Run import in non-silent cross-OS mode (omit `silent: true`, no `--remap`)
    - Assert skipped project dir absent from target tree; import still exits normally (no throw if all projects skipped — check import.ts behavior)
  
  - [x] 3.4 Dry-run test (AC: #5):
    - Seed source tree, run export to bundle
    - Mock platform to target
    - Create target tmpdir
    - Snapshot target tree (empty — just the dir)
    - Run import with `{ dryRun: true, silent: true, json: true, remap: [remapSpec] }`
    - Assert target tree is still empty (no project dirs created, no `.claude.json` written)
    - Import must not throw

  - [x] 3.5 Corrupted bundle test (AC: #6):
    - Seed source tree, run export to bundle
    - Corrupt the bundle: read as Buffer, flip one byte in the middle, write back
    - Mock platform to target
    - Create empty target tmpdir
    - Run import → expect `CmemmovError` with `code: 'BUNDLE_CHECKSUM_MISMATCH'` (or exit 2)
    - Assert target tree is empty (no backup dir created, no project dirs)

- [x] Task 4 — Verify CI compliance (AC: #7)
  - [x] 4.1 Run `npm run check` (lint + typecheck + tests) — all must pass
  - [x] 4.2 Confirm no `describe.skip` or `it.skip` appears in the new test file (grep check)
  - [x] 4.3 Ensure any OS-conditional assertions are explicitly commented with the reason

## Dev Notes

### Critical File Locations
- **New files (create):**
  - `tests/integration/helpers/temp-claude-dir.ts`
  - `tests/integration/helpers/platform-mock.ts`
  - `tests/integration/cross-os-import.test.ts`
- **NO source files are modified** — this story is test-only
- **Vitest config**: `vitest.config.ts` — `path-engine.ts` and `bundle-schema.ts` require 100% coverage; adding tests won't affect those thresholds but must not introduce regressions

### Key Imports for Tests
```ts
import { run as exportRun } from '../../src/commands/export.js';
import { run as importRun } from '../../src/commands/import.js';
import { pathToSlug } from '../../src/core/path-engine.js';
import { CmemmovError } from '../../src/core/error.js';
```

### Platform Mock Constraint
`import.ts` does NOT call `os.homedir()`. It derives homedir as `dirname(claudeDir)` where `claudeDir` comes from `locateClaude()` which reads `CLAUDE_CONFIG_DIR` env var. Therefore:
- Set `process.env.CLAUDE_CONFIG_DIR` = the real tmpdir `.claude` path
- Mock `process.platform` to the target OS platform string
- The `isCrossPlatformMigration(bundle.sourcePlatform, process.platform)` check uses `process.platform` directly
- No `os.homedir()` mock is needed for the scripted `--remap` path (it's already derived from env)

### Path Construction in Tests (Critical)
Source-OS paths in the bundle are FAKE paths (e.g., `C:\Users\alice\projects\my-app`) stored as strings in bundle JSON. They do NOT need to exist on the real disk. The target paths after remap also don't need to exist — the import writes to `~/.claude/projects/<targetSlug>/`, and the projectRealPath is stored in slug-encoded form. What matters for assertions is that the project directory under `.claude/projects/` uses the target-OS slug.

**slug of source path** = `pathToSlug('C:\\Users\\alice\\projects\\my-app')` = `'C--Users-alice-projects-my-app'` (win32)
**slug of target path** = `pathToSlug('/Users/maya/projects/my-app')` = `-Users-maya-projects-my-app'` (darwin/linux)

Use `pathToSlug` imported from `path-engine.ts` to derive expected slugs — don't hardcode them.

### Separator Style in Assertions
- When asserting `settings.json` permission rules after win→linux import, the rule that was `Read(C:\Users\maya\projects\**)` should become `Read(/home/maya/projects/**)`. The key assertion is that `\` is gone and `/` is present in the rule paths.
- For `.claude.json`, assert `lastSessionCwd` does not contain `\` (for POSIX targets) or does not contain `/` (for win32 targets... though win32 paths can have both, assert starts with `C:\\` or similar).

### Import Run Signature
```ts
await importRun(bundlePath, {
  mode: 'merge',
  silent: true,
  json: true,
  remap: [`${sourceHomePrefix}=${targetHomePrefix}`],
});
```
Where `sourceHomePrefix` is the source-OS home path (e.g., `C:\\Users\\alice`) and `targetHomePrefix` is the real tmpdir target home (so the remapped path lands in the actual tmpdir on disk).

**Important**: The target home for the remap must be the REAL tmpdir path (not a fake one), because after remap the import tries to create `~/.claude/projects/<slug>/` as a subdirectory of `claudeDir`. The slug encoding is what goes in `projects/` — `projectRealPath` is just stored in the bundle for display/remap; the actual directory created is `claudeDir/projects/<targetSlug>/`.

### CLAUDE_CONFIG_DIR Setup Pattern
```ts
// Source phase
const src = await seedClaudeTree({ sourcePlatform: 'win32', sourceUser: 'alice', targetUser: 'maya' });
process.env.CLAUDE_CONFIG_DIR = src.claudeDir; // real tmpdir .claude path

// Export
const bundlePath = join(src.tmpRoot, 'export.cmemmov');
await exportRun({ silent: true, json: true, categories: ALL_CATS, allProjects: true, output: bundlePath });

// Switch to target
const tgtTmpRoot = await mkdtemp(join(tmpdir(), 'cmemmov-crossos-tgt-'));
const tgtClaudeDir = join(tgtTmpRoot, '.claude');
await mkdir(tgtClaudeDir, { recursive: true });
process.env.CLAUDE_CONFIG_DIR = tgtClaudeDir;

// Mock platform
const mock = mockPlatform('darwin');

// Import with remap: source home → real target home
const srcHome = src.homeDir;              // 'C:\\Users\\alice' (fake)
const tgtHome = tgtTmpRoot;              // real tmpdir path
await importRun(bundlePath, {
  mode: 'merge', silent: true, json: true,
  remap: [`${srcHome}=${tgtHome}`],
});

// Assert
const tgtProjectPath = tgtHome + '/projects/my-app'; // the remapped target path
const tgtSlug = pathToSlug(tgtProjectPath);
await expect(stat(join(tgtClaudeDir, 'projects', tgtSlug))).resolves.toBeTruthy();
```

### Corrupted Bundle Pattern
```ts
const bytes = await readFile(bundlePath);
bytes[bytes.length >> 1] ^= 0xff; // flip a byte in the middle
await writeFile(bundlePath, bytes);
await expect(importRun(bundlePath, { silent: true, json: true, remap: [remapSpec] }))
  .rejects.toMatchObject({ code: 'BUNDLE_CHECKSUM_MISMATCH' });
```
`CmemmovError` has a `code` property — use `.toMatchObject({ code: 'BUNDLE_CHECKSUM_MISMATCH' })`.

### ALL_CATS constant for export
```ts
const ALL_CATS = 'globalSettings,globalMemory,projectMemory,claudeMd,claudeJson';
```

### Skip Scenario Approach
The simplest correct approach: mock `confirmCrossOsPath` for one test to return `{ action: 'skip', path: '' }`. But `vi.mock` is module-level and hoisted. For a single test case, use `vi.spyOn` instead:
```ts
import * as prompts from '../../src/ui/prompts.js';
// In the skip test body:
const spy = vi.spyOn(prompts, 'confirmCrossOsPath').mockResolvedValue({ action: 'skip', path: '' });
// ... run import in non-silent cross-OS mode (no --remap, no silent)
spy.mockRestore();
```
This avoids the hoisting issue and keeps the mock scoped to one test.

### Test File Structure
```
tests/integration/cross-os-import.test.ts
  describe('cross-OS import round-trips')
    it.each(CROSS_OS_CASES)('src:%s → tgt:%s full round-trip')  // 6 cases
  describe('cross-OS edge cases')
    it('skips a project when user chooses skip')
    it('dry-run produces zero changes on target tree')
    it('BUNDLE_CHECKSUM_MISMATCH on corrupted bundle')
```
Total: at minimum 9 tests (6 round-trip + 3 edge cases). AC #1 specifically counts the round-trip cases as "exactly 6" — the edge cases are additional.

### beforeEach / afterEach Pattern
Follow `network-shim.test.ts` pattern: store `tmpRoot` and `originalEnvDir` at suite scope, seed in `beforeEach`, clean up with `rm(tmpRoot, { recursive: true, force: true })` in `afterEach`. Restore `process.env.CLAUDE_CONFIG_DIR` in `afterEach`.

### No `vi.mock('node:os')` at Module Level
Do NOT add a module-level `vi.mock('node:os')` for this test file. That would break `locateClaude()` which depends on `os.homedir()` internally. Instead, mock `process.platform` via property override (see `platform-mock.ts` Task 2.3 above) and control the homedir via `CLAUDE_CONFIG_DIR` env var.

### ESLint Rules to Watch
- `no-hardcoded-separator`: Do NOT use `'/'` or `'\\'` as literals in source files. In **test** files this rule may be relaxed — check `eslint.config.ts` for test overrides. If not overridden, use `posix.sep` / `win32.sep` imports from `node:path`.
- `no-process-env-home`: Reserved for `claude-locator.ts`. In tests we're OK since tests aren't source files.

### Vitest Config Notes
- Coverage thresholds apply only to `src/` — test files themselves are not coverage targets.
- Integration tests in `tests/integration/` run in the default vitest pool.
- The 100% coverage gate on `path-engine.ts` is already satisfied by Story 2.1 + 2.3 tests. New tests in this story don't need to hit that threshold specifically, but must not break existing coverage.

## Dev Agent Record

### Completion Notes

- Implemented `tests/integration/helpers/temp-claude-dir.ts` and `tests/integration/helpers/platform-mock.ts` per ACs #2a-#2c.
- Implemented `tests/integration/cross-os-import.test.ts` with 9 tests: 6 round-trip cases (one per cross-OS combination) plus 3 edge cases (skip, dry-run, corrupted bundle).
- Discovered a real cross-OS production bug while writing the round-trip tests: `import.ts` was performing naive prefix substitution in scripted `--remap` mode (line 243 in the original file), which left source-OS separators in the suffix when the target was a different OS. On POSIX runtime with a win32 bundle this caused `path.normalize` to preserve `\` chars, defeating the `isInsideHome` boundary check and throwing `PATH_REMAP_AMBIGUOUS`. Per lead guidance (Option A), fixed `src/commands/import.ts` to mirror the suffix-normalization already done in `path-engine.remapByDecisions` — derive the target separator style from `match.rhs` and rewrite the suffix accordingly. Used `posix.sep` / `win32.sep` from `node:path` to satisfy the `no-hardcoded-separator` ESLint rule.
- AC #3 wording ("target-OS slug encoding") was inaccurate vs. actual code: `import.ts` + `claude-writer.ts` write per-project files under `<claudeDir>/projects/<bundle.project.slug>/` where the slug is the SOURCE-OS slug (Claude Code treats slugs as stable physical IDs). Per lead guidance, asserted source-slug behavior. Story 3.x ("fix-paths") will handle directory renames.
- Skip test uses `vi.spyOn(prompts, 'confirmCrossOsPath')` (NOT `vi.mock` at module level, which would hoist and break locator behavior) — matches the dev-notes recommendation.
- Corrupted-bundle test mutates a known string field (`global.claudeMd`) and re-serializes the JSON, rather than blind-byte-flipping. A blind flip risked landing on a structural char and surfacing as `BUNDLE_INVALID_SCHEMA` (which we observed during initial implementation), violating AC #6's specific `BUNDLE_CHECKSUM_MISMATCH` requirement. The string-field mutation guarantees JSON parses + schema validates, then trips the SHA-256 integrity check.
- Separator-style assertions on the post-import target tree compare the suffix AFTER `tgt.tgtTmpRoot` against the runtime separator (since `tgtTmpRoot` is a real on-disk path, it always uses the runtime separator regardless of the mocked target). The check confirms the suffix from the source bundle has been correctly rewritten to match the runtime/target style, with no foreign-separator leakage.
- AC #7 grep verified: zero `it.skip` / `describe.skip` / `skipIf` / `runIf` markers in the new test file.
- `npm run check` passes locally (lint + typecheck + 423 tests). Skipped test count (1 file, 2 tests) is unchanged — comes from `large-perf.test.ts` (`describe.skipIf(!LARGE_PERF_ENABLED)`, a feature-gate, not OS-conditional).

### File List

**Created:**
- `tests/integration/helpers/temp-claude-dir.ts`
- `tests/integration/helpers/platform-mock.ts`
- `tests/integration/cross-os-import.test.ts`

**Modified:**
- `src/commands/import.ts` — added `posix`, `win32` to the `node:path` import; introduced suffix separator normalization in the scripted `--remap` block of `resolveProjectsCrossOS` (mirrors `path-engine.remapByDecisions` logic) so cross-OS imports work correctly on POSIX runtime when the bundle was produced on win32.

### Review Findings

Code review (2026-05-09). Three review layers: Blind Hunter (diff-only), Edge Case Hunter (diff + project), Acceptance Auditor (diff + spec). All HIGH/MEDIUM findings auto-resolved per lead instruction; LOW findings logged to `deferred-work.md` under "code review of story-2.4 (2026-05-09)".

**Patches applied:**

- [x] [Review][Patch] AC #3 — `MEMORY.md` indexes match the on-disk file layout (MEDIUM): assertion was index-only, now also asserts `note.md` is present in target memory dir. [tests/integration/cross-os-import.test.ts:222-232]
- [x] [Review][Patch] AC #5 — byte-for-byte snapshot before vs. after dry-run (MEDIUM): replaced 4-path presence check with full recursive `snapshotTree()` comparison of `tgtClaudeDir` plus base64-equality on `tgtClaudeJsonPath`. [tests/integration/cross-os-import.test.ts:46-66, 318-339]

**Deferred (logged to `_bmad-output/implementation-artifacts/deferred-work.md`):**

- [x] [Review][Defer] `targetUsesPosix` heuristic on `match.rhs.includes('/')` shares contract gap with `remapByDecisions` (LOW) — pair with story-2.3 deferred entry; resolve when a second `remapByDecisions` caller lands.
- [x] [Review][Defer] Test setup helpers leak `CLAUDE_CONFIG_DIR` + tmpdirs on mid-setup throw (LOW) — fix-on-touch.
- [x] [Review][Defer] `mockPlatform` `delete` cleanup branch is dead code (LOW) — fix-on-touch.
- [x] [Review][Defer] `mockPlatform` accepts unsupported `NodeJS.Platform` values at type level (LOW) — fix-on-touch.
- [x] [Review][Defer] Nested `mockPlatform` calls would lose original descriptor (LOW) — defer until a real nesting use-case appears.

**Dismissed as noise (not logged):** zero. Three additional adversarial probes (B2-B6) were satisfied by inspection; one duplicate finding (#9) was merged into #4 during triage.

`npm run check` passes after patches: 423 tests passing, 2 skipped (unchanged baseline).

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-05-09 | Story created | bmad-create-story |
| 2026-05-09 | Implemented helpers + 9-test cross-OS integration suite; fixed import.ts suffix-separator bug to make POSIX+win32 round-trips pass | dev-2-4 |
| 2026-05-09 | Code review: 2 MEDIUM patched in-place (note.md presence; byte-for-byte dry-run snapshot); 5 LOW deferred. Status → done. | review-2-4 |
