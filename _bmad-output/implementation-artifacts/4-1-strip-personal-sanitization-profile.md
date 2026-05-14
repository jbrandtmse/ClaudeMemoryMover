# Story 4.1: Strip-Personal Sanitization Profile

Status: done

## Story

As a developer working on cmemmov,
I want a declarative `strip-personal` profile in `src/core/sanitization-rules.ts` that defines exactly what is stripped (credentials, personal memory files, user-identifying fields, machine-specific paths) vs. preserved (CLAUDE.md, MCP server definitions, custom commands, shared permission patterns, network paths) for every artifact category,
so that NFR6 (never include credentials) is enforced architecturally inside the profile (not at the command level), and `cmemmov share` (Story 4.2) is a single declarative transformation rather than ad-hoc filtering scattered across modules.

## Acceptance Criteria

### AC1 — Two declarative profiles coexist

**Given** `src/core/sanitization-rules.ts`
**When** I inspect its exports
**Then** the module exports a `SanitizationProfile` interface and a `SANITIZATION_PROFILES` constant keyed by profile name (`'redact-credentials'` and `'strip-personal'`)
**And** both profiles are declarative data structures — each category has an explicit string discriminator (e.g. `'preserve' | 'strip' | 'partial'`), NOT inline procedural code
**And** `applySanitization(bundle, profile)` reads the profile and dispatches to per-category helpers (`stripPersonalMemories`, `stripHomedirPermissionRules`, `stripLocalMcpPaths`, `stripClaudeJsonUserFields`) — those helpers contain the per-category logic; the profile is the contract

### AC2 — Credentials stripped unconditionally with no escape hatch

**Given** any bundle that contains credentials (regardless of `hasCredentials`, `--include-credentials`, or any upstream flag)
**When** `applySanitization(bundle, 'strip-personal')` runs
**Then** `bundle.credentials.content` is set to `null` and `bundle.credentials.wasRedacted` is set to `true` (preserving the existing per-credentials marker)
**And** `bundle.wasRedacted.credentials` is set to `true` (the new top-level redaction record)
**And** there is NO branch, flag, environment variable, or profile override that bypasses this — verified by a unit test that asserts the credentials-strip path is invariant across any caller-supplied options

**Given** the `'strip-personal'` profile's TypeScript type
**When** the dev tries to write `SANITIZATION_PROFILES['strip-personal'].credentials = 'preserve'`
**Then** the assignment is a compile-time error (`as const` on the profile object plus a discriminator literal type ensures NFR6 is unrepresentable as a profile mutation)

### AC3 — Personal memory filtering

**Given** a bundle with `global.memories` and `projects[].memories` entries
**When** `applySanitization(bundle, 'strip-personal')` runs
**Then** an entry is removed if (a) its `filename` matches any pattern in `PERSONAL_FILENAME_PATTERNS`, OR (b) its `content` parses as YAML frontmatter with `personal: true` at the top of the document
**And** non-matching entries (CLAUDE.md-style shared rules, team conventions, general memories) are preserved verbatim
**And** the stripped filenames are recorded in `bundle.wasRedacted.personalMemoryFiles: string[]` (deduplicated, with the `<scope>/<filename>` form when project-scoped, e.g., `global/personal_notes.md` or `<slug>/personal_notes.md`)

**Given** the `PERSONAL_FILENAME_PATTERNS` constant
**When** I inspect `src/core/sanitization-rules.ts`
**Then** it is exported as `export const PERSONAL_FILENAME_PATTERNS: readonly RegExp[] = [...]` at module top level (NOT inlined inside a function body)
**And** its initial contents are anchored regexes matching the glob patterns `personal*`, `private*`, `me_*`, `todo*` against the FILENAME ONLY (case-insensitive, no directory part): `/^personal/i`, `/^private/i`, `/^me_/i`, `/^todo/i`

**Given** an entry whose filename is `CLAUDE.md`, `MEMORY.md`, `team-conventions.md`, or any name not matching the patterns
**When** the profile applies
**Then** the entry is preserved (no false positive)

### AC4 — Permission rules under the source home directory are stripped

**Given** a bundle whose `bundle.sourceHomedir` field is set (new bundle field — see AC8)
**And** the bundle's `global.settings.permissions` array contains permission-rule strings of the form `Read(<path>)`, `Write(<path>)`, `Bash(<command pattern>)`, etc.
**When** `applySanitization(bundle, 'strip-personal')` runs
**Then** a rule is stripped if the path argument is an absolute path AND `path.startsWith(bundle.sourceHomedir)` (after platform-aware normalization — strip is independent of which separator style the rule uses)
**And** rules with relative paths (`./`, `**`, plain globs) are preserved
**And** rules with network paths (`\\server\share`, `smb://`, `nfs://`, `http://`, `https://`) are preserved
**And** rules without a parseable path argument (e.g., `Bash(git status)`) are preserved
**And** the stripped rules are recorded in `bundle.wasRedacted.homeDirPermissionRules: string[]` (full rule strings as they appeared)

