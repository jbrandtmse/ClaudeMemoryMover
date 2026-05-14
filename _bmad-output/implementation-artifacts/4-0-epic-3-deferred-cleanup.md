# Story 4.0: Epic 3 Deferred Cleanup

Status: done

## Story

As a cmemmov developer,
I want the alpha-tester bug (session-files layout assumption) and the remaining writer silent-collapse readers resolved,
so that Epic 4 feature stories start from a clean, correctly-tested baseline and the `share`/`import` paths the new command will depend on already use the fail-loudly invariant.

## Triage Table (Epic 3 Retro + bug-2026-05-12 → Story 4.0)

| # | Item | Source | Decision | Rationale |
|---|------|---------|----------|-----------|
| B1 | `resolveOriginalPath` and `readProject` read `<slug>/sessions/*.jsonl` but Claude Code writes JSONLs flat at `<slug>/*.jsonl` | bug-2026-05-12 (HIGH) | **Include** | Bug report explicitly mandates Story 4.0 resolution; breaks `fix-paths` for any hyphenated project name (i.e. nearly every Git repo) |
| B2 | `claude-writer.ts::applySessionHistory` uses the same wrong `<slug>/sessions/` layout | bug-2026-05-12 (HIGH) | **Include** | Symmetric writer fix; without it `export --include-sessions` → `import` round-trip silently drops sessions on real installs |
| B3 | `fix-paths` hard-aborts the whole run on a single undecodable slug | bug-2026-05-12 (MEDIUM) | **Include** | UX failure that carried into the alpha; one undecodable VS Code slug currently aborts the run even with valid `--remap` rules for unrelated projects |
| B4 | Integration test fixtures use the same wrong `<slug>/sessions/` layout, masking the bug | bug-2026-05-12 (MEDIUM) | **Include** | Test layer must reflect on-disk reality so this class of bug cannot recur; add a real-layout fixture |
| D5 | `applyPlugins` always writes `plugins.json` (ignores dir form on disk) | story-1.7 deferred + Epic 3 retro action #1 | **Include** | Retro action #1 explicitly directs to Story 4.0; Epic 4 `share` command must not silently corrupt installs that use the `plugins/<name>/config.json` dir form |
| D6 | `applyTeams` merge has no defined behavior for id-less team configs | story-1.7 deferred + Epic 3 retro action #1 | **Include** | Same Epic 3 retro action; Epic 4 share-flow consumes `applyTeams` so the contract must be explicit before then |
| D14 | Migrate `applyMcpConfig`/`applyTeams`/`applyPlugins` to `readSettingsFileStrict` | cr-3.0 + Epic 3 retro action #4 | **Include** | Retro action #4: "Epic 4 (natural touch)". Last three writers using legacy silent-collapse reader; Epic 4 `share` reads/writes these surfaces; fail-loudly invariant should be uniform before that |
| D11 | `bundle.global.claudeJson` sensitive MCP content (token leaks) | cr-2.0 + Epic 3 retro action #2 | **Defer to Story 4.1** | Belongs to the `strip-personal` sanitization profile (Story 4.1); not a 4.0 cleanup |
| R3 | "Fail loudly before side effects" as explicit AC pattern | Epic 3 retro action #3 | **Carry as process principle** | No 4.0 code change; surface as standing guidance applied to Stories 4.1–4.3 ACs |
| R5 | Continue `epic-cycle` automation pattern | Epic 3 retro action #5 | **Drop** | Process observation, no actionable code item |

## Acceptance Criteria

### AC1 — `resolveOriginalPath` reads JSONLs from the slug dir directly

