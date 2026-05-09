# Story 2.2: Cross-OS Detection & Guided Per-Project Remap UI

Status: review

## Story

As a Claude Code user (Maya),
I want `cmemmov import` to detect when the bundle's source OS differs from my current OS, walk me through each project's remapping with an auto-suggestion I can accept, override, or skip — and to support a `--remap` flag for scripted runs,
so that cross-OS migration becomes a 2-minute guided conversation instead of a manual JSON edit, and skipped projects flow into the same post-import summary I already know from same-OS runs.

## Acceptance Criteria

1. **Cross-OS announcement on stderr.** When a bundle with `sourcePlatform !== process.platform` is imported, stderr emits exactly: `"Export source: {sourcePlatform}. Current platform: {currentPlatform}. Path remapping required."` before any project processing begins.

2. **Interactive remap with auto-suggestion.** When `suggestRemap` returns a candidate path, the project prompt shows it as the default with options [Y]es accept / [O]verride with custom path / [S]kip. Pressing Enter (accepting default) counts as `'auto-confirmed'` outcome.

3. **Interactive remap with no suggestion.** When both `suggestRemap` and `findMatchingDir` return `null`, the original source path is shown and the user is prompted to type a target path or select [S]kip. (Tab-completion is offered if the `@clack/prompts` `text` widget supports it automatically.)

4. **`--remap` scripted mode.** `cmemmov import bundle.cmemmov --silent --remap "C:\\Users\\maya\\agents=/Users/maya/agents" --remap "C:\\dev=/Users/maya/dev"` remaps every project whose `originalPath` starts with a matching LHS prefix by substituting the RHS. Any project without a matching rule throws `CmemmovError({ code: 'PATH_REMAP_AMBIGUOUS', hint: '--remap rule needed for <originalPath>' })` (exit 2).

5. **Skipped projects flow to same summary.** Projects skipped during cross-OS remap appear in the post-import summary with the "run `cmemmov fix-paths` to associate when ready" message — identical to same-OS skip behavior.

6. **Same-OS import is unaffected.** When `bundle.sourcePlatform === process.platform`, the cross-OS branch is NOT triggered; Story 1.11's `resolveProjects` flow applies unchanged.

7. **`RemapDecisions` struct.** Cross-OS remap outcomes are captured in `RemapDecisions` (array of `RemapDecision`) and passed forward for Story 2.3's path rewriting in `settings.json` and `.claude.json`. No command reimplements prefix-substitution logic.

8. **Summary counts by outcome.** On exit 0, the summary states how many projects were auto-confirmed / user-confirmed / overridden / skipped.

9. **`--json` compatibility.** In `--json` mode, progress lines (including "remapping path X → Y") go to stderr; the final JSON object on stdout includes a `summary.remappings` array containing each `RemapDecision`.

10. **Security: path-traversal guard.** After `suggestRemap` or `--remap` substitution, the resolved path must be normalized (via `path.normalize`) and must not escape the target home directory. If it does, the project is treated as unresolvable (show manual-entry prompt or, in `--remap` mode, exit 2 with `PATH_REMAP_AMBIGUOUS`).

## Tasks / Subtasks

