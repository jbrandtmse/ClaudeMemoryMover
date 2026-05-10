# Story 3.0: Epic 2 Deferred Cleanup

Status: done

## Story

As a cmemmov developer,
I want the quality issues deferred from Epic 2 resolved and the preparation tasks for Epic 3 completed,
so that Epic 3 feature stories start from a clean, correctly documented, and locally testable baseline.

## Triage Table (Epic 2 Retro → Story 3.0)

| # | Item | Source | Decision | Rationale |
|---|------|---------|----------|-----------|
| R1 | Correct AC #3 wording in epics.md Story 2.4 (slug encoding wrong) | Epic 2 Retro (HIGH) | **Include** | Story 3.1 references slug behavior; incorrect AC would mislead dev agent |
| R2 | Architecture doc review pass | Epic 2 Retro (HIGH) | **Include** | Two errors found in Epic 2; validate before Story 3.1 spec |
| R3 | Add `npm run lint` to dev agent workflow guidelines | Epic 2 Retro (LOW) | **Drop** | Process note only; no code action needed; `npm run check` already includes lint |
| D1 | `no-process-env-home` misses destructuring + computed `process['env']` bypass | story-1.2 (MEDIUM) | **Include** | Epic 3 adds new command code; undetected bypasses undermine the rule |
| D2 | `no-console-outside-output` doesn't block `info/debug/trace/table/dir` | story-1.2 (MEDIUM) | **Include** | Architectural intent is all writes route through Output; Epic 3 adds new code |
| D3 | `deepMerge` Set-dedup uniform for object arrays (produces duplicates for objects) | story-1.7 (MEDIUM) | **Include** | Story 3.3 updates `.claude.json` via claude-writer; object-array merge must be correct |
| D4 | Corrupt `settings.json` silently treated as `{}` | story-1.7 (MEDIUM) | **Include** | Story 3.3 reads/updates `.claude.json`; corrupt file should fail loudly not silently |
| D5 | `applyPlugins` always writes `plugins.json` (ignores dir form) | story-1.7 (MEDIUM) | **Defer to Epic 4** | Epic 4 (team sharing) is the consumer; no Epic 3 touchpoint |
| D6 | `applyTeams` merge lacks id-less team config behavior | story-1.7 (MEDIUM) | **Defer to Epic 4** | Epic 4 (team sharing) is the consumer |
| D7 | AC5 rollback: only detects empty-directory corruption, not truncated files | story-1.12 (MEDIUM) | **Defer to Epic 5** | Backup hardening is release-prep scope; Epic 3 uses backup service as-is |
| D8 | Canonical key-order bug in `buildBundle` | story-1.13 (MEDIUM) | **Drop** | Already fixed in Story 2.0 (`return BundleSchema.parse(bundle)`) |
| D9 | AC12 filesystem allowlist — no automated test | story-1.13 (MEDIUM) | **Defer to Epic 5** | Security hardening pass; not blocking Epic 3 functionality |
| D10 | `claudeJson` deep-merge unions `recentProjects` (stale path leak) | story-2.0 (MEDIUM) | **Include** | Story 3.3 updates `.claude.json`; stale cross-machine paths affect fix-paths correctness |
| D11 | `bundle.global.claudeJson` may carry sensitive MCP content | story-2.0 (MEDIUM) | **Defer to Epic 4** | `share` command sanitization (Story 4.1) is the right home |
| D12 | vitest 2.1.2 + Node v22.20.0 incompat blocks local `npm run check` | story-2.0 (MEDIUM) | **Include** | Blocks all local testing; must be resolved before Epic 3 test writing |
| D13 | AC6 ESLint test-file exemption scope deviation needs ratification | story-1.5 (LOW-MEDIUM) | **Include** | Needs architect ratification; more test code added every epic |

## Acceptance Criteria

### AC1 — Correct `epics.md` Story 2.4 AC #3 slug encoding wording

