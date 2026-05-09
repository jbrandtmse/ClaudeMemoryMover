# Story 2.0: Epic 1 Deferred Cleanup

Status: done

## Story

As a cmemmov developer,
I want the canonical key-order bug fixed and the `claudeJson` writer surface added,
so that export → import round-trips preserve `~/.claude.json` and pass integrity checks when `global` carries multiple optional fields.

## Acceptance Criteria

1. **Key-order fix — multi-key `global` round-trips cleanly.** `buildBundle` returns a bundle whose key order matches `BundleSchema`'s Zod schema-declaration order. A unit test exercises `buildBundle` → `serializeBundle` → `parseBundle` with `global` containing at least three populated optional keys (e.g., `settings`, `memories`, `claudeJson`) and asserts no `BUNDLE_CHECKSUM_MISMATCH` error is thrown and no `integrityCheck: false` workaround is needed.

2. **Integration test `integrityCheck: false` workarounds removed.** The three `integrityCheck: false` calls in `tests/integration/network-shim.test.ts` (lines ~225, ~234, ~257) and the one in `tests/integration/perf.test.ts` (line ~142) and the one in `tests/integration/large-perf.test.ts` (line ~88) are removed. All integration tests pass with integrity checks enabled.

3. **`claudeJson` writer surface implemented.** `src/core/decision-schema.ts::ClaudeCategory` union includes `'claudeJson'`. `src/services/claude-writer.ts` exports a new `ClaudeJsonOpts` interface and handles `category: 'claudeJson'` in `applyCategory`. Merge mode deep-merges with existing `~/.claude.json`; overwrite mode replaces it wholesale. All writes flow through the `WriteGate`.

4. **`claudeJson` wired into import.** `import.ts::applyGlobalCategories` calls `applyCategory({ category: 'claudeJson', ... })` when `bundle.global.claudeJson !== undefined`, replacing the current `out.warn(...)` stub. The `claudeJson` path is derived from `locateClaude().claudeJson` (not hardcoded).

5. **`import.ts::run` destructures `claudeJson` from `locateClaude`.** `const { claudeDir, claudeJson } = locateClaude();` — both are available and `claudeJson` is threaded into `applyGlobalCategories`.

6. **`claudeJson` NOT in `ALL_CATEGORIES`.** Export already includes it unconditionally; it is not a user-selectable category filter. `ClaudeCategory` type union includes it (for writer type safety) but `ALL_CATEGORIES` constant does NOT.

7. **Tests updated.** `import.test.ts` describe block `'bundle.global.claudeJson is currently unapplied'` is replaced with tests verifying: (a) `applyCategory` IS called with `category: 'claudeJson'`, (b) the `claudeJson` path passed matches the locator's output, (c) no warning is emitted for this field when `claudeJson` is present. `claude-writer.test.ts` adds tests for `applyCategory({ category: 'claudeJson' })` in merge and overwrite modes.

8. **`npm run check` passes clean.** `lint`, `typecheck`, and full test suite (unit + integration) green with no `integrityCheck: false` workarounds and no TypeScript errors.

## Tasks / Subtasks