- [x] Task 1 — Add `RemapDecision`/`RemapDecisions` types and update `ImportDecision` (AC: #7, #8, #9)
  - [x] 1.1 In `src/core/decision-schema.ts`, add after the existing type exports:
    ```ts
    export type RemapOutcome = 'auto-confirmed' | 'user-confirmed' | 'overridden' | 'skipped';

    export interface RemapDecision {
      slug: string;
      originalPath: string;
      targetPath: string | null; // null when skipped
      outcome: RemapOutcome;
    }

    export type RemapDecisions = RemapDecision[];
    ```
  - [x] 1.2 Add `remap: { lhs: string; rhs: string }[]` field to `ImportDecision` interface (default empty array when same-OS)

- [x] Task 2 — Wire `--remap` CLI flag (AC: #4)
  - [x] 2.1 In `src/cli.ts`, add to `ImportCLIOpts`:
    ```ts
    interface ImportCLIOpts extends GlobalCLIOpts {
      mode?: string;
      integrityCheck?: boolean;
      remap?: string[];
    }
    ```
  - [x] 2.2 Add a `parseRemap` coerce function (accumulates into `string[]`) and register the flag on the import command:
    ```ts
    function parseRemap(val: string, prev: string[]): string[] {
      return [...prev, val];
    }
    // inside importCmd builder:
    .option('--remap <spec>', 'remap prefix for cross-OS import: "source-prefix=target-prefix" (repeatable)', parseRemap, [] as string[])
    ```
  - [x] 2.3 In `src/commands/import.ts`, add `remap?: string[]` to `ImportOpts` and parse it in `buildDecision`:
    ```ts
    remap: (opts.remap ?? []).map((spec) => {
      const eqIdx = spec.indexOf('=');
      if (eqIdx < 1) throw new CmemmovError({ code: 'INTERNAL', hint: `Invalid --remap format: ${spec}. Use "source-prefix=target-prefix"` });
      return { lhs: spec.slice(0, eqIdx), rhs: spec.slice(eqIdx + 1) };
    }),
    ```

- [x] Task 3 — Add `confirmCrossOsPath` prompt (AC: #2, #3)
  - [x] 3.1 In `src/ui/prompts.ts`, add an exported interface and function:
    ```ts
    export interface CrossOsPathResult {
      action: 'accept' | 'override' | 'skip';
      path: string; // the resolved path, or originalPath when skipped
    }

    export async function confirmCrossOsPath(opts: {
      slug: string;
      originalPath: string;
      suggestion: string | null;
      silent: boolean;
    }): Promise<CrossOsPathResult> {
      if (opts.silent) {
        // Silent mode without --remap rules should not reach here;
        // resolveProjectsCrossOS errors before calling this in silent mode.
        return { action: 'skip', path: opts.originalPath };
      }

      type Action = 'accept' | 'override' | 'skip';
      const options: { value: Action; label: string; hint?: string }[] = [];
      if (opts.suggestion !== null) {
        options.push({ value: 'accept', label: `Use ${opts.suggestion}`, hint: 'auto-suggested remap' });
      }
      options.push({ value: 'override', label: 'Enter custom path', hint: 'type a new path' });
      options.push({ value: 'skip', label: 'Skip', hint: 'associate later with fix-paths' });

      const action = await select<Action>({
        message: `Remap "${opts.slug}" (was ${opts.originalPath}):`,
        options,
      });
      bailOnCancel<Action>(action);

      if (action === 'skip') return { action: 'skip', path: opts.originalPath };
      if (action === 'accept' && opts.suggestion !== null) {
        return { action: 'accept', path: opts.suggestion };
      }

      const customPath = await text({
        message: `Enter target path for ${opts.slug}:`,
        placeholder: opts.suggestion ?? opts.originalPath,
        validate: (v) => (v === undefined || v.trim().length === 0 ? 'Path cannot be empty' : undefined),
      });
      bailOnCancel<string>(customPath);
      return { action: 'override', path: customPath.trim() };
    }
    ```

- [x] Task 4 — Implement `resolveProjectsCrossOS` and wire cross-OS branch in `import.ts` (AC: #1, #4, #5, #6, #7, #8, #9, #10)
  - [x] 4.1 Add imports at top of `import.ts`:
    ```ts
    import { normalize, dirname } from 'node:path';
    import { isCrossPlatformMigration, suggestRemap } from '../core/path-engine.js';
    import { confirmCrossOsPath } from '../ui/prompts.js';
    import type { RemapDecision, RemapDecisions } from '../core/decision-schema.js';
    ```
    Note: `dirname` is already imported; just add `normalize`. Check existing imports to avoid duplicates.
  - [x] 4.2 Implement `resolveProjectsCrossOS`:
    ```ts
    async function resolveProjectsCrossOS(
      bundleProjects: { slug: string; originalPath: string }[],
      claudeDir: string,
      decision: ImportDecision,
      out: Output,
    ): Promise<{ remapDecisions: RemapDecisions; skippedSlugs: string[] }> {
      const targetPlatform = process.platform as NodeJS.Platform;
      const homedir = dirname(claudeDir);
      const remapDecisions: RemapDecisions = [];
      const skippedSlugs: string[] = [];

      for (const project of bundleProjects) {
        // Scripted --remap mode
        if (decision.remap.length > 0) {
          const match = decision.remap.find(({ lhs }) => project.originalPath.startsWith(lhs));
          if (match === undefined) {
            throw new CmemmovError({
              code: 'PATH_REMAP_AMBIGUOUS',
              hint: `--remap rule needed for ${project.originalPath}`,
            });
          }
          const raw = match.rhs + project.originalPath.slice(match.lhs.length);
          const targetPath = normalize(raw);
          if (!targetPath.startsWith(homedir)) {
            throw new CmemmovError({
              code: 'PATH_REMAP_AMBIGUOUS',
              hint: `Remapped path '${targetPath}' escapes target home directory`,
            });
          }
          out.progress(`✓ ${project.slug} → ${targetPath}`);
          remapDecisions.push({ slug: project.slug, originalPath: project.originalPath, targetPath, outcome: 'auto-confirmed' });
          continue;
        }

        // Interactive mode: try suggestRemap, then findMatchingDir as fallback
        const suggestion = suggestRemap(project.originalPath, targetPlatform, homedir)
          ?? await gatherSuggestion(project.originalPath, claudeDir);

        const result = await confirmCrossOsPath({
          slug: project.slug,
          originalPath: project.originalPath,
          suggestion,
          silent: decision.silent,
        });

        if (result.action === 'skip') {
          out.progress(`⊘ skipped ${project.slug}`);
          skippedSlugs.push(project.slug);
          remapDecisions.push({ slug: project.slug, originalPath: project.originalPath, targetPath: null, outcome: 'skipped' });
          continue;
        }

        const targetPath = normalize(result.path);
        if (!targetPath.startsWith(homedir)) {
          // Treat traversal-escaped path as unresolvable; surface error to user
          out.warn(`Path '${result.path}' escapes target home — treating as skip`);
          skippedSlugs.push(project.slug);
          remapDecisions.push({ slug: project.slug, originalPath: project.originalPath, targetPath: null, outcome: 'skipped' });
          continue;
        }

        const outcome: RemapDecision['outcome'] =
          result.action === 'accept' ? 'auto-confirmed' : 'overridden';
        out.progress(`✓ ${project.slug} → ${targetPath}`);
        remapDecisions.push({ slug: project.slug, originalPath: project.originalPath, targetPath, outcome });
      }

      return { remapDecisions, skippedSlugs };
    }
    ```
  - [x] 4.3 In `run()`, immediately after `parseBundle` succeeds, add the cross-OS branch decision:
    ```ts
    const isCrossOS = isCrossPlatformMigration(
      bundle.sourcePlatform as NodeJS.Platform,
      process.platform as NodeJS.Platform,
    );
    if (isCrossOS) {
      out.progress(`Export source: ${bundle.sourcePlatform}. Current platform: ${process.platform}. Path remapping required.`);
    }
    ```
  - [x] 4.4 Replace the existing `resolveProjects` call with a branch:
    ```ts
    let resolved: ResolvedProject[];
    let skippedSlugs: string[];
    let remapDecisions: RemapDecisions = [];

    if (isCrossOS) {
      const crossOsResult = await resolveProjectsCrossOS(bundle.projects, claudeDir, decision, out);
      remapDecisions = crossOsResult.remapDecisions;
      skippedSlugs = crossOsResult.skippedSlugs;
      // Convert non-skipped remap decisions to ResolvedProject for existing applyProjectCategories
      resolved = crossOsResult.remapDecisions
        .filter((d): d is RemapDecision & { targetPath: string } => d.targetPath !== null)
        .map((d) => ({ slug: d.slug, confirmedPath: d.targetPath }));
    } else {
      const sameOsResult = await resolveProjects(bundle.projects, claudeDir, decision, out);
      resolved = sameOsResult.resolved;
      skippedSlugs = sameOsResult.skippedSlugs;
    }
    ```
  - [x] 4.5 Update the summary section to include cross-OS outcome counts when `isCrossOS`:
    ```ts
    if (isCrossOS) {
      const autoConfirmed = remapDecisions.filter((d) => d.outcome === 'auto-confirmed').length;
      const userConfirmed = remapDecisions.filter((d) => d.outcome === 'user-confirmed').length;
      const overridden = remapDecisions.filter((d) => d.outcome === 'overridden').length;
      const skipped = remapDecisions.filter((d) => d.outcome === 'skipped').length;
      summaryParts.push(
        `Remapped: ${autoConfirmed.toString()} auto / ${userConfirmed.toString()} user / ${overridden.toString()} override / ${skipped.toString()} skipped.`,
      );
    }
    ```
  - [x] 4.6 In JSON output mode, attach `summary.remappings` to the final JSON. The `Output.finish` method handles JSON; check how the output module works and extend accordingly (or add `remapDecisions` to a structured summary object passed to `out.finish`).

- [x] Task 5 — Write tests (AC: #1–#10)
  - [x] 5.1 Create `src/commands/import-cross-os.test.ts` (or add a `describe('cross-OS', ...)` block inside `src/commands/import.test.ts` if that file exists) covering:
    - Cross-OS announcement message format (AC #1)
    - `--remap` prefix substitution for matched and unmatched projects (AC #4)
    - PATH_REMAP_AMBIGUOUS exit when `--remap` misses a project (AC #4)
    - Path-traversal guard: `--remap "C:\Users\maya=/Users/maya/../../../etc"` is rejected (AC #10)
    - Same-OS import does not trigger cross-OS branch (AC #6)
    - Summary counts when all four outcome types occur (AC #8)
    - `RemapDecisions` shape is correct (slug, originalPath, targetPath, outcome) (AC #7)
  - [x] 5.2 Unit tests for `confirmCrossOsPath` in `src/ui/prompts.test.ts`:
    - Silent mode returns skip
    - With suggestion: options include accept
    - Without suggestion: options omit accept
  - [x] 5.3 Add `RemapDecision`/`RemapDecisions` type exports test in `src/core/decision-schema.test.ts` (simple smoke test that the union values compile)

- [x] Task 6 — Update sprint-status.yaml (bookkeeping)
  - [x] 6.1 Set `2-2-cross-os-detection-guided-per-project-remap-ui: review` when complete

- [x] Task 7 — Verify `npm run check` passes (AC: all)
  - [x] 7.1 Run `npm run check` (lint + typecheck + test suite)
  - [x] 7.2 Confirm no regressions in same-OS integration tests
  - [x] 7.3 Confirm `path-engine.ts` still shows 100% coverage (no new branches added there)

## Dev Notes

### Architecture: Where Each Piece Lives

```
src/core/decision-schema.ts   ← RemapOutcome, RemapDecision, RemapDecisions types; remap field on ImportDecision
src/core/path-engine.ts       ← suggestRemap, findMatchingDir (UNCHANGED — pure, already tested 100%)
src/ui/prompts.ts             ← confirmCrossOsPath (new function, same @clack/prompts pattern)
src/commands/import.ts        ← resolveProjectsCrossOS, cross-OS branch in run()
src/cli.ts                    ← --remap flag registration
```

The architecture invariant "all platform branching for path operations belongs in path-engine" means `suggestRemap` is called in `import.ts` but its prefix-detection logic is NOT reimplemented there.

### Bundle `sourcePlatform` Field

`bundle.sourcePlatform` is a top-level field (type: `'win32' | 'darwin' | 'linux'`), NOT nested under `bundle.source.platform`. Defined in `BundleSchema` at:
```ts
sourcePlatform: z.enum(['win32', 'darwin', 'linux']),
```

Cross-OS detection:
```ts
isCrossPlatformMigration(bundle.sourcePlatform as NodeJS.Platform, process.platform as NodeJS.Platform)
// returns true when the two values differ
```

### `homedir` Derivation in `import.ts`

The `no-process-env-home` ESLint rule (Story 1.2) reserves `os.homedir()` calls to `claude-locator.ts`. In `import.ts`, derive homedir without violating the rule:
```ts
const homedir = dirname(claudeDir);
```
This works because `claudeDir` is `~/.claude` (or `$CLAUDE_CONFIG_DIR`), so `dirname` gives the home directory. The same pattern is already used in `gatherSuggestion`. When `CLAUDE_CONFIG_DIR` is set for tests, `dirname` will resolve relative to the test dir — which is correct for test isolation.

### `ResolvedProject` Interface Compatibility

The existing `applyProjectCategories` function expects `ResolvedProject[]` (objects with `{ slug, confirmedPath }`). After cross-OS resolution, convert `RemapDecisions` (non-skipped) to `ResolvedProject[]` via:
```ts
resolved = crossOsResult.remapDecisions
  .filter((d): d is RemapDecision & { targetPath: string } => d.targetPath !== null)
  .map((d) => ({ slug: d.slug, confirmedPath: d.targetPath }));
```
`applyProjectCategories` is unchanged — it still writes files keyed by `slug` under `~/.claude/projects/<slug>/`. The `confirmedPath` is only used for the summary display.

### `RemapOutcome` Values

| Outcome | When |
|---------|------|
| `'auto-confirmed'` | `suggestRemap` returned a path AND user pressed Enter (accepted default), OR `--remap` matched |
| `'user-confirmed'` | User manually typed a path (override action) matching the suggestion exactly |
| `'overridden'` | User typed a custom path different from the suggestion |
| `'skipped'` | User selected Skip, or path-traversal guard rejected the resolved path |

**Implementation note:** In the prompt flow, `result.action === 'accept'` → `'auto-confirmed'`; `result.action === 'override'` → `'overridden'`. The `'user-confirmed'` outcome (same path as suggestion but typed manually) is a fine-grained distinction — for Story 2.2 it is acceptable to merge it into `'overridden'`. Story 2.3 does not differentiate between `'overridden'` and `'user-confirmed'`; the outcome enum carries both for future reporting precision.

### `--remap` Prefix Matching

The LHS match uses `originalPath.startsWith(lhs)`. On Windows, paths are case-insensitive but `startsWith` is case-sensitive. The epic ACs use literal matching, so case-sensitive is correct for Story 2.2 (users are expected to supply the exact prefix). Path-traversal guard normalizes the result with `path.normalize` and verifies it starts with `homedir`.

### `confirmCrossOsPath` vs. `confirmProjectPath`

Both prompt functions exist in `prompts.ts`. They serve different flows:
- `confirmProjectPath` — same-OS flow: checks if the project's existing path is present on disk; the suggestion comes from `findMatchingDir` scanning local subdirectories
- `confirmCrossOsPath` — cross-OS flow: suggestion comes from `suggestRemap` (home-prefix mapping) with `findMatchingDir` as fallback; message framing is remap-oriented

Do NOT modify `confirmProjectPath`; same-OS tests would break.

### `bailOnCancel` is Package-Private in `prompts.ts`

`bailOnCancel` is already defined and used in `prompts.ts`. The new `confirmCrossOsPath` can call it directly since it lives in the same file.

### ESLint Rules Relevant to This Story

- `cmemmov/no-hardcoded-separator` — do NOT use literal `'/'` or `'\\'` as separators. Use `posix.sep` / `win32.sep` from `node:path`. **Exception**: `--remap` spec parsing splits on `'='` which is not a separator, so that's fine.
- `cmemmov/no-process-env-home` — derive home from `dirname(claudeDir)`, never `process.env.HOME` or `os.homedir()` inside `import.ts`.
- `cmemmov/no-raw-json-parse` — not relevant to this story (no JSON parsing added).
- `cmemmov/no-console-outside-output` — use `out.progress()` / `out.warn()`, never `console.log`.

### `Output.finish` and JSON Mode

Looking at the `Output` class in `src/ui/output.ts`, `out.finish(summaryText, true)` emits the final line. In JSON mode it wraps the message in a JSON object. If you need to add `summary.remappings` to the JSON output, you'll need to check whether `Output.finish` accepts a structured payload or if you need to call `out.progress` with the JSON payload before `out.finish`. Read `src/ui/output.ts` before implementing Task 4.6 to determine the right approach.

### Deferred Items to be Aware Of (from cr-2-1)

Two items deferred from Story 2.1 review that Story 2.2 MUST close:
1. **MEDIUM — `suggestRemap` does not validate path-traversal sequences.** Story 2.2 is the first caller. Apply `path.normalize` and reject results escaping `homedir` (AC #10 explicitly covers this).
2. **LOW — `suggestRemap` preserves trailing separators.** Apply `posix.normalize`/`win32.normalize` to the result at the `import.ts` call boundary. This is subsumed by the `normalize(result.path)` call in Task 4.2's implementation.

### Existing Import Test File Location

Check if `src/commands/import.test.ts` exists before creating `import-cross-os.test.ts`. If it exists, add cross-OS tests as a `describe('cross-OS remap', ...)` block within it. If it does not exist, create the new file.

### Previous Story Intelligence (Story 2.1)

Key learnings that apply here:
- Use `posix.sep` / `win32.sep` instead of literal separators to satisfy `no-hardcoded-separator`
- Follow TDD: write tests + fixture first, run to confirm failures, then implement
- `decision-schema.ts` exports go in the union but may not go in `ALL_CATEGORIES` (same pattern: `claudeJson` is in the union but not `ALL_CATEGORIES`; `RemapDecisions` is similarly an add-on type, not a category)
- The `suggestRemap` function is already implemented and tested — do NOT re-implement its logic in `import.ts`

### References

- [Source: `src/commands/import.ts` — current implementation (reviewed above)]
- [Source: `src/core/path-engine.ts` — suggestRemap, findMatchingDir (lines 1-70)]
- [Source: `src/core/decision-schema.ts` — ImportDecision, ClaudeCategory pattern]
- [Source: `src/ui/prompts.ts` — confirmProjectPath pattern to follow for confirmCrossOsPath]
- [Source: `src/cli.ts` — parseProjectPath coerce pattern to follow for parseRemap]
- [Source: `src/core/bundle-schema.ts` — bundle.sourcePlatform field (line 48)]
- [Architecture: layered dependency rule — ui → commands → services → core (line 619)]
- [Architecture: suggestRemap signature (line 678) — updated to `string | null` by cr-2-1]
- [Deferred from cr-2-1: path-traversal guard and trailing separator normalization — MUST be closed by this story]
- [Epic ACs: Story 2.2 lines 945–982 in epics.md]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- `npm run check` — passed (lint, typecheck, full test suite: 382 tests passed, 2 skipped)
- `npx vitest run src/core/path-engine.test.ts --coverage` — confirmed `path-engine.ts` still 100% coverage on all axes (no new branches)

### Completion Notes List

- Implemented all 10 ACs from the story spec.
- AC #1 announcement uses `out.progress(...)` (stderr) before backup creation so the message is visible even if backup fails.
- AC #4 `--remap` rules are evaluated with case-sensitive `startsWith`, matching the literal interpretation in the spec and the dev notes.
- AC #7 `RemapDecision` outcomes use `'auto-confirmed'` for accept (suggestion path) and for `--remap` matches; `'overridden'` for user-typed override; `'skipped'` for skip or traversal-rejected paths. The `'user-confirmed'` enum value is reserved for Story 2.3 disambiguation but not produced in the current flow (matches the story note: "for Story 2.2 it is acceptable to merge it into 'overridden'").
- AC #9 JSON shape: `Output.finish` extended with an optional `extra` parameter. When provided, JSON `summary` becomes `{ text, ...extra }`; when absent, `summary` remains a bare string. Cross-OS imports pass `{ remappings }`. Same-OS imports pass nothing — backwards-compatible.
- AC #10 path-traversal guard: closed cr-2-1 deferred items by applying `path.normalize` and asserting the result remains under `homedir`. Critically, `homedir` itself is also normalized so the comparison works on Windows test runners where `path.normalize('/posix/path')` produces `\posix\path`. In `--remap` mode an escape throws `PATH_REMAP_AMBIGUOUS` (exit 2); in interactive mode an escape is treated as skip with a stderr warning so the user is informed without aborting the whole run.
- Same-OS test bundles previously hardcoded `sourcePlatform: 'linux'`; updated `makeBundle` default to `process.platform` so existing same-OS suites stay same-OS regardless of host. Cross-OS suite explicitly overrides to a guaranteed-different platform.

### File List

- src/core/decision-schema.ts (modified — added `remap` field to `ImportDecision`; added `RemapOutcome`, `RemapDecision`, `RemapDecisions` types)
- src/core/decision-schema.test.ts (modified — added type-level tests for new types)
- src/cli.ts (modified — added `parseRemap` coerce function; added `--remap` flag to import command; extended `ImportCLIOpts` with `remap?: string[]`)
- src/commands/import.ts (modified — added cross-OS detection, `resolveProjectsCrossOS`, summary counts, JSON `remappings` payload, path-traversal guard; added `remap` field to `ImportOpts` and parsing in `buildDecision`)
- src/commands/import.test.ts (modified — host-aware `makeBundle` default, mocked `confirmCrossOsPath` and `suggestRemap`, added `describe('cross-OS remap', ...)` block with 12 tests covering ACs 1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
- src/ui/prompts.ts (modified — added `CrossOsPathResult` interface and `confirmCrossOsPath` function)
- src/ui/prompts.test.ts (modified — added `describe('confirmCrossOsPath', ...)` block with 6 tests)
- src/ui/output.ts (modified — `OutputResult.summary` may now be `string | { text, ...extra }`; `Output.finish` accepts optional `extra` parameter)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified — story 2-2 transitioned ready-for-dev → in-progress → review)

### Change Log

- 2026-05-09: Implemented Story 2.2 — cross-OS detection, `--remap` CLI flag, `confirmCrossOsPath` prompt, `resolveProjectsCrossOS` with path-traversal guard, summary counts, and JSON `summary.remappings` payload. Closed cr-2-1 deferred items (path-traversal validation in `suggestRemap` callers, normalization at the import.ts boundary).
- 2026-05-09: Code review fixes applied during cr-2-2 pass:
  - **MEDIUM (security) — Sibling-home traversal gap closed.** The traversal guard previously used `targetPath.startsWith(homedir)` which let `/home/u2/...` slip past `/home/u` (or `C:\Users\maya2` past `C:\Users\maya`). Introduced `isInsideHome(target, homedir)` helper at `import.ts` that requires either equality or a separator boundary (`homedir + path.sep`). Applied at both guard sites (`--remap` scripted mode and interactive override). Added regression test `AC10: --remap that resolves to a sibling home (~maya2 vs ~maya) is rejected`.
  - **MEDIUM (UX) — Silent + cross-OS + no `--remap` rules now errors explicitly.** Previously the cross-OS branch fell through to `confirmCrossOsPath` which silently returned `'skip'` in silent mode, producing an opaque `IMPORT_PARTIAL` exit. `resolveProjectsCrossOS` now short-circuits with `PATH_REMAP_AMBIGUOUS` (exit 2) and a clear hint when `decision.silent && decision.remap.length === 0 && bundleProjects.length > 0`. This matches the comment in Task 3.1 of the spec ("Silent mode without --remap rules should not reach here"). Added regression test `AC10: silent + cross-OS + no --remap rules throws PATH_REMAP_AMBIGUOUS (does not silently skip)`.
  - LOW deferrals (relative-path rhs hint wording, first-match-wins docs, override placeholder UX, INTERNAL code for malformed flags, RemapDecision/ResolvedProject shape divergence, `Output.finish` extra-spread ordering) logged in `_bmad-output/implementation-artifacts/deferred-work.md` under "Deferred from: code review of story-2.2 (2026-05-09)".
  - Final state: 384 tests pass, 2 skipped; lint and typecheck clean.