**Given** the statement in `epics.md` Story 2.4 AC #3: _"project directories under target `~/.claude/projects/` use the target-OS slug encoding"_
**When** the wording is corrected
**Then** the statement reads: _"project directories under target `~/.claude/projects/` retain the source slug as the stable directory identifier; the directory name does NOT change on cross-OS import"_
**And** a dev-note addendum is appended to the corrected AC explaining: the source slug is stable because `pathToSlug` applied to the source path produces the canonical key for that project's history; renaming would orphan memories and session files

### AC2 — Architecture doc review pass

**Given** `_bmad-output/planning-artifacts/architecture.md`
**When** reviewed against the actual implementations from Stories 2.0–2.4
**Then** the following known gaps are verified fixed or corrected:
- `suggestRemap` return type shown as `string | null` (already fixed in review during Story 2.1; verify the current architecture still shows `string | null`)
- Any `eslint-plugin-cmemmov/` references replaced with `eslint-rules/` (flagged in story-1.1 deferred work)
- `tsconfig.json: resolveJsonModule: true` addition acknowledged (flagged in story-1.3)
- Test-file ESLint exemption (`src/**/*.test.ts`) documented in the "Code Quality" section or noted as ratified
**And** if no remaining drift is found, a single line `[Architecture review: no remaining drift found — 2026-05-09]` is appended to the `## Revision History` section (or created if absent)

### AC3 — `no-process-env-home` rule: add destructuring bypass detection

**Given** `eslint-rules/no-process-env-home.js`
**When** a developer writes `const { HOME } = process.env;`
**Then** the rule reports `useOsHomedir` on the `ObjectPattern` / `VariableDeclarator` node

**Given** `eslint-rules/no-process-env-home.js`
**When** a developer writes `process['env'].HOME`
**Then** the rule reports `useOsHomedir` (computed `env` access via `Literal` instead of `Identifier`)

**Given** `tests/eslint-rules/no-process-env-home.test.ts`
**When** the test suite runs
**Then** it adds two new `invalid` cases:
- `{ code: "const { HOME } = process.env;", errors: [{ messageId: 'useOsHomedir' }] }`
- `{ code: "const h = process['env'].HOME;", errors: [{ messageId: 'useOsHomedir' }] }`
**And** adds two `valid` cases to confirm non-bypass patterns still pass:
- `{ code: "const { PATH } = process.env;" }` (non-HOME destructure — should be allowed)
- `{ code: "const { HOME } = myObj;" }` (non-process.env destructure — should be allowed)

### AC4 — `no-console-outside-output` rule: expand banned identifiers

**Given** `eslint-rules/no-console-outside-output.js`
**When** a developer writes `console.info(...)`, `console.debug(...)`, `console.trace(...)`, `console.table(...)`, or `console.dir(...)` outside `src/ui/output.ts`
**Then** the rule reports `useOutputModule`

**Given** the expanded `BANNED_IDENTIFIERS` set
**When** I inspect the file
**Then** it reads: `new Set(['log', 'error', 'warn', 'info', 'debug', 'trace', 'table', 'dir'])`

**Given** `tests/eslint-rules/no-console-outside-output.test.ts`
**When** the test suite runs
**Then** it adds invalid cases for each of the five new identifiers: `console.info`, `console.debug`, `console.trace`, `console.table`, `console.dir`

### AC5 — Bump vitest to resolve Node v22.20.0 test-suite-discovery regression

**Given** `package.json`
**When** vitest and @vitest/coverage-v8 versions are updated
**Then** both are at `^2.1.5` (or the latest 2.x patch that fixes the Node 22.12+ regression; at time of writing this is `2.1.8`)
**And** `npm run check` (lint + typecheck + full test suite) completes cleanly under Node v22.20.0 with no "No test suite found" errors

### AC6 — `deepMerge` string-vs-object array strategy

**Given** `src/services/claude-writer.ts::deepMerge`
**When** both `existing` and `val` are arrays
**Then** if all elements in both arrays are strings: de-dupe via `Set` (existing behavior for permission rules)
**And** if either array contains non-string elements: replace `existing` with `val` (incoming wins; no reference-equality dedup that silently produces logical duplicates for object arrays like hooks)

