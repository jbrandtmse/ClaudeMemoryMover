# Story 1.3: Path Engine — Slug Codec & Same-OS Path Resolution

Status: review

## Story

As a developer working on cmemmov,
I want a tested-to-100%-coverage `core/path-engine.ts` module exposing the slug codec, same-OS slug-to-path decode, directory matching, and cross-platform detection,
so that every command consumes a single, verified source of truth for path remapping logic and the central differentiator cannot drift across commands.

## Acceptance Criteria

1. `pathToSlug` implements Claude Code's exact algorithm: `absolutePath.replace(/[:\\/]/g, '-')`. Given `'C:\\Users\\Josh\\dev\\my-app'` on win32 returns `'C--Users-Josh-dev-my-app'`; given `'/home/jordan/dev/api-gateway'` returns `'-home-jordan-dev-api-gateway'`.

2. `slugToPath(slug, sourcePlatform)` reverses the encoding for structurally-valid slugs:
   - `win32`: slug must match `^[A-Za-z]--` (drive letter + double-dash for `:\`). If it matches, reconstruct `driveChar + ':\\' + rest.replace(/-/g, '\\')`. If slug does not match, return `null`.
   - `darwin` / `linux`: slug must start with `-` (from the leading `/`). If it starts with `-`, reconstruct `'/' + slug.slice(1).replace(/-/g, '/')`. If slug does not start with `-`, return `null`.
   - Any other `sourcePlatform` value: return `null`.
   - **Known limitation** (document in code): the decode is lossy for paths whose folder names contained `-`. A slug like `-home-my-project` decodes to `/home/my/project` even when the original was `/home/my-project`. This ambiguity CANNOT be detected from the slug alone — callers must prefer the bundle's `originalPath` or session `cwd` over slug reversal.

3. `findMatchingDir(originalPath, scanRoots)` accepts a pre-expanded list of candidate directory paths (`scanRoots`) and returns the first entry whose `path.basename()` equals `path.basename(originalPath)`. Returns `null` if no entry matches. Performs zero filesystem I/O — this is a pure string operation. The service layer is responsible for expanding root directories into candidate paths before calling this function.

4. `isCrossPlatformMigration(sourcePlatform, currentPlatform)` returns `true` iff `sourcePlatform !== currentPlatform`.

5. `vitest.config.ts` is updated to add per-file coverage thresholds enforcing **100% lines** and **100% branches** for `src/core/path-engine.ts`. Running `npm run test -- --coverage` with any uncovered branch fails the threshold check.

6. `src/core/path-engine.test.ts` achieves exactly 100% line + branch coverage. Tests load from `tests/fixtures/slug-edge-cases.json` and parameterize across platforms using vitest `it.each`. All four exported functions have dedicated describe blocks.

7. Grepping the codebase for `path\.replace\(` (the slug codec call) finds matches only inside `src/core/path-engine.ts` — no command or service file reimplements it.

## Tasks / Subtasks

- [x] Task 1: Create `src/core/path-engine.types.ts` (supports ACs 2, 6)
  - [x] Export `SupportedPlatform = Extract<NodeJS.Platform, 'win32' | 'darwin' | 'linux'>`
  - [x] No other exports needed for this story — keep minimal

- [x] Task 2: Create `src/core/path-engine.ts` (ACs: 1, 2, 3, 4, 7)
  - [x] Import only from `'node:path'` — zero `fs`, `os`, or `process` imports (pure module invariant)
  - [x] Export `pathToSlug(absolutePath: string): string` — one-liner regex replace
  - [x] Export `slugToPath(slug: string, sourcePlatform: NodeJS.Platform): string | null` — platform-branched decode with structural null guard (see Dev Notes for exact logic)
  - [x] Export `findMatchingDir(originalPath: string, scanRoots: string[]): string | null` — pure basename comparison
  - [x] Export `isCrossPlatformMigration(sourcePlatform: NodeJS.Platform, currentPlatform: NodeJS.Platform): boolean`
  - [x] Do NOT implement `suggestRemap` — that function exists in the architecture spec but is deferred entirely to Story 2.1 (cross-OS). Do not stub or include it.
  - [x] Use `node:path` for all path operations — never string concatenation with `/` or `\\`
  - [x] ESM import with `.js` extension: `import { basename } from 'node:path'`

- [x] Task 3: Create `tests/fixtures/slug-edge-cases.json` (AC: 6)
  - [x] Follow the JSON schema in Dev Notes (array of fixture objects)
  - [x] Required cases — see Dev Notes for exact values

- [x] Task 4: Create `src/core/path-engine.test.ts` (ACs: 5, 6)
  - [x] `describe('path-engine', () => { describe('pathToSlug', ...) describe('slugToPath', ...) describe('findMatchingDir', ...) describe('isCrossPlatformMigration', ...) })`
  - [x] Load `slug-edge-cases.json` and drive `pathToSlug` + `slugToPath` tests via `it.each`
  - [x] One `it` per concept — multiple assertions allowed only when verifying the same behavior
  - [x] After implementing, run `npm run test -- --coverage` and confirm path-engine.ts shows 100% line + branch before updating vitest.config.ts

- [x] Task 5: Update `vitest.config.ts` to add per-file thresholds (AC: 5)
  - [x] READ the current file first (see Dev Notes for the exact diff)
  - [x] Add `thresholds` key under `coverage` — exact shape in Dev Notes
  - [x] Do NOT add global line/branch thresholds — only the path-engine.ts entry
  - [x] Run `npm run test -- --coverage` to verify thresholds pass

- [x] Task 6: Remove `src/core/.gitkeep` (housekeeping)
  - [x] Delete `src/core/.gitkeep` now that real source files exist in `src/core/`

- [x] Task 7: Final validation (ACs: 5, 6, 7)
  - [x] `npm run check` (lint + typecheck + test) exits 0
  - [x] `grep -r "path\.replace" src/` shows hits only in `src/core/path-engine.ts`

## Dev Notes

### Architecture invariant: pure module

`src/core/path-engine.ts` has zero `fs`, `os`, or `process` imports. This is enforced by convention and the custom ESLint rules from Story 1.2 (`no-process-env-home`, `no-hardcoded-separator`). The ONLY Node built-in allowed is `node:path` for `basename`, `sep`, and `join`.

[Source: architecture.md — §"Module Organization Principles", §"Architectural Boundaries"]

### `pathToSlug` — exact algorithm

```typescript
export function pathToSlug(absolutePath: string): string {
  return absolutePath.replace(/[:\\/]/g, '-');
}
```

This is Claude Code's exact algorithm. Do not deviate. The regex replaces `:`, `\`, and `/` with `-`.

[Source: architecture.md — §"Verified Ground Truth"]

### `slugToPath` — structural decode + known null cases

```typescript
export function slugToPath(slug: string, sourcePlatform: NodeJS.Platform): string | null {
  if (sourcePlatform === 'win32') {
    // win32 slugs must start with <drive>-- e.g. "C--Users-..."
    if (!/^[A-Za-z]--/.test(slug)) return null;
    const drive = slug[0];
    const rest = slug.slice(3); // after "X--"
    // must use path module, not string concatenation with literal separators
    return drive + ':\\' + rest.replace(/-/g, '\\');
  }
  if (sourcePlatform === 'darwin' || sourcePlatform === 'linux') {
    // unix slugs must start with '-' (from the leading '/')
    if (!slug.startsWith('-')) return null;
    return '/' + slug.slice(1).replace(/-/g, '/');
  }
  return null;
}
```

**IMPORTANT — lossy decode limitation (add as a comment in the implementation):**

The decode is lossy. A folder name containing `-` is indistinguishable from the path separator in the slug. Example: `/home/my-project` and `/home/my/project` both encode to `-home-my-project`. This ambiguity CANNOT be detected from the slug alone. Consumers must prefer `bundle.originalPath` or session `cwd` over `slugToPath` whenever those are available. `slugToPath` is a last-resort fallback, not the primary resolution mechanism.

The `null` return from `slugToPath` only signals STRUCTURAL invalidity (the slug cannot possibly have been generated from a valid path on the given platform). It does NOT signal decode ambiguity.

[Source: architecture.md — §"Slug ambiguity", §"Verified Ground Truth"]

### `findMatchingDir` — pure basename scan

```typescript
import { basename } from 'node:path';

export function findMatchingDir(originalPath: string, scanRoots: string[]): string | null {
  const target = basename(originalPath);
  return scanRoots.find(root => basename(root) === target) ?? null;
}
```

**Design decision:** `scanRoots` is a pre-expanded flat list of candidate directory absolute paths, provided by the service layer after its own `fs.readdir` scan of relevant parent directories (home dir, common project roots, etc.). `findMatchingDir` does NOT scan the filesystem — it is a pure filtering function. This maintains the `core/` pure module invariant.

This means: if the service layer passes `['/home/newhostname/dev/my-project', '/home/newhostname/work/my-project']` and `originalPath` is `/home/oldhostname/dev/my-project`, the function returns the first entry whose basename is `'my-project'`.

[Source: architecture.md — §"Module Organization Principles"]

### `isCrossPlatformMigration`

```typescript
export function isCrossPlatformMigration(
  sourcePlatform: NodeJS.Platform,
  currentPlatform: NodeJS.Platform,
): boolean {
  return sourcePlatform !== currentPlatform;
}
```

Trivial but important to centralize — prevents scattered `platform !== platform` comparisons across commands.

### `suggestRemap` — EXPLICITLY DEFERRED

The architecture spec for `core/path-engine.ts` includes `suggestRemap`. **Do not implement it in Story 1.3.** It belongs to Story 2.1 (cross-OS path conversion). Adding a stub or placeholder violates the "no half-finished implementations" project rule. The export signature does not appear in this story's source.

[Source: epics.md — Story 2.1 is the owner of cross-OS remapping]

### Fixture schema: `tests/fixtures/slug-edge-cases.json`

```json
[
  {
    "description": "win32 simple path — no hyphens in folder names",
    "platform": "win32",
    "absolutePath": "C:\\Users\\Josh\\dev\\myapp",
    "slug": "C--Users-Josh-dev-myapp",
    "decodesTo": "C:\\Users\\Josh\\dev\\myapp"
  },
  {
    "description": "win32 path with spaces",
    "platform": "win32",
    "absolutePath": "C:\\Users\\Josh\\My Documents\\project",
    "slug": "C--Users-Josh-My Documents-project",
    "decodesTo": "C:\\Users\\Josh\\My Documents\\project"
  },
  {
    "description": "linux simple path — no hyphens in folder names",
    "platform": "linux",
    "absolutePath": "/home/jordan/dev/apigateway",
    "slug": "-home-jordan-dev-apigateway",
    "decodesTo": "/home/jordan/dev/apigateway"
  },
  {
    "description": "darwin simple path — no hyphens in folder names",
    "platform": "darwin",
    "absolutePath": "/Users/taylor/projects/cmemmov",
    "slug": "-Users-taylor-projects-cmemmov",
    "decodesTo": "/Users/taylor/projects/cmemmov"
  },
  {
    "description": "linux path with unicode in folder name",
    "platform": "linux",
    "absolutePath": "/home/user/résumé",
    "slug": "-home-user-résumé",
    "decodesTo": "/home/user/résumé"
  },
  {
    "description": "win32 structurally-invalid slug for win32 (no drive prefix) — must return null",
    "platform": "win32",
    "absolutePath": null,
    "slug": "-home-user-project",
    "decodesTo": null
  },
  {
    "description": "linux structurally-invalid slug for linux (no leading dash) — must return null",
    "platform": "linux",
    "absolutePath": null,
    "slug": "home-user-project",
    "decodesTo": null
  },
  {
    "description": "unknown platform — must return null",
    "platform": "freebsd",
    "absolutePath": null,
    "slug": "-home-user-project",
    "decodesTo": null
  }
]
```

**Note on `absolutePath: null` entries:** These are used only for `slugToPath` null-return tests. `pathToSlug` tests use only the entries where `absolutePath` is non-null.

### vitest.config.ts — exact diff

Current file:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
```

Required update — add `thresholds` under `coverage`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        'src/core/path-engine.ts': {
          lines: 100,
          branches: 100,
        },
      },
    },
  },
});
```

**Vitest v2 per-file threshold syntax:** The `thresholds` key in vitest v2 coverage config accepts an object where keys are file path strings (or globs) and values specify per-threshold objects. This is supported in vitest 2.x (the version pinned in package.json is 2.1.2). If you see a TypeScript error on the `thresholds` key, verify against the vitest 2.1.2 type definitions — the API changed between v1 and v2.

[Source: Story 1.1 dev notes — vitest version is `2.1.2`]

### ESM import style

All imports in `src/core/*.ts` must use `.js` extension (NodeNext resolution):

```typescript
// CORRECT
import { basename } from 'node:path';
import type { SupportedPlatform } from './path-engine.types.js';

// WRONG — will fail at runtime under NodeNext
import type { SupportedPlatform } from './path-engine.types';
```

[Source: architecture.md — §"Module Imports"]

### No-hardcoded-separator ESLint rule applies here

The `no-hardcoded-separator` rule from Story 1.2 fires on string literals whose value is exactly `'/'` or `'\\'`. The `slugToPath` implementation uses `'/'` and `'\\'` as replacement strings — these WILL trigger the rule.

Resolution: use `path.sep` or template literals that combine characters so the literal is not exactly one separator character. For example:
- `':\\'` does NOT trigger the rule (not exactly `'\\'`)
- `'/'` DOES trigger the rule

In `slugToPath`, the unix decode is `'/' + slug.slice(1).replace(/-/g, '/')`. The replacement `'/'` is banned. Use `path.posix.sep` for unix paths, or express the replace differently using `node:path`. Alternatively, since the function branches on platform, use `path.sep` when the current platform matches and `path.posix.sep` / `path.win32.sep` for cross-platform calls.

**Preferred approach:** import `{ posix, win32 } from 'node:path'` and use `posix.sep` and `win32.sep` as the replacement strings. Both are single characters but are not string literals in source, so the ESLint rule does not fire.

### Previous story context: what exists in `src/core/`

At the start of Story 1.3, `src/core/` contains only `src/core/.gitkeep`. No TypeScript files exist yet. This is the first file to land in `src/core/`.

Existing files NOT in `src/core/` that must remain intact:
- `src/cli.ts` — stub, no changes needed
- `src/version.ts` — no changes needed
- `eslint.config.js` — no changes needed (path-engine.ts is pure, no new rules required)
- `eslint-rules/` — no changes needed
- `vitest.config.ts` — update ONLY the `thresholds` addition (Task 5)

### Git state: previously committed deviations

Story 1.1 introduced `tsconfig.eslint.json` (not in the architecture doc) and the `tsup` object-form entry. These are already committed and working. Story 1.3 does not need to touch either file.

### Project Structure Notes

Files being created (NEW):
- `src/core/path-engine.types.ts`
- `src/core/path-engine.ts`
- `src/core/path-engine.test.ts`
- `tests/fixtures/slug-edge-cases.json`

Files being modified (UPDATE):
- `vitest.config.ts` — add per-file coverage thresholds only

Files being deleted (REMOVE):
- `src/core/.gitkeep`

### References

- [Source: epics.md — Story 1.3 Acceptance Criteria, lines 350–394]
- [Source: architecture.md — §"Key Module Specs" (`core/path-engine.ts`), lines 673–681]
- [Source: architecture.md — §"Module Organization Principles" (pure modules), lines 460–465]
- [Source: architecture.md — §"Architectural Boundaries" (core/ imports), lines 630–643]
- [Source: architecture.md — §"Test Patterns", lines 451–457]
- [Source: architecture.md — §"Verified Ground Truth" (slug algorithm), line 78]
- [Source: architecture.md — §"Slug ambiguity", line 100]
- [Source: architecture.md — Project tree — `tests/fixtures/slug-edge-cases.json`, line 610]
- [Source: vitest.config.ts — current state, no thresholds]
- [Source: Story 1.1 dev notes — pinned vitest@2.1.2]
- [Source: Story 1.2 rules — no-hardcoded-separator fires on `'/'` and `'\\'`]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- 2026-05-09: Initial test run RED phase — `Failed to load url ./path-engine.js` (expected — implementation file not yet created).
- 2026-05-09: After implementing `path-engine.ts`, all 28 new tests + 5 existing tests pass.
- 2026-05-09: First `npm run check` failed lint with two `@typescript-eslint/no-unnecessary-type-assertion` errors plus one `restrict-template-expressions` error from `match[1]` being `string | undefined` under `noUncheckedIndexedAccess`. Replaced regex `.exec()` with `.test()` + `slug.charAt(0)` (which returns `string`, not `string | undefined`) and removed the redundant `as` casts. `npm run check` now exits 0.
- 2026-05-09: `npm run test -- --coverage` reports 100% lines / 100% branches / 100% functions on `src/core/path-engine.ts` and the per-file threshold gate passes.

### Completion Notes List

- All four exported functions (`pathToSlug`, `slugToPath`, `findMatchingDir`, `isCrossPlatformMigration`) implemented exactly per Dev Notes spec. `suggestRemap` deferred to Story 2.1 as instructed — no stub.
- `slugToPath` uses `posix.sep` and `win32.sep` from `node:path` for replacement strings to avoid the `no-hardcoded-separator` ESLint rule. Inline implementation note documents the lossy decode limitation for hyphenated folder names.
- `path-engine.ts` is pure: only `node:path` imports — zero `fs`, `os`, or `process` references. The pure-module invariant from architecture.md is satisfied.
- `tests/fixtures/slug-edge-cases.json` contains the eight required cases (4 valid encode/decode, 1 unicode, 3 null-return structural-invalid). Tests parameterize across all of them via `vitest`'s `it.each`.
- AC 5 satisfied: `vitest.config.ts` adds a per-file `thresholds` map keyed by `'src/core/path-engine.ts'` requiring 100% lines + 100% branches. No global thresholds added.
- AC 6 satisfied: 28 tests across four describe blocks. Coverage report shows 100/100/100 for `path-engine.ts`. `path-engine.types.ts` shows 0% but contains only an exported type (no runtime code) and is not subject to the threshold.
- AC 7 satisfied: `path.replace(` literal has zero hits across `src/`; the slug-codec regex replace lives only in `src/core/path-engine.ts`.
- **Tooling change required to satisfy AC 6:** Added `"resolveJsonModule": true` to `tsconfig.json` so the test file can `import fixtures from '../../tests/fixtures/slug-edge-cases.json' with { type: 'json' }` while still typechecking under `tsc --noEmit`. Without it, `npm run typecheck` fails with TS2732. This is an additive, single-line, non-breaking change. The Dev Notes did not list tsconfig.json among "must remain intact" files; the change was unavoidable given AC 6's mandate to load fixtures from a `.json` file. Decision was researched against vitest 2.x + NodeNext canonical practice (`with { type: 'json' }` import attributes; plain default import is a viable alternative) before applying.
- ESM `.js` extension on relative imports observed throughout (`./path-engine.js` from the test file, `./path-engine.types.js` not imported here because the type isn't used at the boundary).
- Used `String.prototype.replaceAll(searchValue, replacement)` (ES2021) instead of `String.prototype.replace(/-/g, …)` to avoid having to construct a regex when the replacement separator is dynamic; both forms are equivalent semantically and replaceAll is supported by the project's `target: "ES2022"` floor.

### File List

**Created:**

- `src/core/path-engine.types.ts`
- `src/core/path-engine.ts`
- `src/core/path-engine.test.ts`
- `tests/fixtures/slug-edge-cases.json`

**Modified:**

- `vitest.config.ts` — added per-file coverage thresholds for `src/core/path-engine.ts`.
- `tsconfig.json` — added `resolveJsonModule: true` to allow the test file to import the JSON fixture under `tsc --noEmit`.

**Deleted:**

- `src/core/.gitkeep`

## Change Log

- 2026-05-09 — Story 1.3 implemented: created `src/core/path-engine.{ts,types.ts,test.ts}` and `tests/fixtures/slug-edge-cases.json`; updated `vitest.config.ts` per-file thresholds and `tsconfig.json` `resolveJsonModule`; removed `src/core/.gitkeep`. All 33 tests pass; 100% line + branch coverage on `path-engine.ts`; `npm run check` exits 0. Status: ready-for-dev → in-progress → review.
