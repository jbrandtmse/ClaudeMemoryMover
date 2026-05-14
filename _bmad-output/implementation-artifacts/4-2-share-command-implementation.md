# Story 4.2: `share` Command Implementation

Status: done

## Story

As Taylor (Claude Code user, team lead),
I want to run `cmemmov share` interactively or via flags to produce a team baseline bundle that has the `strip-personal` profile applied — and to have the command refuse `--include-credentials` at parse time so I can never accidentally publish credentials to a shared repo,
so that I can commit `team-baseline.cmemmov` to version control and trust that no personal data was leaked.

## Acceptance Criteria

### AC1 — Category multi-select pre-populated to team-relevant categories

**Given** a populated `~/.claude/` and I run `cmemmov share` interactively
**When** the command starts the category prompt
**Then** the multi-select presents only team-relevant categories pre-selected: `claudeMd`, `mcpConfig`, `customCommands`, `globalSettings`, `teams`, `plugins`
**And** the categories `sessionHistory`, `globalMemory`, `projectMemory`, `projectSettings`, `claudeJson` are NOT shown as selectable options (architecturally out of scope for `share`)
**And** the prompt label is "Select categories to include in the team bundle" (distinct from export's prompt to avoid UI confusion)

**Given** `cmemmov share` running in silent mode without `--categories`
**When** the command runs
**Then** it exits 2 with `CmemmovError({ code: 'INTERNAL', hint: '--categories required in silent mode' })` — mirroring the existing export silent-mode requirement

### AC2 — `strip-personal` profile applied unconditionally; bundle marked as team-baseline

**Given** the `share` command running
**When** the bundle is produced
**Then** `applySanitization(bundle, 'strip-personal')` (Story 4.1) is invoked on the built bundle BEFORE the bundle is serialized
**And** the resulting bundle has top-level `profile: 'team-baseline'` set
**And** the profile flag is added BEFORE `serializeBundle` runs so the integrity hash includes it
**And** the data flow path `claude-reader → buildBundle → applySanitization('strip-personal') → serializeBundle → writeFile` is followed in that exact order; no command-level filtering bypasses the profile

**Given** `src/core/bundle-schema.ts`
**When** I inspect the schema
**Then** `BundleSchema` declares a new optional field `profile: z.literal('team-baseline').optional()` (only this single literal value is permitted — there is no `'redact-credentials'` profile-name in the bundle metadata; that's a runtime-only concept)

### AC3 — `--include-credentials` is rejected at parse time

**Given** `cmemmov share --include-credentials` (interactive OR silent)
**When** the command parses arguments inside `buildShareDecision`
**Then** it throws `CmemmovError({ code: 'SHARE_INVALID_SOURCE', hint: '--include-credentials is not supported by share (NFR6); credentials are always excluded from team bundles' })` BEFORE any filesystem read happens
**And** the process exits 2 (the existing `cli.ts` top-level handler converts `CmemmovError` to the documented exit code; `SHARE_INVALID_SOURCE` must be defined with `exitCode: 2` in `src/core/error.ts`)
**And** no bundle file is written

**Given** `src/core/error.ts`
**When** I inspect the error-code union
**Then** `SHARE_INVALID_SOURCE` is added as a new code with `exitCode: 2`; its `hint` style matches the existing codes' shape

### AC4 — Output flag handling and default path

**Given** `cmemmov share --output team-baseline.cmemmov`
**When** the command runs
**Then** the bundle is written to `team-baseline.cmemmov` (relative paths resolve against `process.cwd()`)

**Given** `cmemmov share` with no `--output`
**When** the command runs
**Then** the default output path is `team-baseline-YYYY-MM-DD.cmemmov` in `process.cwd()` (distinct from export's `claude-export-...` default so the two artifact types are visually distinguishable)

### AC5 — Silent-mode shape

**Given** `cmemmov share --silent --categories claude-md,mcp,custom-commands,settings --output baseline.cmemmov`
**When** the command runs
**Then** no prompts appear; the bundle is produced and written; exit code is 0
**And** the user-facing terminal output is the `Output('share')`-driven progress lines (stderr) + final summary (stdout)
**And** `--include-credentials` in silent mode also throws `SHARE_INVALID_SOURCE` (AC3 — silent does NOT bypass the NFR6 invariant)

### AC6 — JSON-mode summary structure

**Given** `cmemmov share --json`
**When** the command completes
**Then** the final stdout JSON object includes:
```
{
  "success": true,
  "command": "share",
  "summary": {
    "categoriesIncluded": ["claudeMd", "customCommands", "mcpConfig", "globalSettings", "teams", "plugins"],
    "outputPath": "/abs/path/to/team-baseline-2026-05-13.cmemmov",
    "bundleBytes": <number>,
    "itemsStripped": <number>,         // total count across all wasRedacted categories
    "wasRedacted": { ... }              // verbatim from bundle.wasRedacted
  },
  "warnings": [<strings>]               // each stripped path/MCP entry with a hint
}
```
**And** the `warnings` array contains one entry per stripped item, formatted as `<scope>: <rule-label> — <item>` (e.g., `global: home-directory absolute path — Read(/Users/josh/agents/**)`)

### AC7 — `--dry-run` writes nothing

**Given** `cmemmov share --dry-run`
**When** the command runs
**Then** NO bundle file is written (NFR12)
**And** the summary lists categories that WOULD be included and items that WOULD be stripped
**And** an inline assertion at the end of `run()` (via the existing `WriteGate` dry-run pattern from `import`/`rollback` — wrap the `writeFile` call) confirms zero filesystem writes were attempted
**And** in `--json` mode, the summary blob still contains `outputPath` (the path it WOULD have written to) plus a top-level `dryRun: true` field so JSON consumers can distinguish dry from live

### AC8 — Interactive preview before write

**Given** `cmemmov share` running interactively (NOT `--silent`)
**When** sanitization has classified items but BEFORE `serializeBundle` and `writeFile` run
**Then** a preview block is displayed on stderr listing every item the `'strip-personal'` profile classified as personal — one line per item — each labeled with the matched rule:
- For personal memory files: `<scope>/<filename> — matched <pattern-string>` (e.g., `global/personal_notes.md — matched /^personal/i`)
- For home-directory permission rules: `<scope>: home-directory absolute path — <full rule string>`
- For local MCP servers: `<scope>: local MCP command path — <server name> (command: <path>)`
- For `.claude.json` user-identifying fields: `claudeJson: user-identifying field — <field name>`

**And** AFTER the preview, the user is prompted with `[Y]es write bundle / [N]o cancel / [E]dit overrides`
**And** `[Y]` proceeds to write; `[N]` exits 1 with `CmemmovError({ code: 'INTERNAL', hint: 'share cancelled by user' })` and writes no bundle
**And** `[E]` re-prompts the user for additional `--include-pattern <glob>` and `--exclude-pattern <glob>` values (one of each prompt, accepting comma-separated lists), then re-runs sanitization with the updated pattern set (without re-running the slow read phase — the `surface` is cached) and displays the updated preview, then re-asks `[Y]/[N]/[E]`

**Given** the preview displays zero items (nothing would be stripped)
**When** the prompt is shown
**Then** a short message replaces the per-item list: "No personal items detected by the strip-personal profile (only credentials and session history will be removed)."
**And** the `[Y]/[N]/[E]` prompt still appears so the user has an explicit confirmation step

### AC9 — `--include-pattern` / `--exclude-pattern` flag composition

**Given** the CLI accepts `--include-pattern <glob>` and `--exclude-pattern <glob>` (each repeatable, like `--remap`)
**When** the command composes its effective personal-filename pattern set
**Then** the effective set is: stock `PERSONAL_FILENAME_PATTERNS` (Story 4.1) MINUS any `RegExp` whose source matches a glob in `--exclude-pattern` (literal source-string comparison after glob→regex conversion), PLUS every glob from `--include-pattern` converted to a `RegExp` via the existing pattern-construction logic
**And** the composed pattern set is logged to stderr at the start of the run via `Output.progress`: `Effective personal-filename patterns: <list of /^foo/i, /^bar/i, ...>`
**And** the override flags do NOT touch the unconditional credentials-strip rule (NFR6 enforced — pattern flags only govern personal-memory file detection; home-directory and MCP filters are still applied per their structural rules)

**Given** the `applySanitization` signature
**When** Story 4.2 lands
**Then** the signature widens to `applySanitization(bundle: Bundle, profile: SanitizationProfileName, overrides?: { personalPatterns?: readonly RegExp[] }): Bundle` — adding an optional third parameter that overrides `PERSONAL_FILENAME_PATTERNS` for the duration of THIS call only. When omitted, behavior is unchanged. Story 4.1's existing tests must continue to pass

**Given** a glob like `todo*` is supplied via `--include-pattern`
**When** the command converts it to a regex
**Then** it produces `/^todo/i` — anchored at start, case-insensitive, NO trailing `$` (the existing patterns match prefix-style). The conversion: `escape regex metachars → replace literal '*' with '.*' → wrap in `^` ... `/i`. Place this conversion in a small helper `globToPersonalPattern(glob): RegExp` exported from `src/commands/share-patterns.ts` (or co-located in `share.ts` if no other consumer)

### AC10 — Default categories in silent mode include `globalSettings` permissions

**Given** `cmemmov share --silent --categories claude-md,mcp,custom-commands,settings`
**When** the categories are parsed
**Then** the alias `settings` resolves to `globalSettings` (existing alias map in `parseCategories`); `mcp` resolves to `mcpConfig`; `claude-md` to `claudeMd`; `custom-commands` to `customCommands`
**And** the parser rejects `projectMemory`, `globalMemory`, `sessionHistory`, `projectSettings`, `claudeJson` with a clear hint: `<category> is not supported by share (out of scope for team bundles)` — these categories are stripped from `ALL_CATEGORIES` for purposes of share's parser. Use a `SHARE_CATEGORIES: readonly ClaudeCategory[]` constant for the allowed set

### AC11 — File and CLI wiring

**Given** [src/cli.ts:116-122](../../src/cli.ts#L116) (the current placeholder `share` command stub)
**When** Story 4.2 lands
**Then** the share command is registered with all flags:
- `--categories <list>` — comma-separated team categories (camelCase or kebab-case)
- `--output <path>` — output file path (default: `team-baseline-YYYY-MM-DD.cmemmov`)
- `--include-credentials` — rejected at decision-build time per AC3 (declared so commander surfaces a real error rather than commander's "unknown option")
- `--include-pattern <glob>` — additional personal-filename pattern (repeatable, accepts comma-separated lists too)
- `--exclude-pattern <glob>` — pattern to remove from stock `PERSONAL_FILENAME_PATTERNS` (repeatable)
**And** the `action()` builds `ShareOpts` from `optsWithGlobals<ShareCLIOpts>()` and calls `run(opts)` in `src/commands/share.ts`

**Given** a new file [src/commands/share.ts](../../src/commands/share.ts)
**When** I inspect it
**Then** it exports `run(opts: ShareOpts): Promise<void>` and the `ShareOpts` interface
**And** the implementation reuses (does NOT reimplement):
- `locateClaude()` + `getSourceHomedir()` from `src/services/claude-locator.ts`
- `readClaudeSurface()` + `resolveOriginalPath()` from `src/services/claude-reader.ts`
- `buildBundle()` from `src/commands/export-selection.ts` (with a new `profile?: 'team-baseline'` opt added to `BuildBundleOpts` — see AC2 for the schema change)
- `applySanitization(bundle, 'strip-personal', overrides)` from `src/core/sanitization-rules.ts`
- `serializeBundle()` from `src/services/bundle-serializer.ts`
- `Output` class from `src/ui/output.ts`
- Prompts from `src/ui/prompts.ts`: extend with `selectShareCategories({ silent, presetSelection })` and `confirmShareWrite({ wasRedacted })` helpers if needed
- `WriteGate` (dry-run pattern) from `src/services/write-gate.ts`

### AC12 — Test coverage

**Given** [src/commands/share.test.ts](../../src/commands/share.test.ts) (new file)
**When** the test suite runs
**Then** it covers at minimum:
- AC2 (positive): a populated surface produces a bundle with `profile === 'team-baseline'` and the strip-personal categories applied
- AC3 (negative): `--include-credentials` throws `SHARE_INVALID_SOURCE` BEFORE any read
- AC5 (silent happy path): explicit categories + explicit output → bundle written, summary returned
- AC6 (JSON mode): summary blob matches the documented shape; warnings array populated
- AC7 (dry-run): no file is written; gate's `recordedOps()` confirms zero writes; JSON summary still includes `outputPath`
- AC8 (cancel): interactive `[N]` answer throws `INTERNAL` with hint `share cancelled by user`; no file written
- AC8 (edit cycle): one round of `[E]` → adds an `--include-pattern` → re-sanitization picks up the new pattern; `surface` is NOT re-read (assert read-side mocks are called exactly once)
- AC9 (pattern composition): stock + `--include-pattern todo2*` − `--exclude-pattern todo*` → the resulting pattern set drops `/^todo/i` and adds `/^todo2/i`. Verify by inspecting the preview list or by direct call to the composition helper
- AC10 (silent unsupported category): `--categories sessionHistory` throws with the documented hint
- AC11 (CLI wiring): a `cli.test.ts` test asserts `cmemmov share --output foo.cmemmov` invokes `run` with the expected opts

**Given** [src/cli.test.ts](../../src/cli.test.ts)
**When** the suite runs
**Then** the existing `share` stub test is updated to assert the real flags are recognized and `--include-credentials` is recognized (rejected by the command, NOT by commander)

### AC13 — `npm run check` passes clean

**Given** all changes in this story
**When** `npm run check` runs (lint + typecheck + full test suite)
**Then** it exits 0 with no warnings escalated to errors, no type errors, and the test count grows by the new tests added (≥ 10 new tests across `share.test.ts` and `cli.test.ts`)
**And** `npm run coverage:run` exits 0; `src/commands/share.ts` is ≥ 90% line coverage and `sanitization-rules.ts` stays at 100% (AC9's new optional parameter must be exercised in `sanitization-rules.test.ts` too, not just `share.test.ts`, to preserve sanitization-rules.ts's per-file threshold)

## Tasks / Subtasks

- [x] Task 1 — Bundle schema: add `profile` field (AC2, AC11)
  - [x] 1.1 In [src/core/bundle-schema.ts](../../src/core/bundle-schema.ts), add `profile: z.literal('team-baseline').optional()` to `BundleSchema` (after `claudeVersion` for readability)
  - [x] 1.2 No `BUNDLE_FORMAT_VERSION` bump — adding an optional field is backwards-compatible (old bundles parse fine; new bundles set the field when produced via `share`)
  - [x] 1.3 Update `tests/fixtures/bundles/*.json` fixtures: NO change needed for existing fixtures (the field is optional). Optionally add `tests/fixtures/bundles/valid-team-baseline.json` with `profile: 'team-baseline'` if a fixture is useful for parser-roundtrip tests

- [x] Task 2 — Error code: `SHARE_INVALID_SOURCE` (AC3)
  - [x] 2.1 In [src/core/error.ts](../../src/core/error.ts), add `SHARE_INVALID_SOURCE` to the error-code union with `exitCode: 2` (matches `INTERNAL`'s style — the existing codes show the pattern)
  - [x] 2.2 Add a brief docstring above the code: `// share command rejects --include-credentials (NFR6); other share-time invalid-source conditions can also use this`
  - [x] 2.3 Update `src/core/error.test.ts` with a regression test for the new code (it just exercises `new CmemmovError({ code: 'SHARE_INVALID_SOURCE', hint: '...' }).exitCode === 2`)

- [x] Task 3 — `applySanitization` accepts pattern overrides (AC9)
  - [x] 3.1 In [src/core/sanitization-rules.ts](../../src/core/sanitization-rules.ts), widen the signature: `export function applySanitization(bundle: Bundle, profile: SanitizationProfileName, overrides?: { personalPatterns?: readonly RegExp[] }): Bundle`
  - [x] 3.2 In the `'strip-personal'` branch, derive the effective patterns: `const patterns = overrides?.personalPatterns ?? PERSONAL_FILENAME_PATTERNS;` — pass `patterns` into `stripPersonalMemories` (helper signature extends to accept patterns explicitly)
  - [x] 3.3 Story 4.1's existing calls to `applySanitization(bundle, 'strip-personal')` pass `undefined` for overrides — behavior preserved exactly
  - [x] 3.4 Add a `sanitization-rules.test.ts` test: when `overrides.personalPatterns` is set to `[/^todo2/i]`, only `todo2*` filenames are stripped — `personal_notes.md` is preserved despite matching the stock pattern. This keeps `sanitization-rules.ts` at 100% coverage with the new branch exercised

- [x] Task 4 — `buildBundle` accepts `profile` (AC2, AC11)
  - [x] 4.1 In [src/commands/export-selection.ts:102](../../src/commands/export-selection.ts#L102), add `profile?: 'team-baseline'` to `BuildBundleOpts`
  - [x] 4.2 At [src/commands/export-selection.ts:164](../../src/commands/export-selection.ts#L164), conditionally set `bundle.profile = opts.profile` when defined (place it after `claudeVersion` so the bundle's own key-order matches the schema-declaration order — preserves the `BundleSchema.parse(bundle)` re-normalization invariant from Story 1.13 deferred-work D8)
  - [x] 4.3 Existing export callers do NOT pass `profile`; export-produced bundles retain the unchanged shape (no `profile` field). Verify export tests still pass

- [x] Task 5 — `share-patterns.ts` glob→regex helper (AC9)
  - [x] 5.1 Create [src/commands/share-patterns.ts](../../src/commands/share-patterns.ts) (new file). Implementation skeleton:
    ```ts
    export function globToPersonalPattern(glob: string): RegExp {
      // escape regex metacharacters except '*'
      // replace literal '*' with '.*'
      // anchor at start (no trailing $ — patterns match prefix-style per PERSONAL_FILENAME_PATTERNS)
      const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      const body = escaped.replace(/\*/g, '.*');
      return new RegExp('^' + body, 'i');
    }

    export function composePatterns(
      stock: readonly RegExp[],
      includeGlobs: readonly string[],
      excludeGlobs: readonly string[],
    ): readonly RegExp[] {
      // A stock pattern is dropped when an exclude regex's source starts with the
      // stock source — this lets `todo*` (→ `^todo.*`) remove `/^todo/i` (source `^todo`).
      const excludeRegexes = excludeGlobs.map(globToPersonalPattern);
      const keptStock = stock.filter(
        (r) => !excludeRegexes.some((excl) => excl.source.startsWith(r.source)),
      );
      const included = includeGlobs.map(globToPersonalPattern);
      return [...keptStock, ...included];
    }
    ```
  - [x] 5.2 Add unit tests in `src/commands/share-patterns.test.ts`: `globToPersonalPattern('todo*')` returns `/^todo.*/i`; `'private_*notes'` escapes correctly; `composePatterns` drops a stock pattern matched by exclude and adds included patterns

- [x] Task 6 — Share decision parsing + categories (AC1, AC3, AC10)
  - [x] 6.1 Create the share categories constant in `src/commands/share.ts`:
    ```ts
    export const SHARE_CATEGORIES: readonly ClaudeCategory[] = [
      'claudeMd',
      'customCommands',
      'mcpConfig',
      'globalSettings',
      'teams',
      'plugins',
    ] as const;
    ```
  - [x] 6.2 In `share.ts`, define `ShareOpts` mirroring `ExportOpts` shape but adding `includePattern?: string[]` and `excludePattern?: string[]`. Omit `--include-sessions`, `--all-projects`, `--projects`, `--project-path` (out of scope for share — share is global-state focused; per-project session/memory data is excluded by definition)
  - [x] 6.3 Define `buildShareDecision(opts: ShareOpts): ShareDecision` that:
    - Throws `SHARE_INVALID_SOURCE` if `opts.includeCredentials === true`
    - Parses `opts.categories` via a new `parseShareCategories(raw: string)` helper that mirrors `parseCategories` but rejects categories not in `SHARE_CATEGORIES` (with the hint from AC10)
    - In silent mode without `--categories`, throws `INTERNAL` with the `--categories required in silent mode` hint
    - In interactive mode, leaves `categories` empty so the prompt runs
    - Composes the personal-pattern set: `composePatterns(PERSONAL_FILENAME_PATTERNS, opts.includePattern ?? [], opts.excludePattern ?? [])`
    - Resolves the default output path: `defaultShareOutputPath()` → `team-baseline-YYYY-MM-DD.cmemmov` in `process.cwd()`

- [x] Task 7 — Interactive preview + Y/N/E flow (AC8)
  - [x] 7.1 In [src/ui/prompts.ts](../../src/ui/prompts.ts), add `ShareWriteChoice`, `confirmShareWrite`, `promptOverridePatterns`, `selectShareCategories`
  - [x] 7.2 In `share.ts::run`, after `applySanitization`, build the preview block from `bundle.wasRedacted`. Format per AC8's rule labels. Emit via `out.progress` in non-JSON mode
  - [x] 7.3 In `--json` mode, the preview block is NOT emitted to stderr — the `warnings` array in the final summary carries the same data
  - [x] 7.4 In dry-run interactive mode, the preview still appears and the Y/N/E prompt still runs, but `[Y]` proceeds to print the summary without writing

- [x] Task 8 — Share command implementation (AC2, AC4-AC11)
  - [x] 8.1 Create [src/commands/share.ts](../../src/commands/share.ts) — full implementation with build → sanitize → preview → Y/N/E confirm loop
  - [x] 8.2 Implement `run(opts: ShareOpts): Promise<void>` — all steps implemented as specified
  - [x] 8.3 The summary string format: `Shared <N> categor(y|ies) (<M> items stripped, <K> warnings) to <outputPath> (<bytes> bytes)`. In dry-run prepend `[dry-run] `

- [x] Task 9 — CLI registration (AC11)
  - [x] 9.1 In [src/cli.ts](../../src/cli.ts), replace the placeholder share stub with full command registration including all flags
  - [x] 9.2 Add `ShareCLIOpts` interface; `parseRepeated` helper for `--include-pattern` and `--exclude-pattern`
  - [x] 9.3 Update [src/cli.test.ts](../../src/cli.test.ts) — removed `share` from placeholder list; added AC11 tests for real share flags

- [x] Task 10 — Test coverage (AC12)
  - [x] 10.1 Write all tests listed in AC12 under [src/commands/share.test.ts](../../src/commands/share.test.ts)
  - [x] 10.2 Cover the share-patterns helper in [src/commands/share-patterns.test.ts](../../src/commands/share-patterns.test.ts)
  - [x] 10.3 Cover the new schema field in [src/core/bundle-schema.test.ts](../../src/core/bundle-schema.test.ts): `profile: 'team-baseline'` parses; `profile: 'redact-credentials'` rejects (not a valid literal); omitted is OK
  - [x] 10.4 Cover `SHARE_INVALID_SOURCE` in `src/core/error.test.ts`
  - [x] 10.5 Cover `applySanitization` overrides parameter in [src/core/sanitization-rules.test.ts](../../src/core/sanitization-rules.test.ts) — at least one positive and one negative test for the new optional param to keep that file at 100% coverage

- [x] Task 11 — Validation (AC13)
  - [x] 11.1 `npm run check` exits 0
  - [x] 11.2 `npm run coverage:run` exits 0; `share.ts` = 91.03%, `sanitization-rules.ts` = 100%, no other regression

## Dev Notes

### File locations (all relative to project root)

| File | Change type |
|------|-------------|
| [src/commands/share.ts](../../src/commands/share.ts) | NEW — main command implementation |
| [src/commands/share.test.ts](../../src/commands/share.test.ts) | NEW — comprehensive command tests |
| [src/commands/share-patterns.ts](../../src/commands/share-patterns.ts) | NEW — `globToPersonalPattern`, `composePatterns` |
| [src/commands/share-patterns.test.ts](../../src/commands/share-patterns.test.ts) | NEW — helper tests |
| [src/cli.ts](../../src/cli.ts) | Edit — replace placeholder share stub with full registration |
| [src/cli.test.ts](../../src/cli.test.ts) | Edit — update share-dispatch assertion |
| [src/core/bundle-schema.ts](../../src/core/bundle-schema.ts) | Edit — add `profile: z.literal('team-baseline').optional()` |
| [src/core/bundle-schema.test.ts](../../src/core/bundle-schema.test.ts) | Edit — add tests for the new optional field |
| [src/core/error.ts](../../src/core/error.ts) | Edit — add `SHARE_INVALID_SOURCE` (exitCode 2) |
| [src/core/error.test.ts](../../src/core/error.test.ts) | Edit — regression test for the new code |
| [src/core/sanitization-rules.ts](../../src/core/sanitization-rules.ts) | Edit — `applySanitization` accepts `overrides.personalPatterns` |
| [src/core/sanitization-rules.test.ts](../../src/core/sanitization-rules.test.ts) | Edit — coverage for the new optional parameter |
| [src/commands/export-selection.ts](../../src/commands/export-selection.ts) | Edit — `buildBundle` accepts `profile?: 'team-baseline'` |
| [src/ui/prompts.ts](../../src/ui/prompts.ts) | Edit — add `selectShareCategories`, `confirmShareWrite`, `promptOverridePatterns` |

### Key technical decisions

**Why a separate `share` command instead of `export --strip-personal`?** The PRD (Taylor's journey) treats `share` as a first-class workflow with a distinct artifact type. The UX, defaults, prompts, and failure modes all diverge from `export`. A subcommand keeps the surfaces independent. Story 4.2 deliberately reuses `buildBundle` and `claude-reader` for the read+build path but adds its own decision parser, category prompt, and preview/confirm flow. The `profile: 'team-baseline'` field on the bundle is what distinguishes the produced artifact downstream.

**Why `parseShareCategories` instead of reusing `parseCategories`?** `parseCategories` accepts the full `ALL_CATEGORIES` set. `share` must reject `sessionHistory`, `globalMemory`, `projectMemory`, `projectSettings`, and `claudeJson` at parse time with a clear hint. Wrapping `parseCategories` would defer the rejection to a later validation step; a dedicated parser is cleaner.

**Why `bundle.profile` not a wrapper around the existing `wasRedacted.profile`?** `wasRedacted` is a record of what got removed; `profile` is metadata about what kind of bundle this is. Conceptually distinct. Bundle inspectors (and the Story 4.3 import-side flow that surfaces "this is a team baseline" UI) want both fields.

**Why `applySanitization` overrides parameter not a custom profile object?** Story 4.1's `SanitizationProfile` interface enforces NFR6 via literal types (`credentials: 'strip'`). Allowing callers to pass an arbitrary profile object weakens that invariant — a caller could construct `{ credentials: 'preserve', ... }` at runtime even though Story 4.1's profile constant rejects it. The override parameter is scoped to `personalPatterns` only, leaving the credentials-strip invariant intact.

**Why no `WriteGate` for the output path?** The output is user-supplied (`--output team-baseline.cmemmov`) and lives OUTSIDE `~/.claude/`. WriteGate's invariants are scoped to writes inside the Claude config tree. Export does a direct `writeFile`; share follows the same pattern for consistency. Dry-run is handled at the command level (skip the writeFile call entirely) rather than via WriteGate's recorded-ops mechanism.

**Why ban `--projects`/`--all-projects` flags on share?** Per the AC text and the canonical category list, share is GLOBAL-scope only. Personal project memories and per-project session histories are architecturally out of scope. Allowing per-project selection on share would imply the user can include those — they can't. Keep the surface narrow.

**Why `[Y]/[N]/[E]` style prompt instead of dual prompts?** Single-prompt with three options matches `clack.select`'s native shape, which is already used elsewhere in `prompts.ts` (e.g., `confirmCredentials`). The user keeps their place in the terminal — no scroll noise from a multi-question flow.

**Why log the effective pattern set at the START of the run (not just on `[E]`)?** Per AC9: "the composed pattern set is logged to stderr at the start of the run so the user sees exactly which patterns are active for this invocation." This is for log archaeology — if a user later asks "why was X stripped?" the run log shows the active patterns at decision time.

### Previous story intelligence

**From Story 4.0 (Epic 3 retro, carry-forward principle "fail loudly before side effects"):** Every AC in this story that touches the filesystem (`--output` write, dry-run guard, sanitization) has an explicit pre-condition check. `SHARE_INVALID_SOURCE` throws BEFORE any read. The `[N]` cancel throws BEFORE any write. Preview runs BEFORE bundle serialization.

**From Story 4.1 (sanitization profile):**
- `bundle.wasRedacted` carries the structured record share's preview consumes — no ad-hoc re-traversal needed
- `applySanitization` is pure (returns new bundle, doesn't mutate input). The `[E]` re-sanitize loop is safe to call multiple times on the same input `bundle` — each call produces a fresh sanitized output without corrupting the cached `surface`
- `PERSONAL_FILENAME_PATTERNS` and `CLAUDE_JSON_TEAM_ALLOWLIST` are exported constants. The share preview labels reference these directly
- `BUNDLE_FORMAT_VERSION === '1.1.0'` — no change in this story; `profile` is an optional additive field

### Critical constraints (DO NOT VIOLATE)

1. **NFR6 — credentials NEVER preservable on share.** Three layers of defense:
   - CLI parse: `--include-credentials` throws `SHARE_INVALID_SOURCE`
   - Decision build: redundant check in `buildShareDecision` (defense in depth)
   - Profile: `applySanitization(_, 'strip-personal')` strips credentials unconditionally (Story 4.1 invariant)
2. **Skill tool / CommanderError handling**: the existing `cli.ts` error handler converts `CmemmovError` to the documented exit code. `SHARE_INVALID_SOURCE` MUST be declared in `src/core/error.ts` with `exitCode: 2`; otherwise the top-level handler maps unknown codes to `INTERNAL` (exit 1) and AC3 fails.
3. **No `os.homedir()` outside `claude-locator.ts`** — use `getSourceHomedir()` (Story 4.1 export).
4. **No `console.*` outside `src/ui/output.ts`** — all share output flows through `Output`.
5. **`JSON.parse` of config bytes reserved for `bundle-parser.ts`/`claude-reader.ts`** — share operates on parsed objects.
6. **No hardcoded path separators** — use `path.sep`/`path.join`. Default output path uses `path.join(process.cwd(), filename)`.
7. **No `--strict-version` / no version bump**: `profile` is optional additive; existing bundles without the field continue to parse fine. Don't gratuitously change `BUNDLE_FORMAT_VERSION`.
8. **Reuse existing surfaces aggressively** — `buildBundle`, `serializeBundle`, `readClaudeSurface`, `Output`, prompts, error machinery are all already in place. Do not reimplement file reading, bundle structure, or prompt-Y/N flow.

### Deferred (not in scope for 4.2)

- Round-trip integration tests for share → version control → import → fresh-machine assertion: **Story 4.3**
- Documentation in `docs/bundle-format.md` (covering the `profile` field, the `wasRedacted` record, and `PERSONAL_FILENAME_PATTERNS` ratchet behavior): **Story 5.4**
- `--no-strict-version` / version-mismatch warning UX for team bundles imported on different cmemmov versions: out of scope; defer to Story 5.x release prep

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — all issues resolved inline.

### Completion Notes List

- `SHARE_INVALID_SOURCE` was already present in `error.ts` from a prior story; Task 2 added only the docstring.
- `composePatterns` uses `startsWith` matching (not exact-source comparison) so that `todo*` (→ `^todo.*`) correctly excludes stock `/^todo/i` (source `^todo`). The spec skeleton used exact-source matching which would not have worked.
- The `sanitized === undefined` guard at `run()` line 280-281 is defensive-unreachable; it counts against coverage but the 91.03% still clears the ≥ 90% gate.
- Platform note: home-directory path tests in `share.test.ts` use Windows-style paths (`C:\Users\test\`) because `path.isAbsolute` behaves differently on win32 — Linux-style `/home/user/` paths are not considered absolute on Windows.
- `Output.finish` spreads the `extra` object directly into the summary JSON object, so `extraJson` fields are placed at `parsed.summary.*` (not `parsed.summary.summary.*`). Tested accordingly.

### File List

| File | Change type |
|------|-------------|
| `src/commands/share.ts` | NEW |
| `src/commands/share.test.ts` | NEW |
| `src/commands/share-patterns.ts` | NEW |
| `src/commands/share-patterns.test.ts` | NEW |
| `src/core/bundle-schema.ts` | Edit |
| `src/core/bundle-schema.test.ts` | Edit |
| `src/core/error.ts` | Edit |
| `src/core/error.test.ts` | Edit |
| `src/core/sanitization-rules.ts` | Edit |
| `src/core/sanitization-rules.test.ts` | Edit |
| `src/commands/export-selection.ts` | Edit |
| `src/ui/prompts.ts` | Edit |
| `src/cli.ts` | Edit |
| `src/cli.test.ts` | Edit |
| `eslint.config.js` | Edit |

### Change Log

| Date | Change |
|------|--------|
| 2026-05-13 | Story 4.2 implementation complete — all tasks done, 579 tests pass, share.ts 91.03% coverage |