**Given** the same logic
**When** `projects[].settings.permissions` is present
**Then** the same filtering is applied per-project; recorded entries in `wasRedacted.homeDirPermissionRules` are scoped with the slug prefix (e.g., `<slug>: Read(...)`)

### AC5 — MCP server entries with local paths under the home directory are stripped

**Given** a bundle with `global.mcpConfig` (or `global.settings.mcpServers`) — both shapes are records keyed by server name with values containing `command`, `args`, or `path` fields
**When** `applySanitization(bundle, 'strip-personal')` runs
**Then** for each server entry, if the `command` (or `path`) field is an absolute local path AND begins with `bundle.sourceHomedir`, the server entry is REMOVED from the record
**And** entries whose `command` is a bare program name (e.g., `node`, `npx`, `python3`) are preserved
**And** entries whose `command` is a network URL or UNC path (`\\server\share\...`, `http(s)://...`) are preserved
**And** the removed server entry names are recorded in `bundle.wasRedacted.localMcpServers: string[]`

**Given** `bundle.global.claudeJson.mcpServers` (the nested MCP config inside `.claude.json`)
**When** `applySanitization` runs
**Then** the same filtering is applied — server entries with home-dir absolute commands are removed; the removed names are recorded in `wasRedacted.localMcpServers` with a `claudeJson:` prefix (e.g., `claudeJson:fileserver-local`)

### AC6 — Custom commands and CLAUDE.md preserved

**Given** any bundle
**When** `applySanitization(bundle, 'strip-personal')` runs
**Then** `global.customCommands` is preserved verbatim (FR25)
**And** `global.claudeMd` is preserved verbatim
**And** `projects[].claudeMd` is preserved verbatim per project

### AC7 — `.claude.json` user-identifying fields stripped per allowlist

**Given** `bundle.global.claudeJson` is present
**When** `applySanitization(bundle, 'strip-personal')` runs
**Then** the result keeps ONLY the fields in `CLAUDE_JSON_TEAM_ALLOWLIST` (initial allowlist: `theme`, `editorMode`, `verbose`, `experiments`)
**And** every other top-level key in `.claude.json` is removed
**And** the removed top-level key names are recorded in `bundle.wasRedacted.claudeJsonFields: string[]`
**And** when no team-relevant fields remain (i.e., the post-strip object is `{}`), the `claudeJson` field is removed from `bundle.global` entirely (rather than leaving an empty object) so the downstream `share` flow does not write an empty `.claude.json`

**Given** the `CLAUDE_JSON_TEAM_ALLOWLIST` constant
**When** I inspect `src/core/sanitization-rules.ts`
**Then** it is exported as `export const CLAUDE_JSON_TEAM_ALLOWLIST: readonly string[] = [...]` at module top level
**And** the constant is documented inline with the deny rationale for the most common stripped fields: `email`, `name`, `machineId`, `lastSessionCwd`, `currentProject`, `recentProjects`, `mcpServers` (handled by AC5), `projects` (per-project history), `githubRepoPaths`

### AC8 — Bundle schema extension: `sourceHomedir` and `wasRedacted`

**Given** `src/core/bundle-schema.ts`
**When** I inspect the schema
**Then** `BundleSchema` declares a new required field `sourceHomedir: z.string()` — the source machine's home directory captured at export time
**And** `BundleSchema` declares a new optional field `wasRedacted: z.object({ credentials: z.boolean().optional(), personalMemoryFiles: z.array(z.string()).optional(), homeDirPermissionRules: z.array(z.string()).optional(), localMcpServers: z.array(z.string()).optional(), claudeJsonFields: z.array(z.string()).optional() }).strict().optional()`
**And** `BUNDLE_FORMAT_VERSION` is bumped from `'1.0.0'` to `'1.1.0'`

