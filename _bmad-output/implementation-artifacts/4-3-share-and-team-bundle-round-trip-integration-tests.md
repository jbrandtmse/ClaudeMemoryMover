# Story 4.3: `share` + Team Bundle Round-Trip Integration Tests

Status: done

## Story

As a cmemmov maintainer,
I want an integration test suite that exercises the full `share` → version control → `import` round trip on a clean target tree, with explicit negative tests for NFR6 (credentials never included) and personal-data exclusion,
so that the team-onboarding workflow (Taylor's journey) is regression-protected end-to-end and the security-critical NFR6 is mechanically verified rather than trusted to documentation.

## Acceptance Criteria

### AC1 — `tests/integration/share.test.ts` exists with comprehensive coverage

**Given** [tests/integration/share.test.ts](../../tests/integration/share.test.ts) (new file)
**When** I list its test cases
**Then** it covers at minimum the following scenarios:
- (a) Basic `share` → `import` round trip on a clean target tree
- (b) `--include-credentials` rejected at parse time with `SHARE_INVALID_SOURCE`; no bundle file written
- (c) Home-directory absolute-path permission rules stripped from the produced bundle
- (d) Network-path MCP server entries preserved verbatim
- (e) Personal memory file (`personal_notes.md`) exclusion
- (f) Credential exclusion — positive test starting with a credentials file PRESENT in source `~/.claude/`
- (g) Dry-run produces zero filesystem changes (byte-for-byte snapshot)
- (h) `.claude.json` user-identifying fields stripped per `CLAUDE_JSON_TEAM_ALLOWLIST`
- (i) Custom commands preserved in the bundle and applied on import
- (j) Local-path MCP server entries removed with a warning recorded in `summary.warnings`

**And** each test runs against the real `share.run()` and `import.run()` exported functions (not via spawn/exec — same pattern as `cross-os-import.test.ts` and `fix-paths.test.ts`)

### AC2 — Share-flavored fixture seeder

**Given** [tests/integration/helpers/temp-claude-dir.ts](../../tests/integration/helpers/temp-claude-dir.ts)
**When** I inspect its exports
**Then** a new exported function `seedShareSourceTree(opts: SeedShareSourceOpts): Promise<ShareSourceTempClaudeDir>` is added — or `seedClaudeTree` is extended with optional `opts.credentials` / `opts.personalMemories` / `opts.mcpServers` / `opts.claudeJsonExtras` parameters that the existing tests can safely ignore. Either approach is acceptable; pick the cleaner extension and don't break existing callers
**And** the seeder produces, in addition to the existing seedClaudeTree layout:
- `<tmpRoot>/.claude/.credentials.json` containing `{ "oauthToken": "secret-test-token-EYES-ONLY" }` — used to verify NFR6 stripping
- `<tmpRoot>/.claude/memory/personal_notes.md` containing `# Personal\n\nLocal-only notes that should NEVER ship.\n` — used to verify personal-memory exclusion
- `<tmpRoot>/.claude/memory/team-conventions.md` containing `# Team conventions\n\nThese SHOULD ship.\n` — used as the must-be-preserved counterpart
- `<tmpRoot>/.claude/commands/team-cmd.md` containing `# /team-cmd\n\nTeam-relevant slash command.\n` — used to verify custom-commands preservation
- `<tmpRoot>/.claude/settings.json` with the following permission rules:
  - `Read(<sourceHomedir>/agents/**)` — a HOME-directory absolute path that MUST be stripped
  - `Read(./local-thing)` — a relative path that MUST be preserved
  - `Read(\\\\internal\\toolserver\\**)` (win32) or `Read(//internal/toolserver/**)` (posix) — a network path that MUST be preserved
  - `Bash(git status)` — non-path argument that MUST be preserved
- `<tmpRoot>/.claude/settings.json` with `mcpServers` (or wherever the writer expects it — match the actual reader's behavior, NOT a guess) containing:
  - `fileserver-local`: `{ "command": "<sourceHomedir>/agents/local-tool.js" }` — local under home, MUST be stripped
  - `internal-toolserver`: `{ "command": "\\\\internal\\toolserver\\bin\\server.exe" }` (win32) or `{ "command": "//internal/toolserver/bin/server" }` (posix) — network, MUST be preserved
  - `bare-program`: `{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-X"] }` — bare command, MUST be preserved
- `<tmpRoot>/.claude.json` with: `{ "theme": "dark", "email": "alice@example.com", "machineId": "fake-machine-uuid-EYES-ONLY", "recentProjects": [{ "path": "<sourceHomedir>/projects/my-app" }], "lastSessionCwd": "<sourceHomedir>/projects/my-app", "experiments": ["plus"] }` — `theme` and `experiments` must survive (allowlist); everything else stripped

**Given** the same seeder
**When** any test passes `opts.credentials: false`
**Then** the credentials file is NOT created (the option is opt-in for tests that need to demonstrate "no credentials in source either" behavior); default is `true` so most tests get a credentials file by default

**Given** the seeder
**When** the test sets `process.env.CLAUDE_CONFIG_DIR = join(tmpRoot, '.claude')`
**Then** `locateClaude()` finds the seeded tree as if it were the user's real `~/.claude/`

### AC3 — Basic round-trip happy path

**Given** a populated source seed (per AC2 — credentials, personal memory, team memory, custom command, MCP servers, permission rules, .claude.json user fields) and `process.env.CLAUDE_CONFIG_DIR` pointing at it
**When** the test runs `shareRun({ silent: true, json: true, categories: 'claudeMd,customCommands,mcpConfig,settings,teams,plugins', output: <tmpRoot>/team-baseline.cmemmov })`
**Then** exit is success (no throw); a bundle file is produced at the specified path
**And** the bundle parses successfully via `BundleSchema.parse`
**And** the parsed bundle has `profile === 'team-baseline'`
**And** `bundle.global.claudeMd === '# Global memory\n'` (preserved)
**And** `bundle.global.customCommands` contains an entry whose filename is `team-cmd.md`
**And** `bundle.global.settings.mcpServers` (or wherever MCP servers live — match the writer) has `internal-toolserver` and `bare-program` entries; `fileserver-local` is absent
**And** `bundle.credentials` is undefined OR `bundle.credentials.wasRedacted === true && bundle.credentials.content === null` (both shapes are acceptable since strip-personal strips credentials unconditionally and the bundle may or may not retain the field)
**And** `bundle.wasRedacted.credentials === true`
**And** `bundle.wasRedacted.personalMemoryFiles` contains an entry for `global/personal_notes.md` (or `personal_notes.md` — the scope-prefix is per Story 4.1 AC3)
**And** `bundle.wasRedacted.homeDirPermissionRules` contains exactly one entry: the `Read(<sourceHomedir>/agents/**)` rule
**And** `bundle.wasRedacted.localMcpServers` contains `fileserver-local`
**And** `bundle.wasRedacted.claudeJsonFields` includes `email`, `machineId`, `recentProjects`, `lastSessionCwd`

**Given** a clean target tree (empty `<targetTmpRoot>/.claude/`)
**When** the test runs `importRun(bundlePath, { silent: true, json: true, mode: 'merge', noIntegrityCheck: false })`
**Then** import succeeds without throw
**And** `<targetTmpRoot>/.claude/CLAUDE.md` exists with the seeded global content
**And** `<targetTmpRoot>/.claude/commands/team-cmd.md` exists with the seeded content
**And** `<targetTmpRoot>/.claude/settings.json` contains the preserved rules (relative + network + Bash) AND the network MCP server entries
**And** `<targetTmpRoot>/.claude/settings.json` does NOT contain `Read(<sourceHomedir>/agents/**)` nor the `fileserver-local` MCP entry (the strip applied at share time persists through import)
**And** `<targetTmpRoot>/.claude/memory/personal_notes.md` does NOT exist on the target
**And** `<targetTmpRoot>/.claude/memory/team-conventions.md` DOES exist on the target with the seeded content
**And** if the test pre-seeds a target `.credentials.json` (with a DIFFERENT distinguishing value, e.g. `target-machine-credentials-DO-NOT-OVERWRITE`), the target's existing credentials file is byte-identical post-import — the team bundle never references credentials and the import does not touch the credentials file

### AC4 — `--include-credentials` rejection (NFR6)

**Given** any seeded source (credentials present or absent)
**When** the test runs `shareRun({ silent: true, includeCredentials: true, categories: '...', output: '<path>' })`
**Then** the call throws `CmemmovError` with `code === 'SHARE_INVALID_SOURCE'` and `exitCode === 2`
**And** no file exists at the supplied `output` path (assert via `pathExists(outputPath) === false`)
**And** `readClaudeSurface` was never called — verify by wrapping the read call in a spy OR by asserting that NO files under `<sourceTmpRoot>/.claude/` had their access-time updated since the test setup completed (whichever is cheaper to implement reliably across the 3 OSes)

**Given** the same test but interactive mode
**When** the test simulates `shareRun({ includeCredentials: true })` (no `silent`)
**Then** the same `SHARE_INVALID_SOURCE` throw fires BEFORE any interactive prompt is mocked — this confirms the parse-time check fires regardless of interactive vs silent

### AC5 — Forbidden-content sweep

**Given** the bundle produced by the AC3 happy path
**When** the test reads the bundle file as a raw string and inspects it
**Then** `bundleText.includes('secret-test-token-EYES-ONLY') === false` — the credential value never appears anywhere in the bundle bytes
**And** `bundleText.includes('fake-machine-uuid-EYES-ONLY') === false` — the .claude.json user-identifier never appears
**And** `bundleText.match(/personal_notes\.md/i)` returns null (no occurrences of the personal memory filename)
**And** the test parses the bundle JSON and walks `bundle.global.settings.permissions` (and per-project settings) asserting NO rule's argument starts with `<sourceHomedir>` after normalizing separators — only relative/network/non-path arguments remain

### AC6 — MCP network path preservation (PRD Journey 4)

**Given** the source seed has a network-path MCP server (`internal-toolserver` per AC2)
**When** `share` runs
**Then** the resulting bundle's MCP record contains `internal-toolserver` verbatim with its `command` field unchanged
**And** after import, the target's `~/.claude/settings.json` (or wherever MCP servers are written) contains `internal-toolserver` with the same `command` field — the network reference resolves the same way on the target machine

### AC7 — MCP local-path stripping with warning

**Given** the source seed has a local-path MCP server (`fileserver-local` per AC2)
**When** `share --json` runs
**Then** the entry is absent from the produced bundle
**And** the JSON summary's `warnings` array contains an entry whose text identifies `fileserver-local` AND mentions either `local MCP command path` or another phrase that names the matched rule (per Story 4.2 AC6's warning format)
**And** `bundle.wasRedacted.localMcpServers` contains `fileserver-local`

### AC8 — Dry-run zero-change invariant (NFR12)

**Given** the source seed AND a pre-existing partial target tree (or an absent target — both branches tested)
**When** the test takes a byte-for-byte snapshot of `<sourceTmpRoot>` via `snapshotTree` (from `cross-os-import.test.ts`-style helper — copy it into a shared helper if not already exported)
**And** then runs `shareRun({ silent: true, dryRun: true, categories: '...', output: <path>, json: true })`
**And** then takes a second snapshot
**Then** the two snapshots are deeply equal (no file added, removed, or modified)
**And** no file exists at the bundle output path
**And** the JSON summary has `dryRun: true` at the top level

### AC9 — Cross-OS CI matrix

**Given** the integration tests
**When** CI runs them on each of the three OS runners (Windows, macOS, Linux)
**Then** the same assertions pass on every runner — the `strip-personal` profile must behave identically across platforms
**And** the path-style fixtures use platform-aware separators (`path.sep`, `path.win32.sep`, `path.posix.sep` where needed) — DO NOT hardcode `\\` or `/` in production-bound fixtures. Where a test deliberately exercises a single platform's strings (e.g., `\\\\internal\\toolserver`), the test uses `mockPlatform('win32')` per `cross-os-import.test.ts` lines 77 / 9 to make the assertion deterministic regardless of the runner

**Given** every test in the suite
**When** it sets `process.env.CLAUDE_CONFIG_DIR`
**Then** it also restores the original value in a `finally` (or `afterEach`) block so subsequent tests are not poisoned

### AC10 — `npm run check` and CI matrix pass clean

**Given** all changes in this story
**When** `npm run check` runs (lint + typecheck + full test suite)
**Then** it exits 0
**And** the new tests in `tests/integration/share.test.ts` are included in the test run (verify by checking the test-files count grows by 1)
**And** `npm run coverage:run` exits 0; no per-file coverage regression for any tracked module

**Given** the CI matrix
**When** the workflow runs on Windows, macOS, and Linux runners
**Then** all `share.test.ts` cases pass on every platform — flake-free

## Tasks / Subtasks

- [ ] Task 1 — Extend the seed helper (AC2)
  - [ ] 1.1 In [tests/integration/helpers/temp-claude-dir.ts](../../tests/integration/helpers/temp-claude-dir.ts), decide between option A (add optional knobs to existing `seedClaudeTree`) and option B (new dedicated `seedShareSourceTree`). Recommendation: option B keeps the existing call sites unchanged. The new helper can internally call `seedClaudeTree` and then layer the share-specific seeds on top, OR be a fully independent seeder — pick whichever produces less duplication.
  - [ ] 1.2 Add to the helper:
    - Credentials file at `<tmpRoot>/.claude/.credentials.json` with the EYES-ONLY token (toggleable via `opts.credentials: boolean` — default `true`)
    - `<tmpRoot>/.claude/memory/personal_notes.md` and `team-conventions.md` per AC2
    - `<tmpRoot>/.claude/commands/team-cmd.md` per AC2
    - Settings.json permission rules per AC2 (home-dir absolute, relative, network, Bash)
    - Settings.json mcpServers per AC2 (local, network, bare-program)
    - `.claude.json` with allowlist + deny fields per AC2
  - [ ] 1.3 Network-path string varies by platform — use the win32 UNC form on `sourcePlatform === 'win32'` and the POSIX `//host/share` form on darwin/linux. Document in helper JSDoc that the strings are LITERAL source-OS forms (do not call `path.join`)
  - [ ] 1.4 The helper returns the source-OS-style `sourceHomedir` string so tests can build matching home-prefixed paths and pass them through assertions (matches what the produced bundle stores via Story 4.1 `bundle.sourceHomedir`)

- [ ] Task 2 — Shared `snapshotTree` helper (AC8)
  - [ ] 2.1 If `snapshotTree` is currently private to `cross-os-import.test.ts`, extract it into `tests/integration/helpers/snapshot-tree.ts` so the new share test can reuse it without duplication
  - [ ] 2.2 If extraction is non-trivial, copy the implementation inline into `share.test.ts` and add a deferred-work entry to consolidate. Either is acceptable; prefer extraction if the diff cost is low

- [ ] Task 3 — `tests/integration/share.test.ts` (AC1, AC3–AC8)
  - [ ] 3.1 Create the file. Imports follow the pattern in `cross-os-import.test.ts`: vitest helpers + `shareRun` from `../../src/commands/share.js` + `importRun` from `../../src/commands/import.js` + the seeder + `pathExists` / `snapshotTree` helpers
  - [ ] 3.2 Each test sets up an isolated tmpRoot, sets `process.env.CLAUDE_CONFIG_DIR`, runs the assertions, and unconditionally restores `process.env.CLAUDE_CONFIG_DIR` in `afterEach` or `finally`
  - [ ] 3.3 Tests required (one `it()` per AC scenario):
    - `'(a) round trip: share produces a valid team-baseline bundle and import lands it on a clean target'` — AC3
    - `'(b) --include-credentials is rejected at parse time with SHARE_INVALID_SOURCE and writes no bundle'` — AC4
    - `'(c) home-directory absolute-path permission rules are stripped from the produced bundle'` — AC3 sub-assertion + AC5 sweep
    - `'(d) network-path MCP server is preserved verbatim through share AND import'` — AC6
    - `'(e) personal memory file is excluded from the bundle and absent on the target'` — AC3 sub-assertion + AC5 sweep
    - `'(f) credential file present in source produces a bundle with no credential content (NFR6)'` — AC5 sweep + AC3 (target credentials untouched)
    - `'(g) --dry-run produces zero filesystem changes'` — AC8
    - `'(h) .claude.json user-identifying fields are stripped per CLAUDE_JSON_TEAM_ALLOWLIST'` — AC3 sub-assertion + AC5
    - `'(i) custom commands survive the round trip'` — AC3 sub-assertion
    - `'(j) local-path MCP server is stripped with a warning in summary.warnings'` — AC7
  - [ ] 3.4 Each test should explicitly assert AT LEAST ONE absent-on-target invariant (e.g., `expect(await pathExists(<sourceCredentialsBoundPathOnTarget>)).toBe(false)`) so a future regression that silently lands forbidden data is caught
  - [ ] 3.5 Capture JSON-mode summary by intercepting stdout (pattern: vi.spyOn(process.stdout, 'write') and parse the last JSON line — same pattern as `fix-paths.test.ts::captureJsonRun`). Reuse or extract the helper as in Task 2

- [ ] Task 4 — Cross-OS coverage (AC9)
  - [ ] 4.1 Use `mockPlatform` from `helpers/platform-mock.ts` to exercise both `win32` source/path-style fixtures AND `linux`/`darwin` style fixtures even when the test runner's actual platform is different. The AC3 happy-path test runs on the runtime platform; the MCP-network-path test and the home-dir-strip test should EACH run twice with `mockPlatform('win32')` and `mockPlatform('linux')` to verify cross-platform identity of the strip-personal profile
  - [ ] 4.2 Ensure every `mockPlatform` is restored in `afterEach` (same pattern as `cross-os-import.test.ts`)
  - [ ] 4.3 The CI matrix is already configured (`.github/workflows/ci.yml` per Story 1.13). No CI-config changes required — verify by inspecting the workflow YAML; if the new file is picked up automatically (which it will be — vitest's `tests/**/*.test.ts` glob picks it up), Task 4.3 is observation-only

- [ ] Task 5 — Validation (AC10)
  - [ ] 5.1 `npm run check` exits 0
  - [ ] 5.2 `npm run coverage:run` exits 0
  - [ ] 5.3 Test file count grows by 1; report the new total

## Dev Notes

### File locations (all relative to project root)

| File | Change type |
|------|-------------|
| [tests/integration/share.test.ts](../../tests/integration/share.test.ts) | NEW — comprehensive round-trip integration tests |
| [tests/integration/helpers/temp-claude-dir.ts](../../tests/integration/helpers/temp-claude-dir.ts) | Edit — add `seedShareSourceTree` (or extend `seedClaudeTree`) |
| [tests/integration/helpers/snapshot-tree.ts](../../tests/integration/helpers/snapshot-tree.ts) | NEW (optional) — extracted from `cross-os-import.test.ts` |
| [tests/integration/cross-os-import.test.ts](../../tests/integration/cross-os-import.test.ts) | Edit (only if Task 2.1 extracts snapshotTree) — replace inline implementation with the shared import |

### Reference test patterns

**Always use the function-call pattern, not spawn/exec.** Every existing integration test calls the command's `run()` function directly (see [tests/integration/cross-os-import.test.ts:5-7](../../tests/integration/cross-os-import.test.ts#L5)). This keeps tests fast, deterministic, and stack-traceable. Do NOT spawn `node dist/cmemmov.js share` — that's slower, dependent on the build step, and the failure modes are harder to diagnose.

**`process.env.CLAUDE_CONFIG_DIR` discipline.** Every test that touches the locator MUST set `CLAUDE_CONFIG_DIR` before running and MUST restore it (to its original value, NOT `delete process.env.CLAUDE_CONFIG_DIR`) in `afterEach`. Failure here poisons every subsequent test. See `cross-os-import.test.ts:27-35` for the canonical pattern.

**`mockPlatform` discipline.** Wrap mocked-platform code in `try/finally` (or `beforeEach`/`afterEach`) so the restore always runs even when an assertion throws. The mock's leak modes are documented in `helpers/platform-mock.ts` and deferred-work entries from prior stories.

**Bundle inspection pattern.** Parse the produced `.cmemmov` file via `BundleSchema.parse(JSON.parse(await readFile(bundlePath, 'utf8')))` — never reach into the file as raw bytes for structural assertions. The raw-string sweep (AC5) is separate from structural assertions and is for the "no credentials anywhere in the bytes" forbidden-content check.

**Auth file naming.** Claude Code uses `.credentials.json` (dotfile). Per the bug report and the existing reader code, the credentials reference can also be `credentials.json` (no leading dot). Match whichever the production code uses; the seeder produces one; if both shapes need testing, pick the canonical one and defer the other.

### Critical constraints (DO NOT VIOLATE)

1. **NFR6 — the ENTIRE point of this story is to mechanically verify NFR6.** Every test must be defensible as a regression-protection check against a credential leak. If a test passes vacuously (e.g., asserting `bundle.credentials === undefined` without first verifying credentials WERE present in the source), the test is worth nothing — explicitly seed credentials FIRST, then assert their absence in the bundle.
2. **Tests must not depend on each other.** Each `it()` is independent: own tmpRoot, own env, own platform mock. Test ordering must not matter.
3. **No `os.homedir()` in tests** — tests are NOT in the `claude-locator.ts` allowlist. Use `process.cwd()`-based or `tmpdir()`-based paths only.
4. **`console.*` is fine in tests** — the rule applies only to `src/**/*.ts`.
5. **No spawn/exec** — `run()` function calls only. The dev should NOT introduce a new pattern; reuse the existing one.
6. **Cross-platform string handling** — when fabricating source-OS paths (e.g., `C:\\Users\\alice\\agents\\local.js`), DO NOT use `path.join` (which uses the runtime separator). Use literal template strings matching the source platform's convention, mirroring `buildSourceOsPaths` in `temp-claude-dir.ts` lines 46-75.
7. **Test isolation** — each test must clean up its tmpRoot via `rm(tmpRoot, { recursive: true, force: true })` in `afterEach`/`finally`. Long test runs without cleanup fill `os.tmpdir()` and break subsequent CI jobs.

### Previous story intelligence

**From Story 4.0 (carry-forward "fail loudly before side effects"):** AC4's `--include-credentials` rejection MUST throw BEFORE any read. The test should assert this either by spying on the reader OR by snapshotting source-tree access times pre/post (whichever is reliable cross-OS). The bug-2026-05-12 layout fix (`<slug>/*.jsonl` flat) is already in place by Story 4.0; the seeded share fixtures should use the flat layout (matching `seedClaudeTree`'s post-4.0 form).

**From Story 4.1 (strip-personal profile):**
- `bundle.wasRedacted.{credentials, personalMemoryFiles, homeDirPermissionRules, localMcpServers, claudeJsonFields}` are the structured record AC3's sub-assertions reference
- `bundle.sourceHomedir` is populated at export/share time; use it (or the test's known seed value) for the home-dir prefix assertions
- `CLAUDE_JSON_TEAM_ALLOWLIST = ['theme', 'editorMode', 'verbose', 'experiments']` — only these survive in `bundle.global.claudeJson`

**From Story 4.2 (`share` command):**
- `shareRun(opts)` signature matches `exportRun` shape; `silent: true` skips all prompts; `json: true` produces the structured summary on stdout
- `summary.warnings` array is the canonical place to find per-stripped-item entries — the AC7 test consumes this
- The bundle has `profile: 'team-baseline'` set
- `SHARE_INVALID_SOURCE` is a real CmemmovError code with `exitCode: 2`
- Dry-run sets top-level `dryRun: true` in the JSON summary

### Deferred (not in scope for 4.3)

- Documentation in `docs/bundle-format.md` covering team-bundle workflow — Story 5.4
- Performance/large-fixture variant of the share test — defer until a real perf complaint
- Snapshot-test of the bundle's exact byte content (e.g. for "is the JSON layout stable enough to commit to a repo without churn?") — out of scope; the AC3 + AC5 assertions test the semantic invariants

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (anticipated)

### Debug Log References

### Completion Notes List

### File List