**Given** the updated `deepMerge`
**When** `src/services/claude-writer.test.ts` runs
**Then** a new test asserts: `deepMerge({ hooks: [{ cmd: 'a' }] }, { hooks: [{ cmd: 'a' }] })` equals `{ hooks: [{ cmd: 'a' }] }` (object array replaced, NOT doubled to `[{ cmd: 'a' }, { cmd: 'a' }]`)
**And** existing string-array de-dup tests still pass

### AC7 — `applySettingsAt` distinguishes absent from malformed

**Given** `src/services/claude-writer.ts::applySettingsAt`
**When** the target file exists but contains malformed JSON (parse failure)
**Then** it throws `CmemmovError({ code: 'INTERNAL', hint: 'settings file is malformed; restore from backup or fix manually before importing: <filePath>' })`
**And** no write occurs (the malformed file is NOT silently overwritten)

**Given** `src/services/claude-writer.ts::applySettingsAt`
**When** the target file does NOT exist (ENOENT)
**Then** behavior is unchanged: treat as `{}` (empty base) and write the incoming data

**Given** `src/services/claude-writer.test.ts`
**When** the test suite runs
**Then** a new test covers: `applySettingsAt` with an existing corrupt JSON file → throws `INTERNAL`; gate.write is NOT called

**Dev Note:** `readClaudeJsonFile` (from `claude-reader.ts`) currently returns `undefined` for both ENOENT and parse failure. Check its implementation — if it swallows parse errors, the fix must either: (a) modify `readClaudeJsonFile` to distinguish the two cases, or (b) use a direct `readFile` + `JSON.parse` in `applySettingsAt` with explicit error branching. Prefer (b) to avoid changing the reader contract; the reader's `undefined` = "not found" semantic is used widely.

### AC8 — `claudeJson` `recentProjects` treated as replace-not-union

**Given** `src/services/claude-writer.ts::applyClaudeJson`
**When** the bundle's `claudeJson` contains a `recentProjects` array
**Then** the merged result always uses the incoming `recentProjects` verbatim (replace semantics), NOT the `deepMerge` union of existing + incoming
**And** all other `claudeJson` fields continue to use standard `deepMerge` semantics

**Given** `src/services/claude-writer.test.ts`
**When** the test suite runs
**Then** a new test asserts: target `~/.claude.json` with `recentProjects: ['/old/path']` + import of `claudeJson` with `recentProjects: ['/new/path']` → result has `recentProjects: ['/new/path']` only (stale path not retained)

**Dev Note:** The cleanest implementation: after calling `applySettingsAt`, do NOT use it directly for `claudeJson`. Instead, in `applyClaudeJson`: (a) if mode is `overwrite`, call `applySettingsAt` as today; (b) if mode is `merge`, do the deep-merge manually but override `result.recentProjects = incoming.recentProjects ?? existing.recentProjects`. Alternatively: pass a `arrayReplacementKeys: string[]` option to `deepMerge` to replace (not union) for named keys. Either approach is acceptable.

### AC9 — `npm run check` passes clean

**Given** all changes in this story
**When** `npm run check` runs (lint + typecheck + test suite)
**Then** it exits 0 with no errors, no TypeScript complaints, and no skipped tests related to this story's changes

### AC10 — Test-file ESLint exemption ratified and documented

**Given** the `src/**/*.test.ts` exemption in `eslint.config.js` for the `no-raw-fs-access` rule (added in Story 1.5 to allow direct `fs/promises` usage in test fixture setup)
**When** this story completes
**Then** a comment is added in `eslint.config.js` at the exemption site explaining: `// Test files need direct fs access for fixture setup/mock injection; exemption ratified in Story 3.0`
**And** the architecture doc's "Code Quality" section (or an appropriate subsection) notes: "Unit and integration test files are exempt from `no-raw-fs-access`; all test fixture setup that requires direct fs access is acceptable in `*.test.ts` files"

## Tasks / Subtasks