**Given** [src/commands/export-selection.ts:112](../../src/commands/export-selection.ts#L112) (`buildBundle`)
**When** building a bundle
**Then** `bundle.sourceHomedir` is populated from `dirname(opts.surface.claudeDir)` when `claudeDir` ends in `.claude` (the default case), OR from a new locator export that returns the captured `os.homedir()` if `CLAUDE_CONFIG_DIR` was set
**And** `wasRedacted` is NOT set at build time (only `applySanitization` writes to it)

**Given** existing bundle fixtures: [tests/fixtures/bundles/valid-minimal.json](../../tests/fixtures/bundles/valid-minimal.json), [tests/fixtures/bundles/with-credentials.json](../../tests/fixtures/bundles/with-credentials.json), [tests/fixtures/bundles/invalid-missing-field.json](../../tests/fixtures/bundles/invalid-missing-field.json), [tests/fixtures/bundles/invalid-wrong-type.json](../../tests/fixtures/bundles/invalid-wrong-type.json), [tests/fixtures/bundles/invalid-extra-field.json](../../tests/fixtures/bundles/invalid-extra-field.json)
**When** the test suite runs
**Then** every valid fixture has been updated to include `"sourceHomedir": "/home/user"` (or platform-appropriate value) and `"version": "1.1.0"`
**And** the `invalid-missing-field.json` fixture is updated (or replaced) so that `sourceHomedir` is the field removed if that's the intent of the test — preserve the test's purpose
**And** any other bundle fixture under `tests/fixtures/bundles/` AND `tests/fixtures/bundles/older-bundle-version.cmemmov` (if it exists) is updated to either match the new schema or be re-cast as a "pre-1.1.0 version" fixture that validates the parser's version-warning path

### AC9 — Every category in the canonical list has an explicit decision (no silent defaults)

**Given** `src/core/sanitization-rules.ts`
**When** the `SanitizationProfile` interface is defined
**Then** it has one property per canonical category — the union of `ALL_CATEGORIES` from `src/core/decision-schema.ts` plus `'credentials'` and `'claudeJson'` — making 12 fields total: `credentials`, `globalMemory`, `projectMemory`, `globalSettings`, `projectSettings`, `claudeMd`, `mcpConfig`, `customCommands`, `teams`, `plugins`, `sessionHistory`, `claudeJson`
**And** each property's type is a literal-string union — `'preserve' | 'strip' | 'partial' | 'redact-only'` — so omitting a category from a profile fails to typecheck

**Given** a unit test in `src/core/sanitization-rules.test.ts`
**When** the test asserts category coverage
**Then** the test enumerates every entry in `ALL_CATEGORIES` plus `'credentials'` and `'claudeJson'` and asserts that `SANITIZATION_PROFILES['strip-personal']` has a defined decision for each (no `undefined`)
**And** the test enumerates `Object.keys(SANITIZATION_PROFILES['strip-personal'])` and asserts that every key is in the canonical category list (no extra/misspelled keys)
**And** these tests prevent silent default handling: a new canonical category added to `ALL_CATEGORIES` without a matching profile entry will fail this test

### AC10 — `applySanitization` consumes both profiles

**Given** the existing function signature `applySanitization(bundle: Bundle, profile: 'redact-credentials'): Bundle`
**When** Story 4.1 lands
**Then** the signature widens to `applySanitization(bundle: Bundle, profile: SanitizationProfileName): Bundle` where `SanitizationProfileName = 'redact-credentials' | 'strip-personal'`
**And** the `'redact-credentials'` behavior is unchanged: returns the input unchanged when no credentials, otherwise returns a shallow copy with `credentials.content = null, credentials.wasRedacted = true` (existing tests in `src/core/sanitization-rules.test.ts:7-50` continue to pass)
**And** the `'strip-personal'` behavior implements AC2–AC7 above

### AC11 — `sessionHistory` is stripped unconditionally by `strip-personal`

**Given** any bundle with `projects[].sessions` non-empty
**When** `applySanitization(bundle, 'strip-personal')` runs
**Then** each project's `sessions` field is removed (set to `undefined`); the project entry itself is preserved
**And** no `wasRedacted` entry is added for sessions (session strip is a category-level architectural decision, not a per-item record — the `share` command's preview surfaces this via `summary.categoriesIncluded` not `wasRedacted`)

### AC12 — `teams` and `plugins` preserved (team-relevant)

**Given** any bundle with `global.teams` or `global.plugins`
**When** `applySanitization(bundle, 'strip-personal')` runs
**Then** both fields are preserved verbatim (these are explicitly shared by the team — Taylor's journey)

### AC13 — 100% line coverage on the module

**Given** `src/core/sanitization-rules.ts`
**When** `npm run coverage:run` runs
**Then** line coverage is 100% for this file (per-file threshold added/raised to 100 in [vitest.config.ts](../../vitest.config.ts))
**And** branch coverage is 100% — every conditional in the per-category helpers is exercised, including the `null`/`undefined`/non-string-path edge cases for permission rules and MCP commands

### AC14 — `npm run check` passes clean

**Given** all changes in this story
**When** `npm run check` runs
**Then** it exits 0 with lint clean, typecheck clean, full test suite passing
**And** `npm run coverage:run` exits 0 with no per-file coverage regression for any tracked module AND `sanitization-rules.ts` at 100%

## Tasks / Subtasks

- [x] Task 1 — Bundle schema extension (AC8)
  - [x] 1.1 In [src/core/bundle-schema.ts](../../src/core/bundle-schema.ts), bump `BUNDLE_FORMAT_VERSION` to `'1.1.0'`
  - [x] 1.2 Add `sourceHomedir: z.string()` as a required field on `BundleSchema` (place it next to `sourcePlatform` for readability)
  - [x] 1.3 Add `wasRedacted: z.object({ credentials: z.boolean().optional(), personalMemoryFiles: z.array(z.string()).optional(), homeDirPermissionRules: z.array(z.string()).optional(), localMcpServers: z.array(z.string()).optional(), claudeJsonFields: z.array(z.string()).optional() }).strict().optional()` as an optional top-level field
  - [x] 1.4 Update every fixture under `tests/fixtures/bundles/` to include the new required field. Use `"sourceHomedir": "/home/user"` for linux fixtures; use the same value style as `sourcePlatform` so the fixture remains internally consistent
  - [x] 1.5 For `invalid-missing-field.json`, check what field it omits (likely an existing required field, not the new one); leave it omitting the same field. Add `sourceHomedir` to it so it tests the originally-intended invariant rather than accidentally exercising the new field
  - [x] 1.6 If `tests/fixtures/bundles/older-bundle-version.cmemmov` exists, it should continue to use `version: '1.0.0'` to exercise the existing version-warning path. Do NOT add `sourceHomedir` to it — its omission alongside the old version exercises the parse-failure-on-old-bundle behavior the parser currently warns about
  - [x] 1.7 Run `npm run test` and patch any test that hardcoded the old `BUNDLE_FORMAT_VERSION` or relied on the old schema shape

- [x] Task 2 — `export-selection.ts::buildBundle` populates `sourceHomedir` (AC8)
  - [x] 2.1 In [src/commands/export-selection.ts:112](../../src/commands/export-selection.ts#L112), update the `bundle` literal to include `sourceHomedir`
  - [x] 2.2 Source the value: add a parameter `sourceHomedir: string` to `BuildBundleOpts` and require callers to supply it
  - [x] 2.3 In the callers of `buildBundle` (find via grep), derive `sourceHomedir`:
    - If `CLAUDE_CONFIG_DIR` is unset (default), use `dirname(surface.claudeDir)` (parent of `~/.claude` is `~`)
    - If `CLAUDE_CONFIG_DIR` is set, the parent of the custom config dir is NOT the user home. In that case, expose a new export `getSourceHomedir()` from `src/services/claude-locator.ts` that calls `os.homedir()` directly (this is the one allowed call site per the `no-restricted-imports` rule). Cache the value on the surface or pass it explicitly through the export pipeline
  - [x] 2.4 Update `buildBundle` callers' tests to pass the new option
  - [x] 2.5 Update fixture-builders if any test creates a `Bundle` literal directly

- [x] Task 3 — Define `SanitizationProfile`, `SANITIZATION_PROFILES`, and category constants (AC1, AC3, AC7, AC9)
  - [x] 3.1 In [src/core/sanitization-rules.ts](../../src/core/sanitization-rules.ts), define and export:
    ```ts
    export type SanitizationProfileName = 'redact-credentials' | 'strip-personal';

    export type CategoryDecision = 'preserve' | 'strip' | 'partial' | 'redact-only';

    export interface SanitizationProfile {
      readonly credentials: CategoryDecision;
      readonly globalMemory: CategoryDecision;
      readonly projectMemory: CategoryDecision;
      readonly globalSettings: CategoryDecision;
      readonly projectSettings: CategoryDecision;
      readonly claudeMd: CategoryDecision;
      readonly mcpConfig: CategoryDecision;
      readonly customCommands: CategoryDecision;
      readonly teams: CategoryDecision;
      readonly plugins: CategoryDecision;
      readonly sessionHistory: CategoryDecision;
      readonly claudeJson: CategoryDecision;
    }
    ```
  - [x] 3.2 Export `SANITIZATION_PROFILES: Readonly<Record<SanitizationProfileName, SanitizationProfile>>` with two entries:
    - `'redact-credentials'`: every non-credentials field is `'preserve'`, `credentials` is `'redact-only'`
    - `'strip-personal'`: `credentials: 'strip'`, `globalMemory: 'partial'`, `projectMemory: 'partial'`, `globalSettings: 'partial'`, `projectSettings: 'partial'`, `claudeMd: 'preserve'`, `mcpConfig: 'partial'`, `customCommands: 'preserve'`, `teams: 'preserve'`, `plugins: 'preserve'`, `sessionHistory: 'strip'`, `claudeJson: 'partial'`
  - [x] 3.3 Export `PERSONAL_FILENAME_PATTERNS: readonly RegExp[]` at module top level: `[/^personal/i, /^private/i, /^me_/i, /^todo/i]`
  - [x] 3.4 Export `CLAUDE_JSON_TEAM_ALLOWLIST: readonly string[]` at module top level: `['theme', 'editorMode', 'verbose', 'experiments']`. Add an inline block comment listing the deny-rationale items mentioned in AC7

- [x] Task 4 — Per-category helpers (AC3, AC4, AC5, AC7, AC11)
  - [x] 4.1 `stripPersonalMemories(memories: MemoryFile[], scope: string): { kept: MemoryFile[]; strippedFilenames: string[] }` — filters by `PERSONAL_FILENAME_PATTERNS` against `memory.filename`, AND parses simple YAML frontmatter (between the first two `---` lines) for `personal: true`. Returns the kept entries and the dropped filenames with `scope/` prefix. Frontmatter parsing should be minimal — a simple line scan for `^personal:\s*true\s*$` between the first two `---` delimiters; do NOT pull in a YAML library
  - [x] 4.2 `stripHomedirPermissionRules(permissions: unknown, sourceHomedir: string, scope: string): { kept: unknown; stripped: string[] }` — if `permissions` is an array of strings, filter each by extracting the argument inside `Foo(...)` syntax (regex: `^\w+\((.+)\)$`). If the argument is an absolute path AND `arg.startsWith(sourceHomedir)` (case-insensitive on win32 — use a small helper `pathStartsWith(needle, prefix, platform)` that handles win32 drive-letter and slash-style insensitivity), strip the rule. Network paths (UNC, URL) and relative paths pass through. Non-string entries pass through unchanged
  - [x] 4.3 `stripLocalMcpServers(mcpRecord: unknown, sourceHomedir: string, scope: string): { kept: unknown; strippedNames: string[] }` — if input is a record, iterate entries. For each entry, examine `value.command` (or `value.path`). If absolute local path under `sourceHomedir`, drop the entry. Bare names (no separator), network URLs, and UNC paths are kept
  - [x] 4.4 `stripClaudeJsonUserFields(claudeJson: unknown): { kept: Record<string, unknown> | undefined; strippedFields: string[] }` — if input is a plain object, keep ONLY keys in `CLAUDE_JSON_TEAM_ALLOWLIST`. Record the stripped keys. If the result is empty, return `{ kept: undefined, strippedFields }` so the caller can drop the field entirely
  - [x] 4.5 Helpers live in the same file (`sanitization-rules.ts`) and are NOT exported — module-private — unless a test needs to call them directly, in which case `export` for testability is acceptable

- [x] Task 5 — Wire `applySanitization` to consume profiles (AC2, AC10, AC11, AC12)
  - [x] 5.1 Widen the signature: `export function applySanitization(bundle: Bundle, profile: SanitizationProfileName): Bundle`
  - [x] 5.2 Profile dispatch:
    - For `'redact-credentials'`: keep the existing path (returns unchanged if no credentials, else shallow copy with redaction). Existing tests at lines 7–50 of [sanitization-rules.test.ts](../../src/core/sanitization-rules.test.ts) must continue to pass byte-for-byte
    - For `'strip-personal'`: apply each per-category helper in order. Build a new `wasRedacted` object accumulating each helper's stripped-record. Apply credentials strip unconditionally. Drop `sessions` arrays from each project. Replace `global.mcpConfig`, `global.settings`, `global.memories`, `global.claudeJson`, and per-project `settings`/`memories` with filtered values. Preserve `claudeMd`, `customCommands`, `teams`, `plugins`, `globalSettings.* (non-permissions)`, etc. Set `bundle.wasRedacted = <accumulated record>` only when at least one helper recorded something stripped (avoid writing an empty `wasRedacted: {}`)
  - [x] 5.3 The function returns a new `Bundle` object (shallow copy at top level, deep-copy only the modified sub-trees). Do NOT mutate the input bundle. Existing immutability test at [sanitization-rules.test.ts:16-22](../../src/core/sanitization-rules.test.ts#L16) confirms input is never mutated; the new `'strip-personal'` path needs the same property
  - [x] 5.4 The credentials strip path is unreachable via any options object — there is no `applySanitization` overload that takes a 3rd parameter, no env-var read, no global-state escape hatch. Document this with an inline comment above the function: `// NFR6: credentials strip is invariant under 'strip-personal'; no caller-supplied option can bypass it.`

- [x] Task 6 — Test coverage for `strip-personal` (AC9, AC13)
  - [x] 6.1 In [src/core/sanitization-rules.test.ts](../../src/core/sanitization-rules.test.ts), add a new `describe('applySanitization (strip-personal)')` block
  - [x] 6.2 Tests required (one per AC at minimum):
    - **AC2:** credentials are stripped to `null`; `bundle.wasRedacted.credentials === true`; existing-empty-credentials bundle still records nothing in `wasRedacted` for credentials (or sets `credentials: false`? — prefer NOT setting the key if input had no credentials; the field is `optional`, omit it)
    - **AC2 (negative):** confirm there is no overload allowing bypass — type-level test using `// @ts-expect-error` on `applySanitization(bundle, 'strip-personal', { keepCredentials: true })` — should fail to compile
    - **AC3:** memories with `personal_notes.md`, `private_journal.md`, `me_log.md`, `todo_list.md` filenames are stripped; `MEMORY.md`, `team-rules.md`, `CLAUDE.md` are preserved; a memory whose content begins with `---\npersonal: true\n---\n# Title` is stripped via frontmatter; `wasRedacted.personalMemoryFiles` lists the dropped filenames scoped to `global/...` and `<slug>/...`
    - **AC4:** rules `Read(/home/user/secrets)`, `Read(C:\Users\Josh\agents\**)` (use platform-appropriate `sourceHomedir`) are stripped; `Read(./project)`, `Read(\\\\server\\share)`, `Read(https://example.com)`, `Bash(git status)`, `Write(**/*.log)` are preserved; `wasRedacted.homeDirPermissionRules` captures the stripped strings
    - **AC5:** mcp server `localTool` with `command: '/home/user/agents/local.js'` is removed; `remoteTool` with `command: 'npx server-x'` preserved; `urlTool` with `command: 'https://server'` preserved; `wasRedacted.localMcpServers` captures `localTool` and (if from claudeJson) `claudeJson:localTool`
    - **AC6:** `customCommands`, `global.claudeMd`, `projects[].claudeMd` survive untouched
    - **AC7:** `bundle.global.claudeJson = { theme: 'dark', email: 'x@y', recentProjects: [...], machineId: 'abc' }` becomes `{ theme: 'dark' }`; `wasRedacted.claudeJsonFields` lists `['email', 'recentProjects', 'machineId']`
    - **AC7 (empty result):** `claudeJson` with only non-allowlist fields → `bundle.global.claudeJson` is `undefined` after sanitization (field removed entirely, not set to `{}`)
    - **AC9 (canonical-coverage):** iterate every entry in `ALL_CATEGORIES` plus `'credentials'` and `'claudeJson'` and assert `SANITIZATION_PROFILES['strip-personal'][cat] !== undefined`; iterate `Object.keys(SANITIZATION_PROFILES['strip-personal'])` and assert each is in the canonical category list
    - **AC10 (regression):** all existing redact-credentials tests still pass (already in the file at lines 7–50; do not delete them)
    - **AC11:** `projects[].sessions` is undefined after strip; `wasRedacted.sessionHistory` is NOT written (it's not in the `wasRedacted` shape)
    - **AC12:** `teams` and `plugins` survive untouched
    - **Immutability:** the input bundle is not mutated (assert deep equality of input pre/post)
    - **Edge cases for 100% coverage:** (a) memory entry whose content lacks frontmatter; (b) permission rule whose path is parsed but is not absolute; (c) MCP entry whose value is null/undefined; (d) claudeJson that is null/non-object; (e) bundle with no credentials at all (wasRedacted.credentials stays unset); (f) bundle whose `sourceHomedir` contains an odd character (drive letter capitalized differently on win32 — verify case-insensitive match)

- [x] Task 7 — Coverage threshold for `sanitization-rules.ts` (AC13)
  - [x] 7.1 In [vitest.config.ts](../../vitest.config.ts) (or wherever per-file coverage thresholds live), add an entry for `src/core/sanitization-rules.ts` with 100% line and branch
  - [x] 7.2 Run `npm run coverage:run` and ensure the new threshold passes (and that no other tracked module regressed)

- [x] Task 8 — Validation (AC14)
  - [x] 8.1 `npm run check` exits 0 — lint clean, typecheck clean, full suite passes (existing test count + new tests added in Task 6)
  - [x] 8.2 `npm run coverage:run` exits 0 — `sanitization-rules.ts` reports 100% line + branch; no other per-file regression
  - [x] 8.3 `docs/bundle-format.md` does not exist — documentation deferred to Story 5.4 (documentation deliverables)

## Dev Notes

### File locations (all relative to project root)

| File | Change type |
|------|-------------|
| [src/core/sanitization-rules.ts](../../src/core/sanitization-rules.ts) | Major rewrite — declarative profiles + per-category helpers |
| [src/core/sanitization-rules.test.ts](../../src/core/sanitization-rules.test.ts) | Edit — keep existing redact-credentials tests; add full strip-personal coverage |
| [src/core/bundle-schema.ts](../../src/core/bundle-schema.ts) | Edit — add `sourceHomedir`, `wasRedacted`; bump version to 1.1.0 |
| [src/commands/export-selection.ts](../../src/commands/export-selection.ts) | Edit — `buildBundle` accepts and populates `sourceHomedir` |
| [src/services/claude-locator.ts](../../src/services/claude-locator.ts) | Edit — add `getSourceHomedir()` export that calls `os.homedir()` (existing whitelisted call site) |
| [tests/fixtures/bundles/*.json](../../tests/fixtures/bundles) | Edit — update every fixture for the new schema |
| [vitest.config.ts](../../vitest.config.ts) | Edit — add 100% per-file threshold for `sanitization-rules.ts` |
| [docs/bundle-format.md](../../docs/bundle-format.md) | New or defer (see Task 8.3) |

### Key technical decisions

**Why extend `BundleSchema` with `sourceHomedir`?** The strip-personal profile needs to identify "absolute paths under the source machine's home directory" for permission rules, MCP commands, and `.claude.json` paths. Inferring sourceHomedir at sanitization time from `bundle.projects[].originalPath` longest-common-prefix is brittle and fails on bundles with no projects or projects under unusual roots. The cleanest interpretation of the AC text ("source machine's home directory") is to capture the homedir at export time and store it on the bundle. This also forward-compatibly supports the import-side path remapping (Epic 2) — the source homedir is the natural complement to `sourcePlatform`.

**Why bump `BUNDLE_FORMAT_VERSION` to 1.1.0?** Adding a required field is a backwards-incompatible schema change. The bundle parser's version-mismatch handling currently emits a warning rather than an error (per Story 1.6 design), so old bundles will warn but not break at parse time — but they'll fail Zod parse on the missing required field. That's the intended failure: cmemmov should not silently accept pre-1.1.0 bundles that lack `sourceHomedir`, because the strip-personal profile cannot produce a safe result from them.

**Why declarative profile not a callable per-category-strategy table?** The AC text explicitly says "declarative data structures, not procedural code." A literal-string discriminator (`'preserve' | 'strip' | 'partial'`) keeps the profile inspectable in tests and viewable in the Story 4.2 `share` preview UI without invoking any logic. The per-category helpers consume the discriminator (via `if (profile.globalMemory === 'partial') ...` or a switch). This separation makes the contract reviewable as data.

**Why `wasRedacted` as a top-level optional object (not on the existing `credentials.wasRedacted` boolean)?** The existing `credentials.wasRedacted: boolean` is scoped to credentials-only. Strip-personal records a much wider set of redactions (personal memory files, home-dir permission rules, local MCP servers, claude-json fields). A new top-level `wasRedacted` field is the cleanest extension. The existing `credentials.wasRedacted` field is preserved for backwards compatibility — `strip-personal` sets both it AND `wasRedacted.credentials`.

**Why expose `PERSONAL_FILENAME_PATTERNS` as a constant?** Story 4.2's `share` command needs to render an interactive preview of files that would be stripped, AND its `--include-pattern` / `--exclude-pattern` flags need to compose against the same canonical pattern set. Defining patterns inline inside the strip helper would force Story 4.2 to either duplicate the regex literals (drift risk) or import a non-exported helper (encapsulation break). Top-level export is the single source of truth.

**Why minimal YAML frontmatter scan instead of a YAML library?** The frontmatter check is ONE field (`personal: true`) at the top of the file between `---` delimiters. A YAML library adds a dep, parsing latency, and a wider attack surface (YAML can be exploited). A 5-line line-scan is sufficient.

**Why case-insensitive `pathStartsWith` on win32?** Windows filesystem semantics are case-insensitive; `C:\Users\Josh` and `c:\users\josh` reference the same directory. The strip predicate must match either. POSIX (`linux`/`darwin`) keeps case-sensitive comparison.

**Why ALL_CATEGORIES + 'credentials' + 'claudeJson'?** The decision-schema's `ALL_CATEGORIES` does not include `'credentials'` (credentials live at the bundle root, not as a Claude category) or `'claudeJson'` (per the schema's own comment: "claudeJson is exported unconditionally; lives in the union solely for writer-side type safety"). For the sanitization profile, both ARE relevant decisions — credentials are stripped, claudeJson is partially filtered. The profile interface explicitly enumerates 12 fields to cover them.

### Previous story intelligence (Story 4.0 takeaways)

- **Fail loudly before side effects** (Epic 3 retro carry-forward): If `bundle.sourceHomedir` is missing on a pre-1.1.0 bundle, the parser already rejects it via the Zod schema. The sanitization helpers can therefore trust `bundle.sourceHomedir` is a non-empty string. Document this assumption in inline comments rather than re-validating at every call site.
- **`readSettingsFileStrict` pattern (Story 3.0)**: Not directly applicable here (sanitization-rules.ts doesn't touch the filesystem), but the broader principle — distinguish absent from malformed, throw loudly on malformed — applies to `stripClaudeJsonUserFields`: if `claudeJson` is non-undefined but is not a plain object (string, array, null), the helper should return `{ kept: undefined, strippedFields: [] }` rather than throwing (the field's malformed shape is upstream's problem; sanitization removes it conservatively).
- **No-raw-json-parse rule (Epic 1)**: `sanitization-rules.ts` is NOT in the rule's allowlist. If you need to parse anything (e.g., the YAML frontmatter), use a line-scan, not `JSON.parse` of a stringified embedded JSON.

### Critical constraints (DO NOT VIOLATE)

1. **NFR6 — credentials are NEVER preservable under `'strip-personal'`.** The TypeScript type system AND a runtime test must make it impossible to construct a `'strip-personal'` profile that preserves credentials. The profile's `credentials` field is typed `'strip'` literally (not `CategoryDecision`) for that single profile, OR the runtime helper invariant-throws if `profile.credentials !== 'strip'` for the strip-personal name.
2. **`os.homedir()` is reserved for `claude-locator.ts`** (`no-restricted-imports` ESLint rule). The locator file is the one place this import is allowed; expose a `getSourceHomedir()` export from there and consume it everywhere else.
3. **`console.*` is banned outside `src/ui/output.ts`.** `sanitization-rules.ts` does NOT emit progress lines; it returns data. The `share` command (Story 4.2) is responsible for surfacing the `wasRedacted` record to the user via `Output.progress` / `Output.warn`.
4. **`JSON.parse` of bundle bytes is reserved for `bundle-parser.ts`** — the sanitization module operates on already-parsed Bundle objects. Do not re-parse.
5. **Bundle immutability**: existing tests at [sanitization-rules.test.ts:16-22](../../src/core/sanitization-rules.test.ts#L16) assert input is not mutated. The strip-personal path must preserve this property — return a new bundle object, deep-copy only the modified sub-trees, share identity for unchanged tops.
6. **Story 4.2 dependency**: This story's exports (`PERSONAL_FILENAME_PATTERNS`, `applySanitization`, `SANITIZATION_PROFILES['strip-personal']`, `bundle.wasRedacted`) are the contract Story 4.2 will consume. Don't rename, restructure, or hide them after the fact.

### Deferred (not in scope for 4.1)

- `cmemmov share` command itself — Story 4.2
- `--include-pattern` / `--exclude-pattern` flag handling — Story 4.2 (Story 4.1 only provides the canonical pattern constant)
- Interactive preview UI — Story 4.2
- Integration tests for round-trip strip→share→import — Story 4.3
- Documentation in `docs/bundle-format.md` — Story 5.4 unless trivially added in Task 8.3

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- **Platform-aware path helpers**: Added `platform` parameter to `stripHomedirPermissionRules` and `stripLocalMcpServers`; `applyStripPersonal` passes `bundle.sourcePlatform` instead of `process.platform`. This was required because the test suite runs on win32 but tests linux path semantics.
- **claudeJson MCP processing order**: `claudeJson.mcpServers` is processed and recorded to `wasRedacted.localMcpServers` BEFORE `stripClaudeJsonUserFields` is called (which would otherwise remove the `mcpServers` key from the object before we could inspect it).
- **`older-bundle-version.cmemmov` not updated**: Left at v0.9.0 with no `sourceHomedir` field. This is intentional — Zod rejects it with `BUNDLE_INVALID_SCHEMA` since `sourceHomedir` is now required. Tests updated to expect this failure rather than the old "warn and succeed" behavior.
- **`posix.sep` for non-win32 path check**: `isAbsolutePath` uses `posix.sep` for the linux/darwin branch to satisfy the `cmemmov/no-hardcoded-separator` ESLint rule.
- **SHA256 hashes recomputed**: `.cmemmov` fixture files required recomputed integrity hashes after adding `sourceHomedir` field. Used a temporary script to mimic Zod's key-ordering for the canonical hash input.
- **`docs/bundle-format.md` does not exist**: `PERSONAL_FILENAME_PATTERNS` documentation deferred to Story 5.4.

### File List

- `src/core/bundle-schema.ts` — added `sourceHomedir`, `wasRedacted`, bumped version to `1.1.0`
- `src/core/sanitization-rules.ts` — complete rewrite: declarative profiles, per-category helpers, `applySanitization`
- `src/core/sanitization-rules.test.ts` — full strip-personal coverage (57 new tests)
- `src/services/claude-locator.ts` — added `getSourceHomedir()`
- `src/commands/export-selection.ts` — `buildBundle` accepts and populates `sourceHomedir`
- `src/commands/export.ts` — passes `getSourceHomedir()` to `buildBundle`
- `src/commands/export.test.ts` — added `getSourceHomedir` mock
- `src/commands/export-selection.test.ts` — added `sourceHomedir` to all `buildBundle` calls
- `src/commands/import.test.ts` — updated `makeBundle` to v1.1.0 with `sourceHomedir`
- `src/services/bundle-serializer.test.ts` — updated `makeBundle` to v1.1.0 with `sourceHomedir`
- `src/services/bundle-parser.test.ts` — updated tests for new Zod rejection of old bundles; added future-version warning test
- `src/core/bundle-schema.test.ts` — updated version constant assertion
- `tests/fixtures/bundles/*.json` — all valid fixtures updated to v1.1.0 with `sourceHomedir`
- `tests/fixtures/bundles/valid-linux.cmemmov` — updated with new integrity hash
- `tests/fixtures/bundles/valid-windows.cmemmov` — updated with new integrity hash
- `tests/fixtures/bundles/corrupted-checksum.cmemmov` — updated with `sourceHomedir`
- `vitest.config.ts` — added 100% line+branch threshold for `sanitization-rules.ts`

### Review Findings

- [x] Review `patch`: win32 slash normalization gap in `pathStartsWith` — AC4 says strip is independent of separator style, but the old implementation did case-fold only; `C:/Users/Josh/file` would not match `C:\Users\Josh` sourceHomedir. Fixed by normalizing both `/` and `\` to `posix.sep` before comparison. Added test `win32 forward-slash path in rule matches backslash sourceHomedir`. `src/core/sanitization-rules.ts:117`, `src/core/sanitization-rules.test.ts`
- [x] Review `defer`: `_allCategoriesCheck` compile-time guard is one-directional — deferred, pre-existing design choice; runtime AC9 test covers the reverse direction
- [x] Review `defer`: `_compute_hashes.mjs` orphan scratch tool at repo root — deleted + added to `.gitignore`; no impact on tests or build