**Given** [src/services/claude-reader.ts:287](../../src/services/claude-reader.ts#L287) (`resolveOriginalPath`)
**When** scanning for session JSONL files
**Then** the function reads `*.jsonl` entries directly from `join(claudeDir, 'projects', slug)` — NOT from a `sessions/` subdir
**And** entries that are directories (e.g. `<uuid>/` sidecars, `memory/`) are excluded
**And** the most-recent-by-`mtimeMs` JSONL is opened and its first line with a `string`-valued `cwd` field is returned as `{ path: cwd, source: 'sessionCwd' }`
**And** the EBUSY/EPERM → `CmemmovError({ code: 'INTERNAL', hint: 'close Claude Code and retry' })` wrapping remains in place

**Given** a slug dir with zero `*.jsonl` files (only subdirs like `memory/` or no entries)
**When** `resolveOriginalPath` runs
**Then** the function falls through to `slugToPath(slug, process.platform)` as today — `source: 'slugDecode'` (or `source: null` if undecodable)

**Given** a unit test in [src/services/claude-reader.test.ts](../../src/services/claude-reader.test.ts)
**When** the suite runs
**Then** a new test seeds a slug dir with ONE flat `<uuid>.jsonl` whose first line is `{"cwd":"/Users/x/has-hyphens","type":"message"}` and asserts `resolveOriginalPath` returns `{ path: '/Users/x/has-hyphens', source: 'sessionCwd' }` — even though `slugToPath` would yield `/Users/x/has/hyphens`
**And** the existing fallback test (no sessions present) continues to pass after the helper is moved off `sessions/`

### AC2 — `readProject` reads JSONLs from the slug dir directly

**Given** [src/services/claude-reader.ts:217](../../src/services/claude-reader.ts#L217) (`readProject`)
**When** scanning the project directory
**Then** session JSONLs are enumerated directly from `projectDir` (the slug dir) — NOT from `join(projectDir, 'sessions')`
**And** subdirectories (`<uuid>/`, `memory/`) are excluded from the JSONL listing — use `safeStat` or the existing `Dirent` pattern to skip non-files
**And** the `SessionFile[]` returned in `ProjectSurface.sessions` is unchanged in shape: `{ filename: '<uuid>.jsonl', lines: string[] }`

**Given** [src/services/claude-reader.test.ts](../../src/services/claude-reader.test.ts) lines 127–130 (the existing `project.sessions[0].filename === 'abc123.jsonl'` assertion)
**When** the fixture setup is updated to write the JSONL flat under `<slug>/abc123.jsonl` instead of `<slug>/sessions/abc123.jsonl`
**Then** the test still passes and now reflects the real on-disk layout

### AC3 — `applySessionHistory` writes JSONLs flat under the slug dir

**Given** [src/services/claude-writer.ts:704](../../src/services/claude-writer.ts#L704) (`applySessionHistory`)
**When** in either `overwrite` or `merge` mode
**Then** session files are written directly to `join(opts.targetDir, 'projects', opts.data.slug)` — NOT to a `sessions/` subdir
**And** `overwrite` mode removes only `*.jsonl` files at that level (NOT the entire slug dir, NOT subdirectories like `<uuid>/` or `memory/`)
**And** `merge` mode continues to be append-only by filename: existing `*.jsonl` files are preserved, new ones are added, existing names are skipped

**Given** [src/services/claude-writer.test.ts](../../src/services/claude-writer.test.ts) lines 377–404 (existing session-history tests)
**When** the fixtures are updated to flat layout
**Then** the tests still pass and assert that overwrite mode removes only the pre-existing JSONL at the slug-dir top level — NOT a sibling `memory/` dir or a `<uuid>/` sidecar

**Dev Note:** The `overwrite`-mode "remove sessions dir" semantic must change to "remove pre-existing `*.jsonl` files at the slug-dir top level." Use `safeReadDir(slugDir)` + filter `.jsonl`, then `safeGateRemove` each file. Do NOT `safeGateRemove` the slug dir itself — that would wipe `memory/`, `CLAUDE.md`, `settings.json`, and `<uuid>/` sidecars.

### AC4 — `fix-paths` skip-and-continue on per-project undecodable slug

**Given** [src/commands/fix-paths.ts:154-161](../../src/commands/fix-paths.ts#L154) — the silent-mode branch in `collectRemapDecisions`
**When** a `--remap` rule does not match a given project's decoded path AND at least ONE `--remap` rule was supplied
**Then** that project is recorded as `{ slug, originalPath, targetPath: null, action: 'skip' }` and a per-project warning is emitted via `out.warn`: `Skipped: --remap rule needed for <slug> (decoded: <decodedPath>)`
**And** the loop continues to the next project — the run does NOT throw `PATH_REMAP_AMBIGUOUS` for a single unmatched slug

**Given** the same silent-mode branch
**When** NO `--remap` rule is supplied at all AND there is at least one missing project
**Then** behavior is unchanged: `PATH_REMAP_AMBIGUOUS` is thrown so users learn they must supply rules (no-rules-at-all is genuine misuse, not a per-project gap)

**Given** the same silent-mode branch
**When** at least one `--remap` rule was supplied AND it matched at least one project AND zero projects were successfully remapped (every project either no-op or skipped)
**Then** behavior is unchanged from today's no-renames branch in `applyDecisions` — return normally with `backupPath: null` and the per-project warnings surfaced

**Given** an integration test exercising this behavior
**When** silent mode is invoked with three valid `--remap` rules plus one undecodable extra slug present on disk
**Then** the three rules apply, the extra slug is warned and skipped, and the run exits 0

**Dev Note:** The current behavior (`throw PATH_REMAP_AMBIGUOUS` for any unmatched project) was correct against the spec but proved too aggressive once real installs surfaced bundled-Claude slugs like `-Applications-Visual-Studio-Code-app-Contents-Resources-app-bin`. The change preserves the "no rules at all" hard-abort (genuine user error) but downgrades "rule didn't match THIS project" to a per-project skip with a warning. JSON output must include the warning in `summary.warnings`.

### AC5 — `applyMcpConfig` / `applyTeams` / `applyPlugins` use `readSettingsFileStrict`

**Given** [src/services/claude-writer.ts:592](../../src/services/claude-writer.ts#L592) (`applyMcpConfig`)
**When** reading the existing `settings.json` for merge or overwrite
**Then** the read goes through `readSettingsForMerge` (or an equivalently strict wrapper around `readSettingsFileStrict`) — NOT `readClaudeJsonFile`
**And** a malformed `settings.json` (existing file, parse failure or structural non-object JSON) throws `CmemmovError({ code: 'INTERNAL', hint: 'settings file is malformed; restore from backup or fix manually before importing: <filePath>' })`
**And** the absent file (ENOENT → `undefined`) continues to be treated as `{}` (empty base) — unchanged

**Given** [src/services/claude-writer.ts:644](../../src/services/claude-writer.ts#L644) (`applyTeams`)
**When** reading each team's existing `config.json` for the id-collision check
**Then** the read goes through the strict reader and a malformed `config.json` throws the same `INTERNAL` error — `<teamsDir>/<teamName>/config.json` in the `file` slot
**And** team configs whose `id` is non-string remain skipped from the existing-id Set (preserves today's behavior; only fully-parseable configs contribute to collision detection)
**And** incoming team configs lacking an `id` field are written verbatim to `<teamsDir>/<teamName>/config.json` (matches existing behavior — id-less configs cannot collide with id-keyed ones, so they always write; documented in code comment)

**Given** [src/services/claude-writer.ts:680](../../src/services/claude-writer.ts#L680) (`applyPlugins`)
**When** reading the existing `plugins.json` in merge mode
**Then** the read goes through the strict reader and a malformed file throws the same `INTERNAL` error
**And** when an existing `plugins/` directory is detected (any non-empty directory at `join(opts.targetDir, 'plugins')` containing at least one `<name>/config.json` entry), the writer aborts with `CmemmovError({ code: 'INTERNAL', hint: 'target install uses the plugins/ directory form; cmemmov writes plugins.json. Migrate manually before importing.', file: <pluginsDirPath> })` rather than silently writing `plugins.json` and masking the directory contents
**And** when no `plugins/` directory exists (or it exists but is empty), behavior is unchanged: write `plugins.json` per current semantics

**Given** [src/services/claude-writer.test.ts](../../src/services/claude-writer.test.ts)
**When** the test suite runs
**Then** three new tests are added — one per writer (`applyMcpConfig`, `applyTeams`, `applyPlugins`) — that seed the relevant file with malformed JSON (`'{not json'` or `'[1,2,3]'` top-level array) and assert the writer throws `INTERNAL`; gate.write is NOT called
**And** one new test seeds a `plugins/` dir form (e.g., `plugins/foo/config.json` with `{}`) and asserts `applyPlugins` throws `INTERNAL` rather than writing `plugins.json`
**And** existing happy-path tests for all three writers continue to pass

**Dev Note:** Where the existing-merge logic does `const existing = isObject(parsed) ? parsed : {}`, the strict-reader path is: get `readSettingsFileStrict(path)` result → if `'malformed'` throw; if `undefined` use `{}`; if `Record<string, unknown>` use as-is. The `readSettingsForMerge` helper from Story 3.0 (in `claude-writer.ts`) is the right thing to call — its `INTERNAL` throw already exists with the right hint.

### AC6 — Test fixtures and integration test fixtures match real Claude layout

**Given** [tests/integration/helpers/temp-claude-dir.ts:97](../../tests/integration/helpers/temp-claude-dir.ts#L97) (`seedClaudeTree`)
**When** seeding a fixture
**Then** the project JSONL is written flat under `<slug>/session-1.jsonl` — NOT under `<slug>/sessions/session-1.jsonl`
**And** the `realSessionsDir` variable is removed (or renamed to something like `realJsonlPath` for the single file)
**And** the JSDoc layout comment is updated to reflect flat-layout reality

**Given** [tests/integration/fix-paths.test.ts](../../tests/integration/fix-paths.test.ts) (lines 116–119, 229, 240, 317, 593)
**When** any test setup writes a JSONL into a fixture slug dir
**Then** each call site is updated to write to `join(tmpRoot, '.claude', 'projects', slug, '<filename>.jsonl')` directly — NOT into a `sessions/` subdir
**And** any helper variable named `*SessionsDir` is renamed or removed so a future grep for `sessions/` in this file returns nothing under fixture-construction code

**Given** [tests/integration/fix-paths.test.ts](../../tests/integration/fix-paths.test.ts)
**When** the suite runs
**Then** a NEW integration test is added — `fix-paths --silent with --remap rules: real-layout fixture with hyphenated folder names` — that:
- Seeds three projects whose decoded original paths contain hyphens (e.g., `/home/u/fhir-bridge`, `/home/u/query-parameter-registry`, `/home/u/repository-registry`) — each with a flat JSONL whose `cwd` matches the hyphenated original path
- Seeds a `<uuid>/` sidecar directory inside one of those slug dirs (empty or containing a placeholder file) to confirm the reader skips it
- Seeds a `memory/` directory inside one of those slug dirs to confirm the reader skips it
- Seeds a fourth slug that is genuinely undecodable (e.g., `-Applications-Visual-Studio-Code-app-Contents-Resources-app-bin`) with NO `.jsonl` files
- Runs `fix-paths --silent --remap <rule-1> --remap <rule-2> --remap <rule-3>` (rules for the three hyphenated projects only; no rule for the VS Code slug)
- Asserts: exit 0; all three hyphenated slugs renamed; the VS Code slug skipped with a warning in `summary.warnings` matching `/Skipped: --remap rule needed for -Applications-Visual-Studio-Code/`; backup created

**Given** [src/services/claude-writer.test.ts](../../src/services/claude-writer.test.ts) lines 377–404 (existing applySessionHistory tests)
**When** the suite runs
**Then** fixtures are updated to flat layout (existing pre-write `.jsonl` lives at `<slug>/old-session.jsonl`, not `<slug>/sessions/old-session.jsonl`)
**And** new assertions confirm that overwrite mode does NOT remove a sibling `memory/` subdir or a `<uuid>/` sidecar (seed one of each and assert post-conditions)

**Given** [src/services/claude-reader.test.ts](../../src/services/claude-reader.test.ts) lines 127–178 (existing resolve/readProject tests using `sessions/` subdir)
**When** the suite runs
**Then** fixtures are updated to flat layout
**And** the `case (b): falls back to slugDecode when no sessions exist` test is augmented to seed a `<uuid>/` sidecar dir in the slug dir, proving the reader correctly classifies the dir as a non-JSONL entry rather than as a session file

### AC7 — `npm run check` and `npm run coverage:run` pass clean

**Given** all changes in this story
**When** `npm run check` runs (lint + typecheck + full vitest suite)
**Then** it exits 0 with no lint errors, no type errors, and the test suite passes
**And** `npm run coverage:run` exits 0 with no per-file coverage regression for `path-engine.ts`, `bundle-schema.ts`, `error.ts`, `claude-writer.ts`, or `claude-reader.ts` (compared to the post-Story-3.4 baseline)

## Tasks / Subtasks

- [x] Task 1 — `resolveOriginalPath` flat-layout fix (AC1)
  - [x] 1.1 In [src/services/claude-reader.ts:287-345](../../src/services/claude-reader.ts#L287), change the `sessionsDir` join to use the slug dir directly: `const slugDir = join(claudeDir, 'projects', slug);`
  - [x] 1.2 Replace `safeReadDir(sessionsDir)` with `safeReadDir(slugDir)` and filter the result to `*.jsonl` entries that are files (use `safeStat` to exclude `<uuid>/` and `memory/` subdirs)
  - [x] 1.3 Update `join(sessionsDir, mostRecentName)` → `join(slugDir, mostRecentName)` for stat/read calls
  - [x] 1.4 Preserve the EBUSY/EPERM CmemmovError wrapping
  - [x] 1.5 Add a unit test in `src/services/claude-reader.test.ts`: hyphenated-cwd JSONL flat under slug dir → `source: 'sessionCwd'`, path matches the hyphenated cwd

- [x] Task 2 — `readProject` flat-layout fix (AC2)
  - [x] 2.1 In [src/services/claude-reader.ts:217-233](../../src/services/claude-reader.ts#L217), drop the `sessionsDir` derivation; enumerate `*.jsonl` files in `projectDir` itself
  - [x] 2.2 Exclude entries that are directories (use `safeStat` per entry, OR switch to `readdir(..., { withFileTypes: true })` and filter `Dirent.isFile() && name.endsWith('.jsonl')`)
  - [x] 2.3 Update the `readSessionFile` join site to `join(projectDir, f)`
  - [x] 2.4 Update the existing reader test fixture to write the JSONL flat (the test on line 127–130 keeps passing; only the fixture-setup mkdir/writeFile lines change)

- [x] Task 3 — `applySessionHistory` flat-layout fix (AC3)
  - [x] 3.1 In [src/services/claude-writer.ts:704-722](../../src/services/claude-writer.ts#L704), change the `sessionsDir` derivation to write directly into the slug dir: `const slugDir = join(opts.targetDir, 'projects', opts.data.slug);`
  - [x] 3.2 Overwrite mode: instead of `safeGateRemove(opts.gate, sessionsDir)` (which removes everything), enumerate existing entries in `slugDir` via `safeReadDir`, filter to `*.jsonl` files (stat-check to avoid removing a `.jsonl`-named directory — unlikely but defensive), and `safeGateRemove` each `.jsonl` file individually
  - [x] 3.3 Merge mode: existing names check should also be derived from the flat layout — use `safeReadDir(slugDir).filter(n => n.endsWith('.jsonl'))`
  - [x] 3.4 `opts.gate.mkdir(slugDir, { recursive: true })` instead of mkdir of the sessions subdir
  - [x] 3.5 `opts.gate.write(join(slugDir, sf.filename), ...)`
  - [x] 3.6 Update writer tests in `src/services/claude-writer.test.ts` lines 377–404: flat fixture, plus assertions that `memory/` and a seeded `<uuid>/` sidecar survive an overwrite

- [x] Task 4 — `fix-paths` per-project skip-and-continue (AC4)
  - [x] 4.1 In [src/commands/fix-paths.ts:138-197](../../src/commands/fix-paths.ts#L138), change the silent-mode `collectRemapDecisions` loop:
    - Before the loop: if `silent && remapSpecs.length === 0 && missing.length > 0`, throw `PATH_REMAP_AMBIGUOUS` once with the same hint shape as today (no rules at all = misuse; preserve hard abort)
    - Inside the loop: when `match === null` AND `remapSpecs.length > 0`, push `{ slug, originalPath: decodedPath, targetPath: null, action: 'skip' }`, capture a warning string `Skipped: --remap rule needed for ${slug} (decoded: ${decodedPath})`, and `continue` — DO NOT throw
  - [x] 4.2 `collectRemapDecisions` returns the decision list as today; add a second return value or a side-channel for per-project warnings (or push warnings into a shared array passed via an out-parameter — pick whichever is least invasive). Decisions captured: the warnings list flows back to `run()` so they land in `out.warn` calls and `summary.warnings`.
  - [x] 4.3 In `run()`, after `collectRemapDecisions` returns, surface each collected warning via `out.warn(msg)` BEFORE `applyDecisions` runs (so dry-run preview shows them too)
  - [x] 4.4 Update unit/integration tests: at least one new integration test in `tests/integration/fix-paths.test.ts` exercises three valid rules + one undecodable extra slug; asserts exit 0 and warning text in `summary.warnings`
  - [x] 4.5 The existing AC5-style "no `--remap` at all in silent mode → throws PATH_REMAP_AMBIGUOUS" test must remain green (this is the preserved hard-abort path)

- [x] Task 5 — `applyMcpConfig` strict-read migration (AC5)
  - [x] 5.1 In [src/services/claude-writer.ts:592-614](../../src/services/claude-writer.ts#L592), replace `await readClaudeJsonFile(settingsPath)` with the strict path. Use the existing `readSettingsForMerge(settingsPath)` helper if it's already exported by `claude-writer.ts`; otherwise call `readSettingsFileStrict(settingsPath)` from `claude-reader.ts` and translate the `'malformed'` sentinel to `CmemmovError({ code: 'INTERNAL', hint: 'settings file is malformed; restore from backup or fix manually before importing: ' + settingsPath, file: settingsPath })`
  - [x] 5.2 Treat the `undefined` (ENOENT) result as `{}` (current behavior preserved)
  - [x] 5.3 Add a test in `src/services/claude-writer.test.ts`: seed `settings.json` with `'{not json'` → `applyMcpConfig` throws `INTERNAL`; gate.write NOT called

- [x] Task 6 — `applyTeams` strict-read migration + id-less behavior comment (AC5, D6)
  - [x] 6.1 In [src/services/claude-writer.ts:644-674](../../src/services/claude-writer.ts#L644), inside the merge branch's `for (const d of existingDirs)` loop, replace `readClaudeJsonFile(...)` with the strict reader, with the same malformed-throws / undefined-skips translation
  - [x] 6.2 Add an inline code comment above the merge branch documenting the id-less write behavior: `// Incoming team configs without an "id" field cannot participate in id-keyed collision detection, so they always write. This is intentional; teams lacking an id are addressed solely by directory name.`
  - [x] 6.3 Add a test in `src/services/claude-writer.test.ts`: seed `teams/foo/config.json` with `'{not json'` → `applyTeams` throws `INTERNAL`; gate.write NOT called (assert via `gate.recordedOps()` length)

- [x] Task 7 — `applyPlugins` strict-read migration + dir-form abort (AC5, D5)
  - [x] 7.1 In [src/services/claude-writer.ts:680-698](../../src/services/claude-writer.ts#L680), before any write, check for an existing `plugins/` directory at `join(opts.targetDir, 'plugins')`. Use `safeStat` (re-export it from `claude-reader.ts` if needed, or replicate inline with `try { await stat(p) } catch ...`). If it exists AND `safeReadDir` returns at least one entry that has a `<name>/config.json` file (use `safeStat` per entry to confirm the config.json exists as a regular file), throw `CmemmovError({ code: 'INTERNAL', hint: 'target install uses the plugins/ directory form; cmemmov writes plugins.json. Migrate manually before importing.', file: pluginsDirPath })`
  - [x] 7.2 For the existing `plugins.json` merge path, replace `readClaudeJsonFile(pluginsPath)` with the strict reader (malformed throws `INTERNAL`)
  - [x] 7.3 Add two tests in `src/services/claude-writer.test.ts`:
    - Seed `plugins.json` with `'[1,2,3]'` → `applyPlugins` throws `INTERNAL`; gate.write NOT called
    - Seed `plugins/foo/config.json` with `'{}'` (dir form) → `applyPlugins` throws `INTERNAL`; gate.write NOT called

- [x] Task 8 — Test fixture migration: integration helper + fix-paths integration tests (AC6)
  - [x] 8.1 [tests/integration/helpers/temp-claude-dir.ts](../../tests/integration/helpers/temp-claude-dir.ts) — `seedClaudeTree`: drop the `sessions/` subdir; write the JSONL to `join(realProjectDir, 'session-1.jsonl')`; update the JSDoc layout block (lines 80–95) to reflect the flat layout
  - [x] 8.2 [tests/integration/fix-paths.test.ts](../../tests/integration/fix-paths.test.ts): update every test that writes a JSONL via `mkdir(sessionsDir, { recursive: true })` + `writeFile(join(sessionsDir, ...))` to write the JSONL flat under the slug dir directly. Affected lines (audit against the file): 116–119, 229, 240, 317, 593. After the change, grep the file for `sessions` — no remaining fixture-construction reference should match (test-name strings may still reference "sessions" colloquially; only construction code is in scope)
  - [x] 8.3 Add the new real-layout integration test described in AC6 — call it `fix-paths --silent --remap: real-layout fixture with hyphenated names and skip-and-continue` or similar. Seed: three hyphenated-cwd JSONLs under three slug dirs, one slug dir with a `<uuid>/` sidecar dir and a `memory/` subdir to prove they're ignored, one fourth slug with NO `.jsonl` files representing the genuinely-undecodable case. Run silent fix-paths with 3 `--remap` rules; assert exit 0, 3 renames, 1 skip warning

- [x] Task 9 — Reader test fixture migration (AC1, AC2)
  - [x] 9.1 [src/services/claude-reader.test.ts](../../src/services/claude-reader.test.ts): update fixture-construction sites that build JSONLs under `<slug>/sessions/` to write them flat under `<slug>/`. The existing assertions on `project.sessions[0].filename` and `lines` stay unchanged
  - [x] 9.2 Augment the existing `case (b): falls back to slugDecode when no sessions exist` test: seed a `<uuid>/` sidecar dir inside the slug dir to prove the reader correctly classifies it as non-JSONL and falls through to slugDecode anyway

- [x] Task 10 — Writer test fixture migration (AC3)
  - [x] 10.1 [src/services/claude-writer.test.ts](../../src/services/claude-writer.test.ts) lines 377–404 (existing applySessionHistory tests): update fixtures to flat layout; add a `memory/` subdir and a `<uuid>/` sidecar dir to the seeded slug dir in the overwrite test, and assert post-conditions that they survive an overwrite (only the `*.jsonl` files at the slug-dir top level are removed)

- [x] Task 11 — Final validation (AC7)
  - [x] 11.1 `npm run check` exits 0 — lint clean, typecheck clean, full test suite passes
  - [x] 11.2 `npm run coverage:run` exits 0 — no per-file coverage regression for the five tracked modules

## Dev Notes

### File locations (all relative to project root)

| File | Change type |
|------|-------------|
| [src/services/claude-reader.ts](../../src/services/claude-reader.ts) | Edit — `resolveOriginalPath`, `readProject` flat layout (AC1, AC2) |
| [src/services/claude-reader.test.ts](../../src/services/claude-reader.test.ts) | Edit — fixture migration + new hyphenated-cwd test (AC1, AC2) |
| [src/services/claude-writer.ts](../../src/services/claude-writer.ts) | Edit — `applySessionHistory` flat layout, strict-read migration for `applyMcpConfig`/`applyTeams`/`applyPlugins`, `applyPlugins` dir-form abort (AC3, AC5) |
| [src/services/claude-writer.test.ts](../../src/services/claude-writer.test.ts) | Edit — fixture migration + 6 new tests (AC3, AC5) |
| [src/commands/fix-paths.ts](../../src/commands/fix-paths.ts) | Edit — silent-mode per-project skip-and-continue + warnings flow (AC4) |
| [tests/integration/helpers/temp-claude-dir.ts](../../tests/integration/helpers/temp-claude-dir.ts) | Edit — `seedClaudeTree` flat layout + JSDoc update (AC6) |
| [tests/integration/fix-paths.test.ts](../../tests/integration/fix-paths.test.ts) | Edit — every existing test's fixture, plus the new real-layout test (AC6) |

### Key context from Epic 3 + bug report

**The bug (B1/B2) in one sentence:** [src/services/claude-reader.ts:287](../../src/services/claude-reader.ts#L287) (`resolveOriginalPath`) and [src/services/claude-reader.ts:217](../../src/services/claude-reader.ts#L217) (`readProject`) look for session JSONLs under `<slug>/sessions/`, but Claude Code writes them flat under `<slug>/*.jsonl`. `safeReadDir` swallows `ENOENT`, so the `sessionCwd` branch never enters; the run falls through to the documented-lossy `slugToPath` for every project. The lossy decode mangles every folder name containing `-` (e.g., `/Users/x/fhir-bridge` becomes `/Users/x/fhir/bridge`). Knock-on: `applySessionHistory` in the writer has the same wrong layout (silent zero-session bundles on round-trip).

Bug report and evidence: [bug-2026-05-12-fix-paths-sessions-layout.md](./bug-2026-05-12-fix-paths-sessions-layout.md).

**`<slug>/` real layout from real Claude installs** (per the bug report's `ls` evidence):
```
~/.claude/projects/-Users-jbrandt-fhir-bridge/
  209bd894-7041-44a0-8a5a-1eac06c6c341.jsonl    ← session file (FLAT)
  3e13e938-e7e4-47fc-b9be-ad70c8a685df/         ← uuid sidecar dir (SKIP)
  3e13e938-e7e4-47fc-b9be-ad70c8a685df.jsonl    ← session file (FLAT)
  ...
  memory/                                       ← memory subdir (SKIP — read by readMemoryDir)
```

The reader must:
1. List entries of `<slug>/`
2. Filter to `*.jsonl` files (entries that are NOT directories)
3. Treat each survivor as a session file

The writer (`applySessionHistory`) must:
- Write JSONLs flat under `<slug>/`
- In overwrite mode, remove only the existing `*.jsonl` files at the top level — do NOT wipe the slug dir wholesale (would destroy `memory/`, `CLAUDE.md`, `settings.json`, `<uuid>/`)

**Why per-project skip-and-continue (B3):** Real installs frequently contain Claude-launched slugs for things like `/Applications/Visual Studio Code.app/Contents/Resources/app/bin` — encoded into a slug that lost both `/` and ` ` to the encoder. Such slugs are genuinely undecodable and the user has no reasonable `--remap` rule to supply. Today the run aborts on the first such slug even if the user has perfectly good rules for three other projects. The fix: per-project skip with a warning. The "no rules at all" case remains a hard abort (user error: they ran the silent path without telling cmemmov what to do).

**The `readSettingsFileStrict` pattern (AC5 / D14):** Story 3.0 introduced this in [src/services/claude-reader.ts:106](../../src/services/claude-reader.ts#L106). It returns `Record<string, unknown> | undefined | 'malformed'`. The `claude-writer.ts::readSettingsForMerge` wrapper (Story 3.0) translates `'malformed'` into `CmemmovError({ code: 'INTERNAL', hint: 'settings file is malformed; ...' })`. The Epic 3 retro identified three remaining writer paths that still use the legacy `readClaudeJsonFile` (which collapses ENOENT and parse failure into the same `undefined`, silently treating malformed files as empty and clobbering them on write). This story migrates all three.

**`applyPlugins` plugins/-dir-form abort (D5):** [src/services/claude-reader.ts:184](../../src/services/claude-reader.ts#L184)'s `readPlugins` prefers `plugins.json` over the `plugins/<name>/config.json` directory form. Today the writer always writes `plugins.json`, which means once cmemmov writes that file the dir form's contents are silently masked from subsequent reads. The cleanest fix without rewriting plugins-format detection is: abort loudly when the dir form is detected so the user can decide how to migrate. The dir form is uncommon enough that a hard abort with a clear hint is acceptable; doing format-detection-and-routing is out of scope for this cleanup.

**`applyTeams` id-less behavior (D6):** Current code writes id-less configs verbatim because they have no participation in id-collision detection. The retro request was for an "explicit decision" — the chosen decision is "id-less configs always write" with a code comment documenting the rationale. No behavioral change; the AC documents the decision.

**Critical Constraint #1 (preserve invariants from Epic 1):**
- `JSON.parse` of config bytes must remain inside `claude-reader.ts` or `bundle-parser.ts` (the `no-raw-json-parse` ESLint rule). When migrating writers to the strict reader, do NOT inline `JSON.parse` in `claude-writer.ts` — use `readSettingsFileStrict` or `readSettingsForMerge`.
- `os.homedir()` direct use is reserved for `claude-locator.ts` (the `no-restricted-imports` rule). This story does not touch home-directory derivation.
- `console.*` is banned outside `src/ui/output.ts`. Progress/warnings go through `Output` only.

**Critical Constraint #2 — exhaustive grep for `sessions`:** After the edits, run `npm run lint && grep -rn "/sessions/\|join.*'sessions'\|sessions:.*Dir" src/ tests/ 2>nul || rg "/sessions/|join\([^)]*'sessions'|sessionsDir" src tests` and verify that any remaining match is in a documentation string, a test name, or a comment — NOT in active path construction. The new fixture's JSDoc may reference "sessions" as a domain term; that's fine. What must NOT remain is any code that joins `'sessions'` into a path used to read or write JSONLs.

**Critical Constraint #3 — `applySessionHistory` overwrite semantic preservation:** Today's overwrite removes the whole `sessions/` subdir wholesale. The new flat-layout overwrite must NOT remove the slug dir wholesale (would destroy CLAUDE.md, settings.json, memory/, <uuid>/). Only remove the existing `*.jsonl` files. Add an explicit test that seeds non-JSONL artifacts in the slug dir and asserts they survive an overwrite.

**Critical Constraint #4 — Story 3.4 fix-paths integration test fixtures use `sessions/` deliberately today.** That's the bug B4 fixed. After migration, those tests will still pass because `seedClaudeTree` now writes flat, AND because `resolveOriginalPath` now reads flat. Both must change in the same commit or the test suite goes red.

### Deferred items NOT included in Story 4.0

The following items remain in `deferred-work.md` and are explicitly NOT in scope for this story:
- D11 (`bundle.global.claudeJson` MCP sanitization) → Story 4.1 (strip-personal profile)
- LOW items from cr-3.0 (alias bypass in `no-process-env-home`, AC#4 valid-block parity gaps) → not retro-prioritized; left in deferred-work.md
- All LOW items from earlier stories not pulled forward → left in deferred-work.md
- Backup hardening (D7 from Story 3.0 triage) → Epic 5
- AC12 filesystem allowlist test (D9 from Story 3.0 triage) → Epic 5

### "Fail loudly before side effects" as standing principle (R3 from Epic 3 retro)

Epic 3 surfaced four MEDIUM findings all of the same shape: silent-failure before mutation. Carry forward as a CHECK against every Story 4.1–4.3 AC that touches the filesystem — verify the AC has an explicit "abort loudly before any side effect on bad precondition" clause. No 4.0 code change is required for this carry-forward; it's a process check for the stories that follow.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (anticipated)

### Debug Log References

No blockers encountered. All changes implemented in a single pass.

### Completion Notes List

- AC1/AC2: Fixed `resolveOriginalPath` and `readProject` in `claude-reader.ts` to read JSONLs flat from the slug dir. Added `safeStat` per-entry filtering to exclude uuid sidecar dirs and `memory/` subdirs.
- AC3: Fixed `applySessionHistory` in `claude-writer.ts` to write flat under slug dir. Overwrite mode now removes individual `*.jsonl` files at slug-dir top level rather than removing the slug dir wholesale (preserves `memory/`, CLAUDE.md, settings.json, uuid sidecars).
- AC4: Changed `collectRemapDecisions` return type to `{ decisions, warnings }`. Pre-loop hard-abort preserved for zero-rules-in-silent-mode. Inside loop, unmatched projects with at least one rule → per-project skip + warning. Updated all unit test call sites to destructure.
- AC5: Migrated `applyMcpConfig`, `applyTeams`, `applyPlugins` to use `readSettingsForMerge` (strict reader). Removed `readClaudeJsonFile` import from `claude-writer.ts` entirely. Added `safeStat` helper to `claude-writer.ts`.
- AC5/D5: `applyPlugins` now aborts with INTERNAL when `plugins/<name>/config.json` dir form is detected on disk.
- AC5/D6: `applyTeams` merge branch now has inline comment documenting id-less behavior.
- AC6: Migrated all fixtures (`seedClaudeTree`, fix-paths integration tests, reader/writer unit tests, network-shim, perf) from `sessions/` subdir to flat layout. Also updated `tests/fixtures/claude-trees/linux-typical/.claude/projects/-home-user-myproject/` fixture on disk.
- Added 6 new writer tests (strict-read INTERNAL for mcpConfig/teams/plugins, dir-form abort for plugins), 2 new reader tests (hyphenated-cwd flat JSONL, case-b uuid sidecar), and 1 new integration test (real-layout + skip-and-continue).
- `npm run check` exits 0: 475 tests pass, no lint errors, no type errors.
- `npm run coverage:run` exits 0: all five tracked modules at or above baseline.

### File List

- `src/services/claude-reader.ts` — modified (resolveOriginalPath, readProject flat layout)
- `src/services/claude-reader.test.ts` — modified (fixture migration, new tests)
- `src/services/claude-writer.ts` — modified (applySessionHistory flat layout, strict-read migrations, safeStat helper, applyPlugins dir-form abort, id-less comment)
- `src/services/claude-writer.test.ts` — modified (fixture migration, 6 new tests)
- `src/commands/fix-paths.ts` — modified (collectRemapDecisions per-project skip-and-continue, warnings return)
- `src/commands/fix-paths.test.ts` — modified (destructure new return type, update PATH_REMAP_AMBIGUOUS test)
- `tests/integration/helpers/temp-claude-dir.ts` — modified (seedClaudeTree flat layout + JSDoc)
- `tests/integration/fix-paths.test.ts` — modified (fixture migration + new real-layout test)
- `tests/integration/network-shim.test.ts` — modified (local seedClaudeTree flat layout)
- `tests/integration/perf.test.ts` — modified (fixture flat layout)
- `tests/fixtures/claude-trees/linux-typical/.claude/projects/-home-user-myproject/abc123.jsonl` — added (flat layout)
- `tests/fixtures/claude-trees/linux-typical/.claude/projects/-home-user-myproject/sessions/abc123.jsonl` — deleted