- [x] Task 1 — Correct `epics.md` Story 2.4 AC #3 wording (AC: #1)
  - [x] 1.1 Open `_bmad-output/planning-artifacts/epics.md`, locate the AC #3 block under `### Story 2.4: Cross-OS Integration Tests`
  - [x] 1.2 Change: _"project directories under target `~/.claude/projects/` use the target-OS slug encoding"_
  - [x] 1.3 To: _"project directories under target `~/.claude/projects/` retain the source slug as the stable directory identifier — the directory name does NOT change on cross-OS import (slugs are content-addressing keys; renaming would orphan memories and session history)"_

- [x] Task 2 — Architecture doc review pass (AC: #2, #10 partial)
  - [x] 2.1 Search `architecture.md` for `suggestRemap` — verify return type is `string | null` (already corrected in Story 2.1 review; confirm)
  - [x] 2.2 Search `architecture.md` for `eslint-plugin-cmemmov` — if found, replace with `eslint-rules`
  - [x] 2.3 Search `architecture.md` for `tsconfig` snippets — verify `resolveJsonModule: true` is present or noted as added in Story 1.3
  - [x] 2.4 Add `## Revision History` section at the bottom if missing, or append `[Architecture review pass — Story 3.0 — 2026-05-09: verified no remaining drift from Stories 2.0–2.4]`
  - [x] 2.5 Add test-file ESLint exemption note to architecture's Code Quality section (AC: #10)

- [x] Task 3 — ESLint rule: `no-process-env-home` (AC: #3)
  - [x] 3.1 In `eslint-rules/no-process-env-home.js`, add a `VariableDeclarator` visitor that detects `const { HOME } = process.env` patterns:
    - Visit `VariableDeclarator` where `init` is `process.env` (`MemberExpression: process → env`)
    - Walk `id.properties` (if `id` is `ObjectPattern`) and report any `Property` whose key resolves to `'HOME'`
  - [x] 3.2 In the existing `MemberExpression` visitor, also allow the `env` access to be a computed `Literal`: change `node.object.property.type === 'Identifier' && node.object.property.name === 'env'` to also accept `node.object.property.type === 'Literal' && node.object.property.value === 'env'`
  - [x] 3.3 Update `tests/eslint-rules/no-process-env-home.test.ts` with new `invalid` and `valid` cases per AC #3

- [x] Task 4 — ESLint rule: `no-console-outside-output` (AC: #4)
  - [x] 4.1 In `eslint-rules/no-console-outside-output.js`, change `BANNED_IDENTIFIERS` to:
    ```js
    const BANNED_IDENTIFIERS = new Set(['log', 'error', 'warn', 'info', 'debug', 'trace', 'table', 'dir']);
    ```
  - [x] 4.2 Update `tests/eslint-rules/no-console-outside-output.test.ts` with invalid cases for each of the five new identifiers

- [x] Task 5 — Bump vitest (AC: #5)
  - [x] 5.1 In `package.json`, update `"vitest": "2.1.2"` to `"vitest": "^2.1.8"` (or latest stable 2.x)
  - [x] 5.2 Update `"@vitest/coverage-v8": "2.1.2"` to match the same version
  - [x] 5.3 Run `npm install` to update `package-lock.json`
  - [x] 5.4 Run `npm run check` and verify no "No test suite found" error on Node v22

- [x] Task 6 — `deepMerge` string-vs-object array strategy (AC: #6)
  - [x] 6.1 In `src/services/claude-writer.ts::deepMerge`, branch on whether all elements are strings (Set-dedup) vs replace incoming for object arrays
  - [x] 6.2 Update comment from "Permission rules and similar string arrays" to "String arrays (permission rules, etc.)"
  - [x] 6.3 Add test in `src/services/claude-writer.test.ts`: object-array replaced not doubled (AC #6)

- [x] Task 7 — `applySettingsAt` malformed file detection (AC: #7)
  - [x] 7.1 Implementation note: introduced `readSettingsFileStrict` in `claude-reader.ts` (returns `undefined | object | 'malformed'`) and a thin `readSettingsForMerge` wrapper in `claude-writer.ts` that throws `CmemmovError({code: 'INTERNAL', ...})` on `'malformed'`. This keeps `JSON.parse` calls inside the existing whitelisted `claude-reader.ts` per the `no-raw-json-parse` invariant — preferred over inlining a raw `JSON.parse` in `claude-writer.ts`, which would have required adding `claude-writer.ts` to the rule's allowlist.
  - [x] 7.2 Import `CmemmovError` from `'../core/error.js'` in `claude-writer.ts`
  - [x] 7.3 Add test in `src/services/claude-writer.test.ts`: corrupt JSON → throws INTERNAL; write not called (AC #7)

- [x] Task 8 — `applyClaudeJson` replace `recentProjects` (AC: #8)
  - [x] 8.1 In `src/services/claude-writer.ts::applyClaudeJson`, for merge mode, deep-merge then override `recentProjects` with incoming verbatim
  - [x] 8.2 Add test in `src/services/claude-writer.test.ts`: stale `recentProjects` replaced, not unioned (AC #8); also updated the existing merge-precedence test to assert replace-not-union

- [x] Task 9 — Add test-file ESLint exemption comment (AC: #10)
  - [x] 9.1 In `eslint.config.js`, at the test-file ignore entry for `no-restricted-imports`, added inline comment: `// test files need direct fs access for fixture setup — exemption ratified Story 3.0`
  - [x] 9.2 In architecture doc `Code Quality` section, added note that `src/**/*.test.ts` and `tests/**/*.test.ts` are exempt from `no-restricted-imports`

- [x] Task 10 — Final validation (AC: #9)
  - [x] 10.1 `npm run check` exits 0 (lint clean, typecheck clean, 428 passed / 2 skipped pre-existing)
  - [x] 10.2 `npm run coverage:run` clean — per-file thresholds preserved (path-engine 100%, bundle-schema 100%, error 100%; claude-writer 93.88%, claude-reader 87.64%)

## Dev Notes

### File locations (all relative to project root)

| File | Change type |
|------|-------------|
| `_bmad-output/planning-artifacts/epics.md` | Edit — AC #3 wording fix |
| `_bmad-output/planning-artifacts/architecture.md` | Edit — review pass + exemption note |
| `eslint-rules/no-process-env-home.js` | Edit — destructuring + computed-env detection |
| `tests/eslint-rules/no-process-env-home.test.ts` | Edit — new test cases |
| `eslint-rules/no-console-outside-output.js` | Edit — BANNED_IDENTIFIERS expansion |
| `tests/eslint-rules/no-console-outside-output.test.ts` | Edit — new test cases |
| `package.json` | Edit — vitest bump |
| `package-lock.json` | Auto-updated by npm install |
| `src/services/claude-writer.ts` | Edit — deepMerge, applySettingsAt, applyClaudeJson |
| `src/services/claude-writer.test.ts` | Edit — new test cases for AC #6, #7, #8 |
| `eslint.config.js` | Edit — exemption comment |

### Key context from Epic 2

**`no-process-env-home` current gaps:**
The rule's `MemberExpression` visitor handles `process.env.HOME` (Identifier) and `process.env['HOME']` (Literal) correctly. It does NOT handle:
1. Destructuring: `const { HOME } = process.env` — requires a `VariableDeclarator` visitor
2. Computed env access: `process['env'].HOME` — the guard `node.object.property.type === 'Identifier' && node.object.property.name === 'env'` rejects Literal `'env'`

**`no-console-outside-output` current state:**
`BANNED_IDENTIFIERS = new Set(['log', 'error', 'warn'])`. The architectural intent (all stdout/stderr writes route through the Output module) is wider — add `info`, `debug`, `trace`, `table`, `dir`.

**`deepMerge` current implementation (lines ~210–223 of `claude-writer.ts`):**
```ts
if (Array.isArray(existing) && Array.isArray(val)) {
  result[key] = [...new Set([...(existing as unknown[]), ...(val as unknown[])])];
}
```
Set de-dup works for strings (permission rules), but for object arrays (e.g., hook objects) it uses reference equality — two logically identical objects from different merges would both be retained. Fix: branch on whether all elements are strings.

**`applySettingsAt` current implementation (lines ~343–357 of `claude-writer.ts`):**
```ts
const existing = (await readClaudeJsonFile(filePath)) ?? {};
```
`readClaudeJsonFile` returns `undefined` for both ENOENT and JSON parse failure. Fix: use `safeReadFile` (already in scope in the file) + explicit `JSON.parse` with error branching.

**`applyClaudeJson` flow:**
Currently delegates to `applySettingsAt(filePath, data, opts.mode, opts.gate)` for all modes. For merge mode, `applySettingsAt` calls `deepMerge(existing, incoming)`, which unions `recentProjects` arrays. Fix: override `recentProjects` with incoming value after the merge.

**vitest regression:**
vitest `2.1.2` with Node `v22.20.0` (which ships Node `v22.12+` internals) fails test-suite discovery with "No test suite found in file" for every `.test.ts`. The fix is a vitest bump to `≥ 2.1.5`.

### Deferred items logged to `deferred-work.md`

The following MEDIUM items from deferred-work.md are explicitly deferred and will remain in that file:
- `applyPlugins` dir-form detection → Defer to Epic 4
- `applyTeams` id-less team config → Defer to Epic 4
- AC5 rollback truncated-file detection → Defer to Epic 5
- AC12 filesystem allowlist automated test → Defer to Epic 5
- `bundle.global.claudeJson` sensitive MCP content → Defer to Epic 4

No new `deferred-work.md` entries expected from this story (all items are either resolved here or logged above).

## Dev Agent Record

### Implementation Plan

Worked Tasks 1 → 10 in declared order. The only design call worth flagging is Task 7's helper placement: AC7's Dev Note suggested either (a) modifying `readClaudeJsonFile` to distinguish ENOENT from parse failure, or (b) inlining a `safeReadFile` + `JSON.parse` in `applySettingsAt`. Option (b) would have required either adding `src/services/claude-writer.ts` to the `no-raw-json-parse` rule's allowlist (architectural drift) or disabling the rule inline (smell). Instead I introduced a NEW reader, `readSettingsFileStrict`, alongside the existing `readClaudeJsonFile` — same file (`claude-reader.ts`, already whitelisted), different contract (`undefined | object | 'malformed'`). The legacy reader's silent-undefined-on-parse-failure semantic is preserved verbatim for its current consumers (`teams`/`plugins`/`mcpConfig` apply paths, all of which intentionally treat malformed config files as missing).

### Completion Notes

- AC1 — epics.md Story 2.4 AC #3 corrected; appended a Story 3.0 dev-note explaining slug stability rationale.
- AC2 — architecture.md: `suggestRemap` return type confirmed as `string | null` (line 678, no change needed); `eslint-plugin-cmemmov/` references replaced with `eslint-rules/` (Code Quality section + Enforcement table); added Code Quality bullet explicitly noting `tsconfig.json: resolveJsonModule: true` (Story 1.3); appended a `## Revision History` section with the dated review-pass entry.
- AC3 — `no-process-env-home`: factored `isProcessEnv()` helper to handle both `process.env` (Identifier) and `process['env']` (Literal); added `VariableDeclarator` visitor walking `ObjectPattern.properties` for `HOME`; tests now cover both bypass forms plus two new valid cases (non-HOME destructure of `process.env`, and HOME destructure from a non-process-env object).
- AC4 — `no-console-outside-output`: `BANNED_IDENTIFIERS` expanded to `['log', 'error', 'warn', 'info', 'debug', 'trace', 'table', 'dir']`; tests exercise all five new identifiers as `invalid` and verify `output.ts` exemption still holds for `info`/`debug`.
- AC5 — vitest + @vitest/coverage-v8 bumped from `2.1.2` → `^2.1.8`. `npm run check` runs cleanly under Node v22.20.0; no "No test suite found" errors.
- AC6 — `deepMerge` array branch: branched on `allStrings` to keep Set-dedup semantics for permission rules while replacing object arrays with incoming. Test `merge: object arrays are replaced, not Set-deduped` confirms `deepMerge({hooks: [{cmd: 'a'}]}, {hooks: [{cmd: 'a'}]})` → `[{cmd: 'a'}]`, not doubled.
- AC7 — `readSettingsFileStrict` (new in `claude-reader.ts`) returns `undefined` (ENOENT), the parsed object (success), or `'malformed'` (parse failure). `claude-writer.ts::readSettingsForMerge` throws `CmemmovError({code: 'INTERNAL', hint: 'settings file is malformed; ...'})` on `'malformed'`. New test asserts the corrupt-JSON path throws INTERNAL and that no write op is captured.
- AC8 — `applyClaudeJson` merge mode now does `deepMerge(existing, data)` then unconditionally overrides `merged.recentProjects = data.recentProjects` whenever `data` declares the field. Updated the existing `merge: deep-merges with existing .claude.json` test to assert `recentProjects` is replaced (was previously asserting Set-union), and added a dedicated AC8 test using the object-shaped `recentProjects` (`{path, lastOpened}`) to mirror real Claude Code on-disk shape.
- AC9 — `npm run check` passes (lint, typecheck, 428 tests pass / 2 pre-existing skipped). `npm run coverage:run` passes with no per-file regressions.
- AC10 — Inline comment added at the test-file ignore site in `eslint.config.js`; architecture doc Code Quality section now states `*.test.ts` files are exempt from `no-restricted-imports` (the actual rule name guarding direct fs access in this codebase).

### Issues encountered

1. **Initial lint failures after Task 7 implementation** — first cut inlined `JSON.parse` directly in `claude-writer.ts`, tripping the `cmemmov/no-raw-json-parse` invariant rule (per Epic 1 architecture: `JSON.parse` of config bytes must live in `claude-reader.ts` or `bundle-parser.ts`). Resolved by creating `readSettingsFileStrict` in the existing whitelisted reader file rather than adding a new exception. Same fix also addressed an unrelated `@typescript-eslint/no-unnecessary-type-assertion` from a redundant `(merged as Record<string, unknown>)` in `applyClaudeJson`.

2. **Existing `merge: deep-merges with existing .claude.json` test broke after AC8** — that test asserted Set-union of `recentProjects` (the pre-Story 3.0 behavior). Updated the assertion to require replace-not-union; the change is in scope for AC8 since the old assertion encoded the bug being fixed.

3. **No new `deferred-work.md` entries** — all included items are resolved here; deferred-to-Epic-4/Epic-5 items (D5/D6/D7/D9/D11) remain in `deferred-work.md` (no edits needed).

## File List

| Path | Change |
|------|--------|
| `_bmad-output/implementation-artifacts/3-0-epic-2-deferred-cleanup.md` | Edit (this file — status, tasks, Dev Agent Record) |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | Edit — story 3-0 ready-for-dev → in-progress → review |
| `_bmad-output/planning-artifacts/epics.md` | Edit — Story 2.4 AC #3 wording corrected + dev note (AC1) |
| `_bmad-output/planning-artifacts/architecture.md` | Edit — Code Quality section refreshed; Revision History section added (AC2, AC10) |
| `eslint-rules/no-process-env-home.js` | Edit — destructuring + computed-env detection (AC3) |
| `tests/eslint-rules/no-process-env-home.test.ts` | Edit — 2 new invalid + 2 new valid cases (AC3) |
| `eslint-rules/no-console-outside-output.js` | Edit — BANNED_IDENTIFIERS expanded (AC4) |
| `tests/eslint-rules/no-console-outside-output.test.ts` | Edit — 5 new invalid + 2 new valid cases (AC4) |
| `package.json` | Edit — vitest + @vitest/coverage-v8 bumped to ^2.1.8 (AC5) |
| `package-lock.json` | Auto-updated by `npm install` (AC5) |
| `src/services/claude-reader.ts` | Edit — new `readSettingsFileStrict` helper (AC7) |
| `src/services/claude-writer.ts` | Edit — `deepMerge` array branch, `readSettingsForMerge`, `applyClaudeJson` recentProjects override (AC6, AC7, AC8) |
| `src/services/claude-writer.test.ts` | Edit — new tests for AC6 / AC7 / AC8; updated existing merge-precedence test for AC8 |
| `eslint.config.js` | Edit — inline test-file exemption comment (AC10) |

## Review Findings (2026-05-09)

Code review pass against the Story 3.0 diff using three review layers (Blind Hunter — diff only; Edge Case Hunter — diff + project; Acceptance Auditor — diff + spec). Two issues patched in-place; four LOW + one out-of-scope MEDIUM logged to `deferred-work.md`.

### Resolved in-place

- **MEDIUM (F1) — `readSettingsFileStrict` returned `{}` for non-object JSON, defeating AC#7's fail-loudly intent.** A `settings.json` containing `[1,2,3]` (top-level array), a primitive, or `null` is structurally wrong for a settings merge — there is no sensible base to merge into. The original implementation returned `{}` for these shapes, which would cause the merger to silently clobber the corrupt-but-recoverable file with the incoming data. Fix: return `'malformed'` for any non-plain-object JSON so `readSettingsForMerge` throws `INTERNAL`. Files: `src/services/claude-reader.ts` (`readSettingsFileStrict`), `src/services/claude-writer.test.ts` (new regression test asserting top-level array → INTERNAL throw, no write).
- **LOW (F2) — Architecture doc claim about test-file exemption was technically misleading.** The Code Quality bullet stated `tests/**/*.test.ts` is "exempt from `no-restricted-imports`" alongside `src/**/*.test.ts`, implying both are exempted by the same mechanism. They aren't: `src/**/*.test.ts` is explicitly listed in the rule block's `ignores`, while `tests/**/*.test.ts` lives outside the rule block's `files: ['src/**/*.ts']` selector and is therefore never matched in the first place. Fix: rewrote the bullet to describe both mechanisms accurately. File: `_bmad-output/planning-artifacts/architecture.md`.

### Deferred (logged to `deferred-work.md` under "code review of story-3.0 (2026-05-09)")

- **MEDIUM — `applyMcpConfig` / `applyTeams` / `applyPlugins` still use the legacy silent-collapse `readClaudeJsonFile`.** Out of scope for Story 3.0 — the Triage Table explicitly defers items D5/D6 to Epic 4; this is the same architectural shape and resolves naturally when those writer paths are reworked. Defer to Epic 4.
- **LOW — `applyClaudeJson` merge override doesn't guard against `null`/`undefined` `recentProjects`.** Real Claude Code never produces these shapes; defer to next touch.
- **LOW — `no-process-env-home` does not catch alias / spread-rest bypasses.** Pre-existing limitation requiring dataflow analysis; same class as the JSON['parse'] bypass already deferred from story-1.2. Defer indefinitely.
- **LOW — AC#4 valid-block parity is partial.** Tests cover `info`/`debug` for `output.ts` but not `trace`/`table`/`dir`. Mechanism is generic; cosmetic-only. Defer to next touch.

### Validation

- `npm run check` passes after patches: lint clean, typecheck clean, **429 tests pass** / 2 pre-existing skipped (one new regression test for F1).
- AC1–AC10 all satisfied; AC#7 fail-loudly invariant is now uniformly enforced for both parse failure AND structural non-object JSON.

## Change Log

- 2026-05-09 — Story 3.0 implemented (Epic 2 deferred cleanup). Resolved retro items R1, R2 and deferred-work items D1, D2, D3, D4, D10, D12, D13. Status: ready-for-dev → in-progress → review.
- 2026-05-09 — Code review pass: F1 (MEDIUM, `readSettingsFileStrict` non-object JSON) and F2 (LOW, architecture-doc accuracy) patched in-place; one out-of-scope MEDIUM and three LOWs deferred to `deferred-work.md`. Tests: 428 → 429.
