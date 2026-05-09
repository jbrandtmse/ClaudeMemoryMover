# Story 2.1: Path Engine — Cross-OS Conversion & Auto-Suggest

Status: done

## Story

As a cmemmov developer,
I want `core/path-engine.ts` extended with `suggestRemap` (translates absolute paths from a source platform to a target platform's home-directory-rooted equivalent),
so that the cross-OS path-translation intelligence lives in one 100%-covered module that every cross-OS scenario consumes — no command reimplements platform-prefix heuristics.

## Acceptance Criteria

1. **`slugToPath` works from any current platform.** `slugToPath('C--Users-Josh-dev-app', 'win32')` returns `'C:\\Users\\Josh\\dev\\app'` regardless of which OS the test runs on. `slugToPath('-home-jordan-dev-api', 'linux')` returns `'/home/jordan/dev/api'` regardless of runtime OS. Tests explicitly verify this by exercising foreign-platform slugs.

2. **`suggestRemap` implemented and exported.** Signature: `export function suggestRemap(originalPath: string, targetPlatform: NodeJS.Platform, targetHomedir: string): string | null`. Returns the remapped absolute path on success; returns `null` when `originalPath` has no recognizable home-directory prefix (signaling the caller must prompt the user for manual entry).

3. **`suggestRemap` handles all six source→target cross-OS combinations:**
   - `suggestRemap('C:\\Users\\Josh\\dev\\app', 'darwin', '/Users/josh')` → `/Users/josh/dev/app`
   - `suggestRemap('/Users/maya/agents/foo', 'win32', 'C:\\Users\\maya')` → `'C:\\Users\\maya\\agents\\foo'`
   - `suggestRemap('/home/jordan/dev/api', 'darwin', '/Users/jordan')` → `/Users/jordan/dev/api`
   - `suggestRemap('/home/jordan/dev/api', 'win32', 'C:\\Users\\jordan')` → `'C:\\Users\\jordan\\dev\\api'`
   - `suggestRemap('/Users/maya/agents/foo', 'linux', '/home/maya')` → `/home/maya/agents/foo`
   - `suggestRemap('C:\\Users\\Josh\\dev\\app', 'linux', '/home/josh')` → `/home/josh/dev/app`

4. **`suggestRemap` returns `null` for non-home paths.** `suggestRemap('D:\\scratch\\old-project', anyTarget, anyHome)` returns `null`. A Windows path that starts with `<drive>:\` but does NOT have `\Users\<username>\` after the drive returns `null`.

5. **UNC path slug encoding.** `pathToSlug('\\\\server\\share\\folder')` (the string `\\server\share\folder`) returns `'--server-share-folder'` per Claude Code's algorithm. A test explicitly asserts this.

6. **Unicode and spaces preserved.** `pathToSlug` does not mangle unicode characters or spaces — only `:`, `/`, `\` are replaced. A round-trip test verifies `pathToSlug('/home/user/résumé')` → slug → `slugToPath(slug, 'linux')` gives back `/home/user/résumé`; similarly for win32 paths with spaces.

7. **Cross-OS `suggestRemap` fixtures.** A new fixture file `tests/fixtures/cross-os-remap-cases.json` exists alongside `slug-edge-cases.json`, parameterizing all 6 cross-OS combinations (and null-return cases). Tests use `it.each` against this fixture.

8. **100% line + branch coverage on the extended `core/path-engine.ts`.** `npm run check` (which includes `npm run coverage:run` or `npm run test -- --coverage`) shows 100% lines and 100% branches on `path-engine.ts`. No new branches are left uncovered.

## Tasks / Subtasks

- [x] Task 1 — Implement `suggestRemap` in `src/core/path-engine.ts` (AC: #2, #3, #4)
  - [x] 1.1 Add the function below the existing `isCrossPlatformMigration` export:
    ```ts
    export function suggestRemap(
      originalPath: string,
      targetPlatform: NodeJS.Platform,
      targetHomedir: string,
    ): string | null {
      let relative: string | null = null;

      // Windows home: <drive>:\Users\<username>\<rest>
      const winMatch = /^[A-Za-z]:\\Users\\[^\\]+\\(.+)$/i.exec(originalPath);
      if (winMatch?.[1] !== undefined) relative = winMatch[1];

      // macOS home: /Users/<username>/<rest>
      if (relative === null) {
        const macMatch = /^\/Users\/[^/]+\/(.+)$/.exec(originalPath);
        if (macMatch?.[1] !== undefined) relative = macMatch[1];
      }

      // Linux home: /home/<username>/<rest>
      if (relative === null) {
        const linuxMatch = /^\/home\/[^/]+\/(.+)$/.exec(originalPath);
        if (linuxMatch?.[1] !== undefined) relative = linuxMatch[1];
      }

      if (relative === null) return null;

      if (targetPlatform === 'win32') {
        const norm = relative.replaceAll('/', win32.sep);
        return `${targetHomedir}${win32.sep}${norm}`;
      }
      const norm = relative.replaceAll('\\', posix.sep);
      return `${targetHomedir}${posix.sep}${norm}`;
    }
    ```
  - [x] 1.2 Verify `posix` and `win32` are already imported at the top (`import { posix, win32 } from 'node:path';`) — they are, no change needed

- [x] Task 2 — Create cross-OS remap fixture file (AC: #7)
  - [x] 2.1 Create `tests/fixtures/cross-os-remap-cases.json` with entries for all 6 platform combinations plus null-return cases:
    ```json
    [
      {
        "description": "win→mac: Windows Users path to macOS home",
        "originalPath": "C:\\Users\\Josh\\dev\\app",
        "targetPlatform": "darwin",
        "targetHomedir": "/Users/josh",
        "expected": "/Users/josh/dev/app"
      },
      {
        "description": "win→linux: Windows Users path to Linux home",
        "originalPath": "C:\\Users\\Josh\\dev\\app",
        "targetPlatform": "linux",
        "targetHomedir": "/home/josh",
        "expected": "/home/josh/dev/app"
      },
      {
        "description": "mac→win: macOS Users path to Windows home",
        "originalPath": "/Users/maya/agents/foo",
        "targetPlatform": "win32",
        "targetHomedir": "C:\\Users\\maya",
        "expected": "C:\\Users\\maya\\agents\\foo"
      },
      {
        "description": "mac→linux: macOS Users path to Linux home",
        "originalPath": "/Users/maya/agents/foo",
        "targetPlatform": "linux",
        "targetHomedir": "/home/maya",
        "expected": "/home/maya/agents/foo"
      },
      {
        "description": "linux→mac: Linux home path to macOS home",
        "originalPath": "/home/jordan/dev/api",
        "targetPlatform": "darwin",
        "targetHomedir": "/Users/jordan",
        "expected": "/Users/jordan/dev/api"
      },
      {
        "description": "linux→win: Linux home path to Windows home",
        "originalPath": "/home/jordan/dev/api",
        "targetPlatform": "win32",
        "targetHomedir": "C:\\Users\\jordan",
        "expected": "C:\\Users\\jordan\\dev\\api"
      },
      {
        "description": "null: Windows non-home path (D: drive, no Users prefix)",
        "originalPath": "D:\\scratch\\old-project",
        "targetPlatform": "darwin",
        "targetHomedir": "/Users/josh",
        "expected": null
      },
      {
        "description": "null: Windows C: drive but no Users segment",
        "originalPath": "C:\\workspace\\project",
        "targetPlatform": "linux",
        "targetHomedir": "/home/josh",
        "expected": null
      },
      {
        "description": "null: UNC path has no home prefix",
        "originalPath": "\\\\server\\share\\folder",
        "targetPlatform": "darwin",
        "targetHomedir": "/Users/josh",
        "expected": null
      }
    ]
    ```

- [x] Task 3 — Add tests to `src/core/path-engine.test.ts` (AC: #1, #5, #6, #7, #8)
  - [x] 3.1 Import `suggestRemap` alongside existing imports; import the new fixture file
  - [x] 3.2 Add tests for `suggestRemap` using `it.each(remapFixtures)` over `cross-os-remap-cases.json`
  - [x] 3.3 Add explicit cross-platform `slugToPath` tests verifying foreign-platform decoding works from any runtime (these test ACs 1-2 for cross-OS):
    - `slugToPath('C--Users-Josh-dev-app', 'win32')` → `'C:\\Users\\Josh\\dev\\app'`
    - `slugToPath('-home-jordan-dev-api', 'linux')` → `'/home/jordan/dev/api'`
    - `slugToPath('-Users-maya-agents-foo', 'darwin')` → `'/Users/maya/agents/foo'`
  - [x] 3.4 Add UNC path slug test (AC #5): `expect(pathToSlug('\\\\server\\share\\folder')).toBe('--server-share-folder')`
  - [x] 3.5 Add unicode preservation test (AC #6):
    - `pathToSlug('/home/user/résumé')` round-trips through `slugToPath(slug, 'linux')` back to `/home/user/résumé`
    - `pathToSlug('C:\\Users\\Josh\\My Documents\\project')` exists in existing fixtures — verify round-trip
  - [x] 3.6 Verify all branches of `suggestRemap` are covered: win match, mac match, linux match, null return (no match), and both target platform branches (win32 vs posix)

- [x] Task 4 — Update sprint-status.yaml (AC: n/a — bookkeeping)
  - [x] 4.1 Set `2-1-path-engine-cross-os-conversion-auto-suggest: ready-for-dev` in sprint-status.yaml (done by create-story workflow)

- [x] Task 5 — Verify `npm run check` passes with 100% coverage on path-engine (AC: #8)
  - [x] 5.1 Run `npm run check` (lint + typecheck + tests)
  - [x] 5.2 Confirm `path-engine.ts` line coverage = 100%, branch coverage = 100%

## Dev Notes

### Current State of `path-engine.ts`

The file already exports:
- `pathToSlug(absolutePath: string): string` — replaces `[:\\/]` with `-` (all platforms, platform-agnostic)
- `slugToPath(slug: string, sourcePlatform: NodeJS.Platform): string | null` — decodes to platform-native path using `win32.sep`/`posix.sep` from `node:path` (already platform-agnostic since `path.win32.sep === '\\'` and `path.posix.sep === '/'` always, regardless of runtime OS)
- `findMatchingDir(originalPath: string, scanRoots: string[]): string | null` — basename matching across mixed separators
- `isCrossPlatformMigration(sourcePlatform, currentPlatform): boolean` — simple inequality check

The imports at the top are already `import { posix, win32 } from 'node:path';` — Story 2.1 adds NO new imports.

**`slugToPath` is already cross-OS correct.** The implementation uses `win32.sep` (always `\\`) and `posix.sep` (always `/`) from Node.js's platform-agnostic `path.win32` and `path.posix` objects. There is NO runtime platform check inside `slugToPath` — it decodes based solely on the `sourcePlatform` argument. The existing tests happen to run on the current OS, but the function already handles all platforms from any runtime. Story 2.1 adds explicit tests to document this property.

### Architecture Note on Return Type

The architecture spec at line 678 shows `suggestRemap(...): string` (non-nullable). However, Story 2.1's AC #4 requires `null` return for non-home paths. The epics are the authoritative spec for acceptance criteria. Return `string | null` — the callers in Story 2.2 must check for null and prompt the user for manual entry when null is received.

### `suggestRemap` — What It Detects

The function identifies three home-directory prefix patterns by structure alone (no runtime OS involved):

| Pattern | Regex | Example |
|---------|-------|---------|
| Windows Users home | `/^[A-Za-z]:\\Users\\[^\\]+\\(.+)$/i` | `C:\Users\Josh\dev\app` → capture `dev\app` |
| macOS Users home | `/^\/Users\/[^/]+\/(.+)$/` | `/Users/maya/agents/foo` → capture `agents/foo` |
| Linux home | `/^\/home\/[^/]+\/(.+)$/` | `/home/jordan/dev/api` → capture `dev/api` |

Paths that don't match any pattern → return `null`. This covers: `D:\scratch\...` (non-Users drive), `C:\workspace\...` (no Users segment), `\\server\share\...` (UNC), `/etc/...` (non-home POSIX root), `/tmp/...`, etc.

### Separator Normalization in `suggestRemap`

The captured `relative` portion uses the source path's separators. When targeting win32, any `/` in `relative` is converted to `win32.sep` (`\\`). When targeting POSIX (darwin/linux), any `\` is converted to `posix.sep` (`/`).

This correctly handles the cross-OS case where `relative` comes from a Windows source but targets macOS:
- Source: `C:\Users\Josh\dev\app` → relative = `dev\app` (backslash)
- Target darwin: `dev\app`.replaceAll(`\`, `/`) = `dev/app`
- Final: `/Users/josh/dev/app`

And the reverse:
- Source: `/Users/maya/agents/foo` → relative = `agents/foo` (forward slash)
- Target win32: `agents/foo`.replaceAll(`/`, `\\`) = `agents\\foo`
- Final: `C:\Users\maya\agents\foo`

### UNC Path Already Handled

`pathToSlug` regex is `/[:\\/]/g` — matches `:`, `\`, `/`. The UNC path `\\server\share\folder` contains `\`, `\`, `\`, `\` which all become `-`. Result: `--server-share-folder`. No code changes needed; only a test to document the behavior.

### Coverage Requirements

The `suggestRemap` function has these branches that MUST be covered:
1. Win32 regex matches (relative set from winMatch) → win32 target
2. Win32 regex matches (relative set from winMatch) → POSIX target
3. Mac regex matches (winMatch fails, macMatch succeeds) → win32 target
4. Mac regex matches → POSIX target
5. Linux regex matches (winMatch and macMatch fail, linuxMatch succeeds) → win32 target
6. Linux regex matches → POSIX target
7. No match (relative remains null) → return null

The fixture file must cover all 7 branches. The 6 cross-OS combinations + null cases in the fixture achieve this if arranged correctly. Additionally ensure the null case covers both "no win match AND no mac match AND no linux match".

### Existing Test File Imports

`src/core/path-engine.test.ts` currently imports:
```ts
import { pathToSlug, slugToPath, findMatchingDir, isCrossPlatformMigration } from './path-engine.js';
import fixtures from '../../tests/fixtures/slug-edge-cases.json' with { type: 'json' };
```

Story 2.1 additions:
```ts
import { pathToSlug, slugToPath, findMatchingDir, isCrossPlatformMigration, suggestRemap } from './path-engine.js';
import remapFixtures from '../../tests/fixtures/cross-os-remap-cases.json' with { type: 'json' };
```

### Architecture Invariants (Must Not Violate)

- `path-engine.ts` is in `core/` — it must remain **pure**: no `fs`, no `os`, no `process` imports. The `posix` and `win32` objects from `node:path` are pure math, not I/O.
- All platform branching for path operations belongs here, NOT in command modules. Story 2.2 imports `suggestRemap`; it does not reimplement prefix detection.
- 100% line + branch coverage is a hard CI gate on this file (see `vitest.config.ts` per-file thresholds).

### Project Structure Notes

Files to **modify** (1 file) and **create** (1 fixture file):

| File | Change |
|------|--------|
| `src/core/path-engine.ts` | Add `suggestRemap` export (pure function, no new imports) |
| `src/core/path-engine.test.ts` | Add `suggestRemap` import, fixture import, `suggestRemap` describe block, cross-OS `slugToPath` tests, UNC test, unicode tests |
| `tests/fixtures/cross-os-remap-cases.json` | New fixture file — 9 entries (6 combos + 3 null cases) |

No changes to sprint-status.yaml are needed beyond what create-story already does (sets `ready-for-dev`).

### References

- [Source: `src/core/path-engine.ts` — current implementation (lines 1-54)]
- [Source: `src/core/path-engine.test.ts` — existing test patterns (lines 1-142)]
- [Source: `tests/fixtures/slug-edge-cases.json` — fixture format to follow]
- [Source: `_bmad-output/planning-artifacts/epics.md` — Story 2.1 ACs (lines 891-938)]
- [Architecture: `core/path-engine.ts` spec — line 673-680]
- [Architecture: "100% line + branch coverage on the path engine" — line 362]
- [Architecture: "platform branching belongs in `path-engine` only" — line 492]
- [Story 2.0 learnings: `BundleSchema.parse(bundle)` key-order fix pattern — demonstrates the existing test `makeBundle()` uses `BundleSchema.parse()` for normalization]
- [Deferred from story-1.3: `SupportedPlatform` type export vs `NodeJS.Platform` parameter — resolved in `suggestRemap` by accepting `NodeJS.Platform` (same as `slugToPath`) with null guard for unsupported platforms]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- 2026-05-09: Initial RED-state run of `npm test -- src/core/path-engine.test.ts` — confirmed 11 expected failures (`TypeError: suggestRemap is not a function`) before implementing the export. Cross-OS `slugToPath`, UNC, and unicode tests passed in RED state, validating the existing `slugToPath` already works cross-OS as documented in Dev Notes.
- 2026-05-09: Initial implementation used literal `'/'` and `'\'` strings in `replaceAll(...)` per the snippet in Task 1.1; tripped the project's local `cmemmov/no-hardcoded-separator` ESLint rule (2 errors). Replaced literals with `posix.sep` / `win32.sep` (semantically identical — `path.posix.sep === '/'`, `path.win32.sep === '\\'` always). Lint then green.
- 2026-05-09: Final `npm run check` — lint + typecheck + 358 tests pass (2 skipped). `npm run coverage:run` — `src/core/path-engine.ts` reports 100% lines / 100% branches / 100% funcs / 100% statements.

### Completion Notes List

- Implemented `suggestRemap(originalPath, targetPlatform, targetHomedir): string | null` in `src/core/path-engine.ts` per AC #2/#3/#4. The function is pure: zero I/O, zero new imports — uses only the already-imported `posix` and `win32` from `node:path`.
- Three regex prefix detectors are tried in order (Windows `<drive>:\Users\<user>\…`, macOS `/Users/<user>/…`, Linux `/home/<user>/…`); first match wins. Non-home paths (e.g. `D:\scratch\…`, `C:\workspace\…`, `\\server\share\…`, `/etc/…`, `/tmp/…`) all return `null`.
- Separator normalization: when target is `win32`, `/` in the captured `relative` is rewritten to `win32.sep`; for POSIX targets (darwin/linux), `\` becomes `posix.sep`. Used `posix.sep`/`win32.sep` on both sides of `replaceAll` to satisfy the project's `cmemmov/no-hardcoded-separator` ESLint rule.
- Architecture spec at `architecture.md:678` shows non-nullable return; AC #4 in epics requires `string | null`. Followed the epic ACs as authoritative (per Dev Notes "Architecture Note on Return Type"). Story 2.2 callers will null-check and prompt for manual entry.
- Added 9-entry fixture `tests/fixtures/cross-os-remap-cases.json` covering all 6 cross-OS combinations + 3 null-return cases (D: drive, C: drive without Users segment, UNC path). Fixture exercises every branch of `suggestRemap`.
- Added explicit cross-OS `slugToPath` tests (foreign win32 / linux / darwin slugs decoded from any runtime) — these document AC #1's claim that the existing `slugToPath` is already platform-agnostic. They passed in RED state too, confirming no implementation changes were needed for `slugToPath`.
- Added UNC slug test (AC #5) — `pathToSlug('\\\\server\\share\\folder')` → `'--server-share-folder'` — and unicode/space round-trip tests (AC #6) for `/home/user/résumé` and `C:\Users\Josh\My Documents\project`.
- Added a case-insensitive Windows drive-letter test (`c:\Users\Josh\dev\app` → `/Users/josh/dev/app`) to lock in the `/i` flag on the Windows regex.
- Coverage gate: `vitest.config.ts` per-file thresholds (`'src/core/path-engine.ts': { lines: 100, branches: 100 }`) pass — confirmed via `npm run coverage:run`.
- Validated architecture invariants: `path-engine.ts` remains pure (no `fs`/`os`/`process` imports); platform branching for path operations stays in `core/` (no command-side reimplementation).
- Sprint-status.yaml updated: 2-1 moved `ready-for-dev → in-progress → review` on 2026-05-09.

### File List

- `src/core/path-engine.ts` — added `suggestRemap` export (38 new lines below `isCrossPlatformMigration`); no new imports
- `src/core/path-engine.test.ts` — added `suggestRemap` import, `RemapFixture` interface, `remapCases` fixture binding, `suggestRemap` describe block (12 cases via `it.each` + 2 explicit assertions), 3 cross-OS `slugToPath` tests, UNC `pathToSlug` test, unicode round-trip tests for linux and win32
- `tests/fixtures/cross-os-remap-cases.json` — new fixture file, 9 entries covering all 6 cross-OS combinations and 3 null-return cases
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — bookkeeping: 2-1 status `ready-for-dev → in-progress → review`
- `_bmad-output/implementation-artifacts/2-1-path-engine-cross-os-conversion-auto-suggest.md` — story file: tasks checked, Dev Agent Record populated, Status `ready-for-dev → in-progress → review`

### Review Findings

- [x] **Review / Patch** — Architecture spec drift: `suggestRemap` return type (`_bmad-output/planning-artifacts/architecture.md:678`) — applied 2026-05-09: changed declared signature from `: string` to `: string | null` to match AC #4 + actual implementation.
- [x] **Review / Defer** — `suggestRemap` does not validate path-traversal sequences in `originalPath` (`src/core/path-engine.ts:56-87`) — deferred to Story 2.2 (first caller); see deferred-work.md.
- [x] **Review / Defer** — `suggestRemap` preserves trailing separators from inputs (`src/core/path-engine.ts:81-86`) — deferred to Story 2.2 call-site normalization; see deferred-work.md.

## Change Log

- 2026-05-09 — Implemented `suggestRemap` in `src/core/path-engine.ts` (3 home-prefix patterns, separator normalization, returns `null` for non-home paths). Added `tests/fixtures/cross-os-remap-cases.json` and extended `src/core/path-engine.test.ts` with `suggestRemap` describe block, cross-OS `slugToPath` tests, UNC slug test, and unicode/space round-trip tests. All ACs satisfied; `npm run check` passes; `path-engine.ts` coverage 100% lines / 100% branches.
- 2026-05-09 — Code review (cr-2-1): 1 MEDIUM patched in-place (architecture.md return-type drift), 2 deferred (path-traversal validation + trailing-separator handling, both punted to Story 2.2 caller). All ACs remain satisfied; no `src/` changes required by review. Story status: `review → done`.