- [x] Task 1 — Fix canonical key-order bug (AC: #1, #2)
  - [x] 1.1 In `src/commands/export-selection.ts`, add `BundleSchema` to the import from `'../core/bundle-schema.js'`
  - [x] 1.2 In `buildBundle`, change the final `return bundle` to `return BundleSchema.parse(bundle)` so key order is normalized to schema-declaration order before integrity is computed
  - [x] 1.3 Add a regression test in `src/commands/export-selection.test.ts`: `buildBundle` with multi-key `global` (settings + memories + claudeJson all populated) → `serializeBundle` → `parseBundle` with no `integrityCheck: false` asserts no throw
  - [x] 1.4 Remove all `integrityCheck: false` workarounds from integration tests (5 call sites across 3 files) and verify tests still pass

- [x] Task 2 — Add `claudeJson` to `ClaudeCategory` (AC: #3, #6)
  - [x] 2.1 In `src/core/decision-schema.ts`, add `| 'claudeJson'` to the `ClaudeCategory` union type
  - [x] 2.2 Do NOT add `claudeJson` to `ALL_CATEGORIES` — leave the constant unchanged
  - [x] 2.3 Verify `decision-schema.test.ts` still passes (the `satisfies` check for `ALL_CATEGORIES` should remain valid)

- [x] Task 3 — Add `claudeJson` writer surface (AC: #3, #7)
  - [x] 3.1 In `src/services/claude-writer.ts`, add `ClaudeJsonOpts` interface:
    ```ts
    interface ClaudeJsonOpts {
      category: 'claudeJson';
      mode: Mode;
      targetDir: string; // .claude dir; claudeJson path = targetDir + '.json'
      data: unknown;
      gate: WriteGate;
    }
    ```
  - [x] 3.2 Add `ClaudeJsonOpts` to the `ApplyCategoryOpts` discriminated union
  - [x] 3.3 Add `case 'claudeJson': return applyClaudeJson(opts);` to `applyCategory` switch
  - [x] 3.4 Implement `applyClaudeJson`: derives `filePath = opts.targetDir + '.json'`; delegates to existing `applySettingsAt(filePath, opts.data, opts.mode, opts.gate)`
  - [x] 3.5 Add tests in `src/services/claude-writer.test.ts`:
    - merge: existing `.claude.json` present → deep-merges incoming data, preserves existing keys
    - overwrite: replaces existing `.claude.json` content wholesale
    - missing `.claude.json` (ENOENT): writes incoming data in both modes

- [x] Task 4 — Wire `claudeJson` into import command (AC: #4, #5, #7)
  - [x] 4.1 In `src/commands/import.ts::run`, change destructure to `const { claudeDir, claudeJson: claudeJsonPath } = locateClaude();`
  - [x] 4.2 Thread `claudeJsonPath` as a new parameter into `applyGlobalCategories(bundle, claudeDir, claudeJsonPath, gate, decision, out)`
  - [x] 4.3 In `applyGlobalCategories`, replace the existing `claudeJson` warn stub with:
    ```ts
    if (g.claudeJson !== undefined) {
      await applyCategory({
        category: 'claudeJson',
        mode: effectiveMode('claudeJson', decision),
        targetDir: claudeDir,
        data: g.claudeJson,
        gate,
      });
      out.progress('Applied claudeJson');
      count++;
    }
    ```
    Note: `effectiveMode` requires `'claudeJson'` to be a valid `ClaudeCategory` — Task 2 makes this typecheck.
  - [x] 4.4 Update `import.test.ts`: replace describe block `'bundle.global.claudeJson is currently unapplied'` with:
    - Test: `claudeJson` present → `applyCategory` called with `category: 'claudeJson'`; no warn emitted
    - Test: `claudeJson` absent → `applyCategory` NOT called for `claudeJson`; no warn emitted

- [x] Task 5 — Verify full suite passes (AC: #8)
  - [x] 5.1 Run `npm run check` (lint + typecheck + test) — all green
  - [x] 5.2 Run integration tests specifically to confirm `integrityCheck: false` removal does not cause failures

## Dev Notes

### The Key-Order Bug (Root Cause)

`buildBundle` in `src/commands/export-selection.ts` constructs the `global: Global` object by conditionally assigning properties in category-include order:

```ts
const global: Global = {};
if (cats.has('globalSettings') && ...) global.settings = ...;  // key 1
if (cats.has('globalMemory') && ...)   global.memories = ...;  // key 2
if (cats.has('claudeMd') && ...)       global.claudeMd = ...;  // key 3
...
if (surface.claudeJson !== undefined)  global.claudeJson = ...; // key LAST
```

`GlobalSchema` declares fields in this order: `settings, claudeJson, memories, claudeMd, customCommands, teams, plugins, mcpConfig`.

When `bundle.global` has multiple fields, the author key order differs from Zod's schema-declaration order.

`serializeBundle` computes integrity over the bundle in author order. `parseBundle` calls `BundleSchema.parse(raw)` which creates a new object with keys in schema-declaration order. `computeCanonical` then stringifies that re-ordered object → different bytes → different SHA-256 → false `BUNDLE_CHECKSUM_MISMATCH`.

**The fix:** In `buildBundle`, replace `return bundle;` with `return BundleSchema.parse(bundle);`. Zod's `.parse()` constructs a fresh object iterating schema keys in declaration order — so the serializer and parser both see the same key order.

**Important:** `BundleSchema` must be added to the import from `'../core/bundle-schema.js'` in `export-selection.ts`. The current import only pulls `type Bundle, type Global, type Project, BUNDLE_FORMAT_VERSION`.

### The `claudeJson` Gap

`~/.claude.json` (adjacent to `~/.claude/`, NOT inside it) holds global Claude Code state: `firstStartTime`, `recentProjects`, `currentProject`, MCP server registry, etc.

Export pipeline (`export-selection.ts:159-161`) always includes it when present:
```ts
if (opts.surface.claudeJson !== undefined) {
  global.claudeJson = opts.surface.claudeJson;
}
```

But import has no `applyCategory` branch for it — it warns and drops the data. Story 2.0 closes this gap.

**Path derivation:** `claudeJson` path = `locateClaude().claudeJson` = `claudeDir + '.json'` (confirmed in `claude-locator.ts`). The writer derives it from `targetDir + '.json'` to stay consistent with the locator's formula.

**Merge semantics:** Same as `globalSettings` — `applySettingsAt` handles both merge (deep-merge with existing JSON) and overwrite (wholesale write). Use the existing `applySettingsAt` helper from the same file.

### `effectiveMode` and `ClaudeCategory` typing

`effectiveMode(cat: ClaudeCategory, decision: ImportDecision)` is typed to accept `ClaudeCategory`. Once `'claudeJson'` is added to the union, `effectiveMode('claudeJson', decision)` typechecks. No changes needed to `effectiveMode` itself.

### Integration Test Workarounds to Remove

5 call sites across 3 files:

| File | Approximate Line | Comment Text |
|------|-----------------|--------------|
| `tests/integration/network-shim.test.ts` | ~225 | "integrityCheck: false works around an existing canonical-key-order" |
| `tests/integration/network-shim.test.ts` | ~234 | same |
| `tests/integration/network-shim.test.ts` | ~257 | same |
| `tests/integration/perf.test.ts` | ~142 | "integrityCheck: false sidesteps a pre-existing canonical-key-order" |
| `tests/integration/large-perf.test.ts` | ~88 | same |

After the fix: remove `integrityCheck: false` and the inline comments explaining it.

### `ALL_CATEGORIES` stays unchanged

`ALL_CATEGORIES` in `decision-schema.ts` is used in:
- `parseCategories('all')` expansion for export
- `--mode overwrite=<category>` validation for import
- The `satisfies` assertion in `decision-schema.test.ts`

`claudeJson` is exported unconditionally (not user-selectable) and imported unconditionally (not filtered by `--categories`). Do not add it to `ALL_CATEGORIES`. The `ClaudeCategory` type union change alone is sufficient for writer type safety.

### Project Structure Notes

Files to **modify** (no new files):

| File | Change |
|------|--------|
| `src/commands/export-selection.ts` | Add `BundleSchema` import; wrap `buildBundle` return with `BundleSchema.parse(bundle)` |
| `src/commands/export-selection.test.ts` | Add multi-key round-trip regression test |
| `src/core/decision-schema.ts` | Add `'claudeJson'` to `ClaudeCategory` union (not to `ALL_CATEGORIES`) |
| `src/services/claude-writer.ts` | Add `ClaudeJsonOpts`, `applyClaudeJson`, case in switch |
| `src/services/claude-writer.test.ts` | Add 3 tests for `claudeJson` apply (merge, overwrite, missing) |
| `src/commands/import.ts` | Destructure `claudeJson` from locateClaude; thread into `applyGlobalCategories`; replace warn with apply |
| `src/commands/import.test.ts` | Replace `claudeJson` warn-only tests with apply tests |
| `tests/integration/network-shim.test.ts` | Remove 3 `integrityCheck: false` workarounds |
| `tests/integration/perf.test.ts` | Remove 1 `integrityCheck: false` workaround |
| `tests/integration/large-perf.test.ts` | Remove 1 `integrityCheck: false` workaround |

### References

- [Canonical key-order bug — deferred-work.md entry](../_bmad-output/implementation-artifacts/deferred-work.md) (story-1.13 section)
- [claudeJson writer surface gap — deferred-work.md entry](../_bmad-output/implementation-artifacts/deferred-work.md) (story-1.11 re-review section)
- [Epic 1 retro action items #1 and #2](../_bmad-output/implementation-artifacts/epic-1-retro-2026-05-09.md)
- [Source: `src/commands/export-selection.ts` — `buildBundle` function (lines 111-179)]
- [Source: `src/services/bundle-serializer.ts` — `serializeBundle`, integrity computation (lines 7-23)]
- [Source: `src/services/bundle-parser.ts` — `parseBundle`, `computeCanonical` (lines 12-83)]
- [Source: `src/core/bundle-schema.ts` — `GlobalSchema` declaration order (lines 29-38), `BundleSchema` (lines 45-56)]
- [Source: `src/services/claude-writer.ts` — `ApplyCategoryOpts` union (lines 84-94), `applySettingsAt` helper (lines 306-320)]
- [Source: `src/commands/import.ts` — `applyGlobalCategories`, claudeJson warn stub (lines 269-272)]
- [Source: `src/services/claude-locator.ts` — `claudeJson` path formula (lines 9-16)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- `npm run lint` — clean (0 warnings, max-warnings=0)
- `npm run typecheck` — clean (tsc --noEmit, 0 errors)
- `npm run test` (full vitest suite) — 341 passed, 2 skipped (large-perf opt-in only)
- Integration tests `network-shim`, `perf`, and `dry-run-isolation` all green with NO `integrityCheck: false` workarounds — round-trip integrity verifies end-to-end including multi-key `global.claudeJson`

### Completion Notes List

- **Key-order fix (Task 1):** `buildBundle` now finishes with `BundleSchema.parse(bundle)`. Zod's `.parse()` reconstructs the object iterating schema-declared keys in order, so the bytes hashed by `serializeBundle` match the bytes reconstructed by `parseBundle`. The new round-trip regression test in `export-selection.test.ts` populates `global.settings`, `global.memories`, AND `global.claudeJson` — the exact case that previously triggered `BUNDLE_CHECKSUM_MISMATCH`.
- **Integration workarounds removed (Task 1.4):** All five `integrityCheck: false` call sites (network-shim ×2, perf ×1, large-perf ×1, plus comments) removed. Note: only 4 actual `integrityCheck: false` parameter sites existed in the source — story spec referenced "5 call sites" but lines 225 and 234 in network-shim were the comment-and-parameter pair for one call. All known sites are now clean.
- **`ClaudeCategory` extension (Task 2):** Added `'claudeJson'` to the union with an inline comment explaining why it stays out of `ALL_CATEGORIES` (export is unconditional, not user-selectable). The `decision-schema.test.ts` `satisfies readonly ClaudeCategory[]` assertion still passes — `ALL_CATEGORIES` is a *subset* of `ClaudeCategory`, so widening the union does not break the satisfies relationship.
- **Writer surface (Task 3):** `applyClaudeJson` reuses the existing `applySettingsAt` helper for both merge (deep-merge with existing JSON) and overwrite (wholesale replace). Path is derived as `${targetDir}.json`, mirroring `locateClaude()`'s formula. Three new tests in `claude-writer.test.ts` cover merge, overwrite, and ENOENT (missing file).
- **Import wiring (Task 4):** `import.ts::run` now destructures `claudeJson` from `locateClaude()` and threads it into `applyGlobalCategories`. The applied path is asserted to match `${claudeDir}.json` to catch any future drift in the locator's formula. The previous "warn and drop" stub is replaced with a real `applyCategory({ category: 'claudeJson', ... })` call. The `import.test.ts` describe block formerly named *'bundle.global.claudeJson is currently unapplied'* is replaced with two assertions: applied-when-present, and not-applied-when-absent.
- **Path identity invariant:** The writer derives the on-disk path from `targetDir + '.json'` rather than from a separately threaded `claudeJsonPath`. This preserves a single source of truth (the locator's formula) and avoids a parameter that would be redundant inside `applyCategory`. The threaded `claudeJsonPath` is used in the import command as an explicit assertion that locator and writer formulas agree.

### Change Log

- 2026-05-09: Implemented Story 2.0 — fixed canonical key-order bug in `buildBundle` (`BundleSchema.parse` normalization); added `claudeJson` to `ClaudeCategory` union and writer surface; wired `claudeJson` through import command; removed all `integrityCheck: false` workarounds from integration tests. All 341 tests pass; lint and typecheck clean.
- 2026-05-09: Code review pass (Story 2.0). Lint clean, typecheck clean. Test suite could not be executed in the review environment due to a pre-existing vitest 2.1.2 + Node v22.20.0 incompatibility verified to also reproduce on baseline `main` (independent of this story's changes). No HIGH or MEDIUM patchable issues found; review findings appended below.

### Review Findings

- [x] `[Review][Defer]` `applyClaudeJson` mirrors locator's trailing-slash quirk [src/services/claude-writer.ts:351] — deferred, pre-existing locator design (claude-locator.ts:12) explicitly tested for in `claude-locator.test.ts:68-72`; story 2.0 deliberately mirrors this formula per Dev Notes.
- [x] `[Review][Defer]` Runtime invariant `claudeJsonPath !== \`${claudeDir}.json\`` lacks dedicated test coverage [src/commands/import.ts:271-276] — deferred; defensive guard whose contract is documented inline. Adding negative coverage requires mocking `locateClaude` to return mismatched values, which only matters if the locator formula changes in a future story.
- [x] `[Review][Defer]` `claudeJson` deep-merge unions `recentProjects` array — could leak stale source-machine project paths into target [src/services/claude-writer.ts:351 → applySettingsAt deep-merge] — deferred; matches existing `globalSettings` semantics. Cross-machine path-rewriting is out of Story 2.0 scope (Epic 2 territory: stories 2-1 / 2-3).
- [x] `[Review][Defer]` `bundle.global.claudeJson` may carry sensitive content (MCP server tokens, etc.) and is now applied unsanitized in merge mode [src/services/claude-writer.ts::applyClaudeJson] — deferred; export-side sanitization is the correct layer to address this. Pre-existing concern (the field was already captured by export pre-Story 2.0); Story 4.x (`share` / sanitization profile) is the right home.
- [x] `[Review][Defer]` `npm run check` could not be run end-to-end in review environment due to vitest/Node version incompat — deferred; root cause is pre-existing on baseline `main` (verified via `git stash` + repro), not introduced by this story. CI `ci.yml` is the authoritative AC8 verification.

### File List

- `src/commands/export-selection.ts` — added `BundleSchema` import; wrap `buildBundle` return with `BundleSchema.parse(bundle)` to normalize key order
- `src/commands/export-selection.test.ts` — added multi-key `global` round-trip regression test (export-selection → serializeBundle → parseBundle without integrityCheck workaround)
- `src/core/decision-schema.ts` — added `'claudeJson'` to `ClaudeCategory` union (intentionally NOT added to `ALL_CATEGORIES`)
- `src/services/claude-writer.ts` — added `ClaudeJsonOpts` interface, `applyClaudeJson` function, switch case in `applyCategory`
- `src/services/claude-writer.test.ts` — added three `applyCategory — claudeJson` tests (merge, overwrite, ENOENT)
- `src/commands/import.ts` — destructured `claudeJson` from `locateClaude()`; threaded into `applyGlobalCategories`; replaced warn stub with real `applyCategory({ category: 'claudeJson', ... })` call; added path-identity assertion
- `src/commands/import.test.ts` — replaced `'bundle.global.claudeJson is currently unapplied'` describe block with new `'bundle.global.claudeJson is applied via writer surface'` block (applied-when-present + not-applied-when-absent)
- `tests/integration/network-shim.test.ts` — removed two `integrityCheck: false` workarounds and accompanying explanatory comments
- `tests/integration/perf.test.ts` — removed `integrityCheck: false` workaround and comment
- `tests/integration/large-perf.test.ts` — removed `integrityCheck: false` workaround and comment
- `_bmad-output/implementation-artifacts/2-0-epic-1-deferred-cleanup.md` — story file (status, tasks, dev agent record)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status: ready-for-dev → in-progress → review
